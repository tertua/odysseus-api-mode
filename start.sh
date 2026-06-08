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
node src/start.js "$@"
exit_code=$?

if [ $exit_code -ne 0 ]; then
    echo
    echo "==================================================="
    echo "  [ERROR] Orchestrator exited with code $exit_code"
    echo "  Please check the logs above or in the 'logs/' folder."
    echo "==================================================="
    read -n 1 -s -r -p "Press any key to exit..."
    echo
    exit $exit_code
fi
