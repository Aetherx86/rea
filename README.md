# REA - Reverse Engineer Anything

REA is a local-first, multi-engine reverse-engineering platform and CLI application built for security researchers, reverse engineers, and autonomous AI coding agents.

REA unifies automated binary discovery, bundle asset inspection, multi-engine disassembly, and deep decompilation into a single workflow. It integrates Ghidra, Rizin, Radare2, and Cutter, giving you instant opcode extraction in seconds alongside industrial-grade headless decompilation.

---

## Key Capabilities

### 1. One-Command Disassembly (`rea disassemble`)

Reverse engineering an unfamiliar application no longer requires manual binary hunting, unpacking, and command chaining. Run `rea disassemble <target>` and REA will:

- Automatically discover the executable across macOS application directories (`/Applications`, `/System/Applications`, `~/Applications`), developer workspaces (`~/Documents`), and system paths.
- Parse application bundles (`.app`) to catalog all manifests (`Info.plist`), asset catalogs (`Assets.car`), embedded dynamic libraries (`.dylib`, `.framework`), and resource files.
- Disassemble the complete opcode and instruction stream into readable assembly using high-speed native analysis.
- Map and index all symbol names, entry points, and procedure offsets.
- Export all artifacts cleanly into a dedicated `./disassembly_<target>/` directory.

### 2. Multi-Engine Analysis Architecture

REA connects to leading open-source reverse-engineering engines:

- **Ghidra 12.2 Integration:** Deep headless decompilation and data-type reconstruction with native Apple Silicon decompilers, replacing proprietary tools with an open-source pipeline.
- **Rizin and Radare2:** High-performance binary parsing, opcode disassembling, cross-reference mapping, and control-flow graphing in milliseconds.
- **Cutter GUI Bridge:** Direct bridge into Cutter's user interface for visual reverse-engineering sessions, interactive navigation, and live synchronization.

### 3. Comprehensive Artifact Extraction

Each disassembly run exports structured, versionable artifacts:

- `disassembly.asm`: Complete disassembly of code sections with address offsets and instruction mnemonics.
- `functions.txt`: Filtered list of all detected symbols, functions, and entry points.
- `components.json`: Full catalog of application bundle resources, manifests, libraries, and assets.
- `metadata.txt`: Architecture, endianness, file format, binary size, and hashing details.

### 4. Dual CLI and MCP Interface

- **Command-Line Interface:** Unified CLI (`rea`) with JSON, YAML, Markdown, and text output formatting.
- **Model Context Protocol (MCP):** Native MCP server exposing reverse-engineering tools directly to AI coding assistants (Claude Desktop, Antigravity, Cursor, Codex).

---

## Requirements

### Operating System

- macOS 14+ (Apple Silicon arm64 or Intel x86_64)
- Linux (x86_64 or aarch64)

### Software Prerequisites

- **Node.js:** v22.x or v26.x (npm 10+)
- **Java Development Kit:** OpenJDK 25 or newer (required for Ghidra)
- **Ghidra:** Version 12.2 or newer
- **Rizin / Radare2:** Current stable release
- **Cutter:** (Optional, for interactive GUI sessions)

To install all prerequisites on macOS via Homebrew:

```bash
brew install openjdk ghidra rizin
brew install --cask cutter
```

Configure your shell environment in `~/.zshrc`:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"
export GHIDRA_INSTALL_DIR="/opt/homebrew/opt/ghidra/libexec"
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
```

---

## Installation & Bootstrapping

REA provides an automated turnkey bootstrapper that configures dependencies, builds the runtime, verifies engines, and links the CLI globally.

### Fast Bootstrap

```bash
git clone https://gitlab.com/jk9576/rea.git
cd rea
./bootstrap.sh
```

### Manual Build

If you prefer building step-by-step:

```bash
# 1. Install locked dependencies
npm ci

# 2. Compile TypeScript runtime
npm run compile

# 3. Generate packaged metadata and skills
npm run artifacts:skills

# 4. Link binary globally
npm link
```

Verify your installation:

```bash
rea --help
rea doctor
```

---

## Usage Guide

### 1. Disassemble Applications and Binaries

#### Disassemble by Application Name

REA searches system and user application paths automatically:

```bash
# Disassemble a user app in ~/Documents or /Applications
rea disassemble Tangerine

# Disassemble a built-in macOS system app
rea disassemble Calculator
```

#### Disassemble by File Path

Pass an exact Mach-O binary, `.app` bundle directory, or command path:

```bash
# Disassemble a system utility
rea disassemble /bin/ls

# Disassemble a full macOS bundle
rea disassemble /Applications/Safari.app
```

#### Disassemble a Single Function

Isolate a specific procedure or symbol by name or address:

```bash
rea disassemble Tangerine --function _main
rea disassemble /bin/ls --function main
```

#### Disassembly Options

- `--output <dir>`: Custom destination directory for exported artifacts (defaults to `./disassembly_<target>`).
- `--limit <n>`: Limit terminal preview output to `n` lines (default: 40).
- `--no-save`: Preview disassembly in terminal without creating an output folder on disk.
- `--function <name|addr>`: Target a single function or symbol.
- `--format <json|yaml|md|toon>`: Output structured metadata in specified format.

### 2. Deep Decompilation with Ghidra

To produce decompiled C pseudocode using Ghidra's decompiler:

```bash
# Decompile entry point or main procedure
rea decompile /path/to/binary _main --provider ghidra

# Decompile by procedure address
rea decompile /path/to/binary 0x100001ab8 --provider ghidra
```

### 3. Direct Rizin / Radare2 Commands

Execute custom Rizin commands directly against any target binary:

```bash
# Show binary information
rea execute-rizin-command "iI" /bin/ls

# List functions and basic blocks
rea execute-rizin-command "aa; afl" /bin/ls

# Show function call graph
rea execute-rizin-command "aa; agf" /bin/ls
```

### 4. Interactive Cutter Bridge

If Cutter is installed, REA synchronizes sessions with the Cutter UI:

```bash
# Check running Cutter instances
rea list-cutter-sessions

# Send navigation or analysis commands to Cutter
rea cutter-command "s 0x100001ab8"
```

---

## Testing & Quality Assurance

REA includes a multi-target test suite covering Mach-O bundles, dynamic libraries, CLI utilities, edge cases, and failure modes.

### Run the Standalone Multi-Binary Suite

Tests system utilities, app bundles, function filters, preview bounds, and malformed inputs:

```bash
node scripts/test-disassembly-suite.mjs
```

### Run Boundary and Unit Tests

Run the Vitest integration suite:

```bash
# Disassembly CLI boundary tests
npx vitest run tests/boundary/cli/disassembleCli.test.ts

# Fast typecheck and linting gate
npm run check:fast
```

---

## Project Structure

- `bootstrap.sh`: Turnkey bootstrap and setup script
- `package.json`: Node.js dependencies and scripts
- `tsconfig.json`: TypeScript compiler configuration
- `src/cli.ts`: CLI entry point and command registration
- `src/cli/disassembleCommand.ts`: Automated discovery and disassembly logic
- `src/ghidra/GhidraInstallation.ts`: Ghidra detection and bridge runner
- `bridge/ghidra/`: Ghidra headless scripts and bridge
- `bridge/cutter/`: Cutter Python plugin bridge
- `scripts/rea.mjs`: Global executable wrapper
- `scripts/test-disassembly-suite.mjs`: Multi-binary integration test suite
- `tests/boundary/cli/disassembleCli.test.ts`: Vitest test suite for disassembly

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
