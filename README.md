# Odysseus API-Only Mode

**A portable, API-first fork of [Odysseus](https://github.com/PromtEngineer/Odysseus) without local LLM dependencies.**

---

## ⚡ What's Different?

This fork removes:
- ❌ Ollama integration
- ❌ llama.cpp / llama-server binaries
- ❌ Cookbook UI for local model management
- ❌ Model download prompts

This fork keeps:
- ✅ Portable Node.js + Python runtime bootstrap
- ✅ Odysseus repository auto-clone and database seeding
- ✅ Full RAG capabilities via API-based LLMs
- ✅ API key configuration for OpenAI, Anthropic, and other providers

---

## 🚀 Quick Start

### 1. Clone and Run

```bash
git clone https://github.com/tertua/odysseus-api-mode.git
cd odysseus-api-mode
```

**Windows:**
```cmd
start.bat
```

**macOS/Linux:**
```bash
chmod +x start.sh
./start.sh
```

### 2. Configure API Keys

After first launch, open the Odysseus web interface at:

```
http://localhost:8288
```

Go to **Settings → LLM Configuration** and add your API keys:

- **OpenAI**: `sk-...`
- **Anthropic**: `sk-ant-...`
- **Google AI**: `AIza...`
- **Other providers**: Follow provider-specific setup

### 3. Start Chatting

No model downloads required — all inference happens via API calls.

---

## 📦 What Gets Downloaded?

On first run, the launcher automatically downloads:

1. **Node.js 22.16.0** (portable)
2. **Python 3.12.9 embedded** (portable, Windows only)
3. **Odysseus source code** (cloned from GitHub)

No LLM binaries or models are downloaded.

---

## 🔧 Configuration

### Environment Variables

You can skip interactive prompts by setting:

```bash
# Optional: Skip admin password prompt
export ODYSSEUS_ADMIN_PASSWORD="your-secure-password"

# Optional: Custom port (default: 8288)
export ODYSSEUS_PORT=8080
```

### Persistent Config

Launcher settings are saved in:

```
.launcher-config.json
```

API keys are stored in Odysseus's database:

```
odysseus/data/odysseus.db
```

---

## 🛠️ Development

### Project Structure

```
odysseus-api-mode/
├── src/
│   ├── start.js              # Main orchestrator
│   ├── bootstrap/
│   │   └── git.js            # Odysseus repo cloning
│   ├── downloader.js         # Runtime dependency downloads
│   └── runtime.js            # Process tracker
├── scripts/                   # Platform-specific helpers
├── start.bat                  # Windows launcher
├── start.sh                   # macOS/Linux launcher
└── README.md
```

### Running from Source

```bash
node src/start.js
```

### Logs

All output is logged to:

```
logs/combined-YYYYMMDD-HHMMSS.log
```

---

## 🆚 Comparison with Original

| Feature | Original | API-Only Fork |
|---------|----------|---------------|
| Local LLM (Ollama) | ✅ | ❌ |
| Local LLM (llama.cpp) | ✅ | ❌ |
| Cookbook UI | ✅ | ❌ |
| API-based LLMs | ✅ | ✅ |
| RAG & Knowledge Base | ✅ | ✅ |
| Portable Runtime | ✅ | ✅ |
| Auto-updates | ✅ | ✅ |

---

## 📝 License

Same as upstream: [MIT License](LICENSE)

---

## 🙏 Credits

- Original project: [PromtEngineer/Odysseus](https://github.com/PromtEngineer/Odysseus)
- Portable launcher concept: [tertua/odysseus-portable](https://github.com/tertua/odysseus-portable)

---

## 🐛 Issues

Report issues at: https://github.com/tertua/odysseus-api-mode/issues
