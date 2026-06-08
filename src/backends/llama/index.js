import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

import { detectHardware } from '../../system.js';
import { downloadFile, extractArchive, getLlamaCppAssets, printProgressBar } from '../../downloader.js';
import { seedPortableEndpoint } from '../common.js';

function startProxy(localPort, targetPort) {
  const server = http.createServer((req, res) => {
    const options = {
      hostname: '127.0.0.1',
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Bad Gateway: Failed to connect to llama-server on port ${targetPort}`);
    });

    req.pipe(proxyReq, { end: true });
  });

  server.listen(localPort, '127.0.0.1', () => {
    console.log(`[Proxy] Headless API proxy listening on http://127.0.0.1:${localPort} (forwarding to http://127.0.0.1:${targetPort})`);
  });

  return server;
}

export async function startLlamaBackend(context) {
  const { binDir, logsDir, modelsDir, odysseusDir, projectRoot, pythonExe, waitPort } = context;

  const hw = detectHardware();
  console.log(`[Hardware] Detected: OS=${hw.os}, Arch=${hw.arch}, GPU=${hw.gpuBackend} (${hw.gpuName})`);

  const llamaDir = path.join(binDir, 'llama');
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const llamaExePath = path.join(llamaDir, exeName);

  if (!fs.existsSync(llamaExePath)) {
    console.log('[Inference] Precompiled llama-server not found. Downloading...');
    fs.mkdirSync(llamaDir, { recursive: true });

    const assets = await getLlamaCppAssets(hw);
    if (!assets.primary) {
      throw new Error('Could not find compatible llama.cpp binary asset for your system.');
    }

    console.log(`[Inference] Downloading primary asset: ${assets.primary.name}...`);
    const primaryZip = path.join(binDir, assets.primary.name);
    await downloadFile(assets.primary.browser_download_url, primaryZip, (downloaded, total) => {
      printProgressBar(downloaded, total, 'Downloading primary asset: ');
    });

    console.log('[Inference] Extracting primary asset...');
    extractArchive(primaryZip, llamaDir);
    fs.unlinkSync(primaryZip);

    if (assets.secondary) {
      console.log(`[Inference] Downloading secondary asset: ${assets.secondary.name}...`);
      const secondaryZip = path.join(binDir, assets.secondary.name);
      await downloadFile(assets.secondary.browser_download_url, secondaryZip, (downloaded, total) => {
        printProgressBar(downloaded, total, 'Downloading secondary asset: ');
      });

      console.log('[Inference] Extracting secondary asset...');
      extractArchive(secondaryZip, llamaDir);
      fs.unlinkSync(secondaryZip);
    }
    console.log('[Inference] Setup complete.');
  } else {
    console.log('[Inference] Precompiled llama-server detected.');
  }

  const scanLocalGgufs = (dir, baseDir = dir) => {
    const found = [];
    if (!fs.existsSync(dir)) return found;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...scanLocalGgufs(fullPath, baseDir));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        found.push({
          file: entry.name,
          relPath: path.relative(baseDir, fullPath),
          path: fullPath
        });
      }
    }
    return found;
  };

  const localGgufs = scanLocalGgufs(modelsDir);
  const modelNames = new Set();
  localGgufs.forEach(m => {
    const pathParts = m.relPath.replace(/\\/g, '/').split('/');
    if (pathParts.length > 1) {
      // For downloaded Cookbook models, the folder name is the stable model id
      // llama-server router exposes. Avoid seeding filename and relpath aliases
      // because the chat picker shows each cached_model entry as a separate row.
      modelNames.add(pathParts[0]);
    } else {
      modelNames.add(m.file.replace(/\.gguf$/i, ''));
    }
  });
  const modelsToSeed = Array.from(modelNames);

  seedPortableEndpoint(pythonExe, odysseusDir, {
    name: 'Odysseus Portable LLM',
    baseUrl: 'http://127.0.0.1:8080/v1',
    oldBaseUrls: ['http://localhost:8080/v1'],
    models: modelsToSeed,
    endpointKind: 'local',
    supportsTools: true
  });

  console.log('\n[Inference] Starting llama-server on port 10086...');
  let ngl = 0;
  if (hw.gpuBackend === 'cuda' || hw.gpuBackend === 'vulkan' || hw.gpuBackend === 'metal') {
    ngl = 99;
    console.log('[Inference] GPU acceleration enabled (offloading all layers via -ngl 99).');
  } else {
    console.log('[Inference] Running on CPU (0 layers offloaded).');
  }

  const envPath = llamaDir + path.delimiter + process.env.PATH;
  const logStream = context.combinedLogStream || fs.createWriteStream(path.join(logsDir, 'llama.log'), { flags: 'w' });

  const llamaProcess = spawn(llamaExePath, [
    '--port', '10086',
    '--models-dir', modelsDir,
    '--models-max', '1',
    '--ctx-size', '4096',
    '--threads', '4',
    '-ngl', String(ngl)
  ], {
    cwd: projectRoot,
    env: { ...process.env, PATH: envPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  llamaProcess.stdout.pipe(logStream, { end: false });
  llamaProcess.stderr.pipe(logStream, { end: false });

  // Stream parsers to log model loading/unloading status in real-time to the terminal console
  let currentlyLoadedModel = '';
  const handleLlamaLine = (line) => {
    if (line.includes('ensure_model: model name=') && line.includes('is not loaded, loading')) {
      const match = line.match(/ensure_model:\s+model\s+name=([^\s]+)\s+is/);
      if (match) {
        const modelName = match[1];
        if (currentlyLoadedModel && currentlyLoadedModel !== modelName) {
          console.log(`[Inference] Unloading previous model (${currentlyLoadedModel}) from memory/VRAM.`);
        }
        currentlyLoadedModel = modelName;
        console.log(`\n[Inference] Loading model: ${modelName} into VRAM...`);
      }
    } else if (line.includes('load_model: loading model')) {
      const match = line.match(/load_model:\s+loading\s+model\s+'([^']+)'/);
      if (match) {
        const modelName = path.basename(match[1]);
        const cleanName = modelName.replace('.gguf', '');
        if (!currentlyLoadedModel || !currentlyLoadedModel.includes(cleanName)) {
          if (currentlyLoadedModel && !currentlyLoadedModel.includes(cleanName)) {
            console.log(`[Inference] Unloading previous model (${currentlyLoadedModel}) from memory/VRAM.`);
          }
          currentlyLoadedModel = modelName;
          console.log(`\n[Inference] Loading model: ${modelName} into VRAM...`);
        }
      }
    } else if (line.includes('failed to fit params to free device memory')) {
      console.log('[Inference] Warning: Failed to fit model in GPU VRAM. Falling back to CPU/hybrid mode.');
    } else if (line.includes('llama_server: model loaded') || (line.includes('model loaded') && line.includes('llama_server'))) {
      console.log('[Inference] Model successfully loaded and ready.');
    } else if (line.includes('free') && (line.includes('model') || line.includes('slot') || line.includes('evict'))) {
      console.log('[Inference] Unloading/evicting previous model from memory/VRAM.');
    }
  };

  let bufferStdout = '';
  llamaProcess.stdout.on('data', (chunk) => {
    bufferStdout += chunk.toString();
    const lines = bufferStdout.split(/\r?\n/);
    bufferStdout = lines.pop();
    for (const line of lines) {
      handleLlamaLine(line);
    }
  });

  let bufferStderr = '';
  llamaProcess.stderr.on('data', (chunk) => {
    bufferStderr += chunk.toString();
    const lines = bufferStderr.split(/\r?\n/);
    bufferStderr = lines.pop();
    for (const line of lines) {
      handleLlamaLine(line);
    }
  });

  const proxyServer = startProxy(8080, 10086);

  console.log('[Inference] Waiting for llama-server to initialize...');
  await waitPort(10086);
  console.log('[Inference] llama-server is ready and listening.');

  return {
    label: 'llama.cpp',
    env: { ...process.env, PATH: envPath },
    processes: [{ name: 'llama-server', process: llamaProcess }],
    servers: [{ name: 'llama proxy', server: proxyServer }]
  };
}
