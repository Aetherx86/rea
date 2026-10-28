#!/usr/bin/env bash
set -e

# ==============================================================================
# REA Bootstrapper
# Installs dependencies, compiles REA, checks engines, and links the CLI.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "  REA (Reverse Engineer Anything) - Bootstrap Installer   "
echo "=========================================================="

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is required but not installed."
    echo "        Please install Node.js (version 22+ or 26+) from https://nodejs.org or via brew."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/^v//')
echo "[+] Detected Node.js v${NODE_VERSION}"

# 2. Check and install npm dependencies
echo "[+] Installing npm dependencies..."
if [ -f "package-lock.json" ]; then
    npm ci
else
    npm install
fi

# 3. Build and compile REA
echo "[+] Compiling REA TypeScript runtime..."
npm run compile

echo "[+] Generating packaged skills and metadata..."
npm run artifacts:skills

# 4. Check Reverse Engineering Engines
echo "[+] Checking analysis engines:"

# Ghidra
if command -v ghidraRun >/dev/null 2>&1 || [ -d "/opt/homebrew/opt/ghidra/libexec" ]; then
    echo "    - Ghidra: INSTALLED"
else
    echo "    - Ghidra: NOT FOUND (Install via: brew install ghidra openjdk)"
fi

# Rizin
if command -v rizin >/dev/null 2>&1; then
    echo "    - Rizin: INSTALLED"
else
    echo "    - Rizin: NOT FOUND (Install via: brew install rizin)"
fi

# Cutter
if [ -d "/Applications/Cutter.app" ] || [ -d "$HOME/Applications/Cutter.app" ]; then
    echo "    - Cutter: INSTALLED"
    # Install bridge if directory exists
    CUTTER_PLUGIN_DIR="$HOME/Library/Application Support/rizin/cutter/plugins/python"
    mkdir -p "$CUTTER_PLUGIN_DIR"
    cp -f "bridge/cutter/rea_bridge.py" "$CUTTER_PLUGIN_DIR/" 2>/dev/null || true
else
    echo "    - Cutter: NOT FOUND (Optional, install via: brew install --cask cutter)"
fi

# 5. Global Link
echo "[+] Linking 'rea' globally via npm link..."
npm link --force 2>/dev/null || true

# 6. Verify with test suite
echo "[+] Running REA self-test suite..."
node scripts/test-disassembly-suite.mjs

echo ""
echo "=========================================================="
echo "  REA is successfully bootstrapped and ready to use!      "
echo "=========================================================="
echo "  Usage examples:"
echo "    rea disassemble Calculator"
echo "    rea disassemble <app_name_or_binary>"
echo "    rea decompile <binary_path> [function] --provider ghidra"
echo "=========================================================="
