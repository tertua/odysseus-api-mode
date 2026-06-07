#!/usr/bin/env bash

# Resolve script directory and change to it
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "==================================================="
echo "  Odysseus Portable Launcher"
echo "==================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in your PATH."
    echo "Please install Node.js from https://nodejs.org/"
    echo "then try launching this script again."
    exit 1
fi

echo "Starting orchestrator..."
node src/start.js
