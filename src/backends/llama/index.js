import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

import { detectHardware } from '../../system.js';
import { downloadFile, extractArchive, getLlamaCppAssets, printProgressBar } from '../../downloader.js';
import { seedPortableEndpoint } from '../common.js';

const CONTEXT_LADDER = [32768, 24576, 16384, 12288, 8192, 4096, 2048];

function isRetryableMemoryError(statusCode, body) {
  const text = String(body || '').toLowerCase();
  return statusCode >= 500 && (
    text.includes('out of memory') ||
    text.includes('cuda') ||
    text.includes('failed to allocate') ||
    text.includes('failed to create context') ||
    text.includes('failed to initialize the context')
  );
}

function startProxy(localPort, router) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => forwardRequest(Buffer.concat(chunks), false));

    const forwardRequest = (body, retried) => {
    const options = {
      hostname: '127.0.0.1',
      port: router.port,
      path: req.url,
      method: req.method,
      headers: req.headers
    };
    if (body.length) options.headers['content-length'] = body.length;

    const proxyReq = http.request(options, (proxyRes) => {
      if (proxyRes.statusCode < 500) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
        return;
      }
      const errorChunks = [];
      proxyRes.on('data', chunk => errorChunks.push(chunk));
      proxyRes.on('end', async () => {
        const errorBody = Buffer.concat(errorChunks);
        if (!retried && isRetryableMemoryError(proxyRes.statusCode, errorBody) && await router.retryLowerContext()) {
          forwardRequest(body, true);
          return;
        }
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(errorBody);
      });
    });

    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Bad Gateway: Failed to connect to llama-server on port ${router.port}`);
    });

    proxyReq.end(body);
    };
  });

  server.listen(localPort, '127.0.0.1', () => {
    console.log(`[Proxy] Headless API proxy listening on http://127.0.0.1:${localPort} (forwarding to llama.cpp router)`);
  });

  return server;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bytesToGB(bytes) {
  return bytes / (1024 ** 3);
}

function chooseAutoContext({ hw, localGgufs, parallel }) {
  const override = positiveInt(process.env.ODYSSEUS_LLAMA_CTX, 0);
  if (override) {
    const idx = CONTEXT_LADDER.findIndex(v => v <= override);
    return {
      ctx: override,
      ladderIndex: idx >= 0 ? idx : CONTEXT_LADDER.length - 1,
      reason: 'environment override'
    };
  }

  const largestModelGB = localGgufs.reduce((max, m) => Math.max(max, bytesToGB(m.size || 0)), 0);
  const memoryGB = hw.gpuBackend === 'cpu'
    ? hw.ramGB
    : (hw.gpuFreeMemoryGB || hw.gpuMemoryGB || Math.max(4, Math.floor(hw.ramGB * 0.55)));
  const overheadGB = hw.gpuBackend === 'cpu' ? 2 : 2.5;
  const usableGB = Math.max(0, memoryGB - largestModelGB - overheadGB);
  const kvPer4096GB = largestModelGB >= 5.5 ? 1.05 : largestModelGB >= 4 ? 0.85 : 0.55;
  const estimatedMaxCtx = Math.floor((usableGB / Math.max(kvPer4096GB, 0.25)) * 4096 / Math.max(parallel, 1));
  let ladderIndex = CONTEXT_LADDER.findIndex(ctx => ctx <= estimatedMaxCtx);
  if (ladderIndex === -1) ladderIndex = CONTEXT_LADDER.length - 1;
  return {
    ctx: CONTEXT_LADDER[ladderIndex],
    ladderIndex,
    reason: `${memoryGB.toFixed(1)} GB ${hw.gpuBackend === 'cpu' ? 'RAM' : 'free/usable VRAM'}, largest GGUF ${largestModelGB.toFixed(1)} GB`
  };
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
          path: fullPath,
          size: fs.statSync(fullPath).size
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
  const parallel = positiveInt(process.env.ODYSSEUS_LLAMA_PARALLEL, 1);
  const selectedContext = chooseAutoContext({ hw, localGgufs, parallel });
  let contextLadderIndex = selectedContext.ladderIndex;
  console.log(`[Inference] llama.cpp auto-context: ${selectedContext.ctx} tokens, parallel slots: ${parallel} (${selectedContext.reason}).`);

  // Stream parsers to log model loading/unloading status in real-time to the terminal console
  let currentlyLoadedModel = '';
  const modelIdFromPath = (modelPath) => {
    const rel = path.relative(modelsDir, modelPath).replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    if (parts.length > 1 && !parts[0].startsWith('..')) return parts[0];
    return path.basename(modelPath).replace(/\.gguf$/i, '');
  };
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
        const modelName = modelIdFromPath(match[1]);
        if (!currentlyLoadedModel || currentlyLoadedModel !== modelName) {
          if (currentlyLoadedModel && currentlyLoadedModel !== modelName) {
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

  let llamaProcess = null;
  let restarting = false;
  const startRouter = async (ctxSize) => {
    currentlyLoadedModel = '';
    const proc = spawn(llamaExePath, [
      '--port', '10086',
      '--models-dir', modelsDir,
      '--models-max', '1',
      '--parallel', String(parallel),
      '--ctx-size', String(ctxSize),
      '--threads', '4',
      '-ngl', String(ngl)
    ], {
      cwd: projectRoot,
      env: { ...process.env, PATH: envPath },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    llamaProcess = proc;
    context.runtimeTracker?.register('llama-server', proc, [10086]);

    proc.stdout.pipe(logStream, { end: false });
    proc.stderr.pipe(logStream, { end: false });

    let bufferStdout = '';
    proc.stdout.on('data', (chunk) => {
    bufferStdout += chunk.toString();
    const lines = bufferStdout.split(/\r?\n/);
    bufferStdout = lines.pop();
    for (const line of lines) {
        handleLlamaLine(line);
      }
    });

    let bufferStderr = '';
    proc.stderr.on('data', (chunk) => {
    bufferStderr += chunk.toString();
    const lines = bufferStderr.split(/\r?\n/);
    bufferStderr = lines.pop();
    for (const line of lines) {
        handleLlamaLine(line);
      }
    });
    await waitPort(10086);
    return proc;
  };

  await startRouter(selectedContext.ctx);

  const router = {
    port: 10086,
    async retryLowerContext() {
      if (restarting || contextLadderIndex >= CONTEXT_LADDER.length - 1) return false;
      restarting = true;
      contextLadderIndex += 1;
      const nextCtx = CONTEXT_LADDER[contextLadderIndex];
      console.warn(`[Inference] llama.cpp model load hit memory pressure. Restarting router with lower context: ${nextCtx} tokens...`);
      try {
        if (llamaProcess) {
          context.runtimeTracker?.terminate?.(llamaProcess.pid);
          llamaProcess = null;
        }
        await startRouter(nextCtx);
        console.warn(`[Inference] llama.cpp router restarted at ${nextCtx} context. Retrying request once.`);
        return true;
      } catch (err) {
        console.warn(`[Inference] Failed to restart llama.cpp router at ${nextCtx}: ${err.message}`);
        return false;
      } finally {
        restarting = false;
      }
    }
  };

  const proxyServer = startProxy(8080, router);

  console.log('[Inference] Waiting for llama-server to initialize...');
  console.log('[Inference] llama-server is ready and listening.');

  return {
    label: 'llama.cpp',
    env: { ...process.env, PATH: envPath },
    processes: [{
      name: 'llama-server',
      get process() {
        return llamaProcess;
      }
    }],
    servers: [{ name: 'llama proxy', server: proxyServer }]
  };
}
