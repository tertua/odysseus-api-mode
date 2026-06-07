# Odysseus Portable AI Workspace

This is a unified, self-contained, 100% portable AI workspace that combines **Odysseus** (a premium self-hosted Claude/ChatGPT-like UI with local agents, calendar, memory, and deep research) and a precompiled **`llama.cpp`** server.

Everything runs locally on your machine with automatic GPU/Metal acceleration, and can be run directly off a USB flash drive.

---

## 📂 Folders & Architecture

```text
Odysseus-Portable/
├── start.bat             # Windows one-click launcher
├── start.sh              # Linux/macOS launcher
├── package.json          # Main Node.js configuration
├── .gitignore            # Ignores models, binaries, and the cloned odysseus directory
├── README.md             # This file
├── src/                  # Unified Launcher Source Code
│   ├── start.js          # Main process orchestrator (clones, seeds db, starts subprocesses)
│   ├── system.js         # Hardware capabilities detector
│   ├── downloader.js     # Binaries downloader
│   └── model.js          # Models scanner & downloader
├── models/               # Shared GGUF models folder (both launcher & Odysseus read here)
├── bin/                  # Precompiled llama-server binaries folder
└── odysseus/             # Cloned Odysseus git repository (kept updated in real-time)
```

---

## 🚀 How to Run

### Windows
Double-click `start.bat` or run:
```cmd
start.bat
```

### Linux & macOS
Make the launcher executable and run:
```bash
chmod +x start.sh
./start.sh
```

---

## 🌟 Key Features

1. **Auto-updating Odysseus**: On startup, the launcher checks for the `./odysseus` directory. If it doesn't exist, it clones it. If it does, it runs `git pull` automatically to ensure you always have the latest features of Odysseus in real-time.
2. **Shared Models Folder**: GGUF files are stored in the root `/models` folder and shared. This prevents duplicate downloads between Odysseus and your launcher, saving massive storage space.
3. **Database Pre-Seeding**: The launcher automatically parses Odysseus's SQLite database (`./odysseus/data/app.db`) and pre-configures your portable `llama.cpp` API endpoint so it works out-of-the-box.
4. **Headless Proxy**: The portable LLM server runs headlessly on port `8080` (proxying to the active `llama-server` on `10086`), while the Odysseus frontend runs on port `7000`. The browser opens directly to `http://localhost:7000`.
