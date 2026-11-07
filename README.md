# REA - Reverse Engineer Anything

REA is a local-first, multi-engine reverse-engineering platform, native desktop workbench, browser WebAssembly inspector, command-line toolkit, and Model Context Protocol (MCP) server built for security researchers, reverse engineers, and autonomous coding agents.

Version 7.0.1 unifies a 13-crate native Rust architecture (`rea`, `rea-cli`, `rea-web`) with the Node.js/TypeScript CLI and MCP runtime (`rea-agents`). It provides zero-dependency pure-Rust binary parsing, multi-architecture disassembly, clean-room Pseudo-C decompilation, hash-chained evidence ledgers, 302 reverse-engineering tools, and headless integration with Ghidra, Rizin, Radare2, Cutter, Frida, ADB, and GDB/LLDB.

Live Web Edition: https://aetherx86.github.io/rea/

---

## Comparison: REA vs. Traditional Tools

| Capability                                                       |             REA 7.0              |     Ghidra GUI     |      IDA Pro       | Standalone Rizin / r2 |
| :--------------------------------------------------------------- | :------------------------------: | :----------------: | :----------------: | :-------------------: |
| **Target Auto-Discovery** (App name or `.app` bundle)            |         Yes (Automated)          | No (Manual import) | No (Manual import) |    No (Path only)     |
| **Application Bundle Inventory** (Assets, manifests, dylibs)     |         Yes (Automated)          |         No         |         No         |          No           |
| **Built-in Pure-Rust Disassembler & Pseudo-C Decompiler**        | Yes (x86_64, ARM64, RISC-V, BPF) |  Java decompiler   |    Proprietary     |   Requires plugins    |
| **Clean-Room & Deep Analysis Modes**                             |     Enforced at engine level     |         No         |         No         |          No           |
| **Hash-Chained Evidence Ledger** (Observed / Derived / Inferred) |             Built-in             |         No         |         No         |          No           |
| **Autonomous Agent / MCP Support** (302 MCP & CLI tools)         |        Native Rust & Node        |         No         | Third-party plugin |          No           |
| **Multi-Engine Pipeline** (Built-in + Rizin + Ghidra + Frida)    |             Unified              |    Ghidra only     |      IDA only      |      Rizin only       |
| **Native Desktop GUI + Browser WebAssembly Edition**             |      Yes (`eframe` / WGPU)       |   Swing Desktop    |     Qt Desktop     |      Cutter GUI       |
| **Licensing & Privacy**                                          |        Open Source (MIT)         |    Open Source     |    Proprietary     |  Open Source (LGPL)   |

---

## Architecture Overview

REA 7.0 is organized into a layered Rust workspace alongside the TypeScript/Node.js runtime:

### Rust Workspace Crates (`crates/` and `apps/`)

- **Layer 0 - Foundational Formats & Evidence (`crates/evidence`, `crates/formats`):**
  - `rea-evidence`: Confidence-tagged (`Observed`, `Derived`, `Inferred`) findings and append-only SHA-256 hash-chained evidence ledgers.
  - `rea-formats`: Pure-Rust, zero-unsafe parsers for Mach-O (thin and universal FAT), ELF, PE/COFF, Minidump, ELF Core, Android APK/AXML/ARSC/DEX, Java `.class`/JAR, .NET CLI/CIL metadata, Python `.pyc` and PyInstaller archives, WebAssembly modules, Electron ASAR, Unity AssetBundles and serialized assets, Unreal `.pak` and IoStore `.utoc`/`.ucas`, Godot `.pck`, RPG Maker archives, Apple `Info.plist`/binary plist/CodeDirectory/CMS signatures, `Assets.car`, Nib/Storyboard archives, GGUF/SafeTensors/ONNX model headers, SQLite databases, PCAP/PCAPNG captures, DWARF debug info, and firmware filesystems (SquashFS, CramFS, RomFS, JFFS2, UBI/UBIFS, Ext2/3/4, TAR, CPIO, ZIP).
- **Layer 1 - Static Code Engines (`crates/disasm`, `crates/js`):**
  - `rea-disasm`: Multi-architecture instruction decoder (`x86`, `x86_64`, `ARM64`, `ARMv7`/Thumb, `RISC-V`, `MIPS`, `PowerPC`, `eBPF`/`sBPF`), control-flow graph recovery, cross-reference indexer, and structured clean-room Pseudo-C decompiler (`lift`).
  - `rea-js`: JavaScript/TypeScript AST analyzer, source-map reconstructor, webpack/vite/esbuild bundle unpacker, and control-flow tracer.
- **Layer 2 - Domain Analysis & Platform Sandbox (`crates/analysis`, `crates/platform`):**
  - `rea-analysis`: Native triage, call-graph and data-type reconstruction, Java/DEX/CIL bytecode decompilers, application graph projection, and clean-room specification synthesis.
  - `rea-platform`: Subprocess sandboxing, cancellation, process-tree management, and OS keychain integration.
- **Layer 3 - External Engine Adapters (`crates/engines`):**
  - `rea-engines`: Headless Ghidra bridge (`ReaBridge.java`, `ReaFastAnalysis.java`), Rizin/Radare2 runner, Frida instrumentation bridge, ADB device controller, GDB/LLDB/Rizin debug sessions, and Unity/Unreal/Godot engine detectors.
- **Layer 4 - Core Session & Tool Registry (`crates/engine`):**
  - `rea-engine`: Project workspaces (`*.rea` directories with `rea.json` manifests), Clean-Room vs. Deep mode enforcement, and the unified 302-tool registry.
- **Layer 5 - AI, MCP Server & Setup (`crates/ai`, `crates/mcp`, `crates/setup`):**
  - `rea-ai`: Multi-provider agent orchestration and clean-room rebuild pipelines.
  - `rea-mcp`: High-speed stdio MCP server exposing all 302 tools with toolset filtering and restricted-mode sandboxing.
  - `rea-setup`: Client registration and `doctor` diagnostics.
- **Layer 6 & 7 - Applications (`crates/ui-egui`, `apps/rea`, `apps/rea-cli`, `apps/rea-web`):**
  - `rea`: Native GPU-accelerated desktop workbench (`eframe` / `wgpu`) with 12-language localization.
  - `rea-cli`: Command-line interface exposing all 302 tools, `disassemble`, `triage`, `report`, `rebuild`, `mcp`, `setup`, and `doctor`.
  - `rea-web`: Client-side WebAssembly binary triage, disassembler, and Pseudo-C decompiler running entirely in the browser.

---

## Key Capabilities

### 1. One-Command Disassembly & Pseudo-C Decompilation (`rea disassemble`)

Run `rea disassemble <target>` (or `rea-cli disassemble <target>`) and REA will:

- Automatically locate the executable across macOS application directories (`/Applications`, `/System/Applications`, `~/Applications`), developer workspaces (`~/Documents`), and system paths.
- Parse application bundles (`.app`) to catalog all manifests (`Info.plist`), asset catalogs (`Assets.car`), embedded dynamic libraries (`.dylib`, `.framework`), and resource files.
- Compute cryptographic SHA-256 digests and Shannon byte entropy across the binary image.
- Disassemble the opcode and instruction stream into readable assembly (`disassembly.asm`).
- Lift discovered functions into structured, clean-room Pseudo-C (`pseudocode.c`).
- Map and index all symbol names, entry points, and procedure offsets (`functions.txt`, `overview.json`).
- Export all artifacts cleanly into `./disassembly_<target>/`.

### 2. Clean-Room Mode vs. Deep Mode

REA enforces a strict separation between clean-room behavioral observation and deep static code inspection:

- **Clean-Room Mode (`--clean-room`):** Observes only external behavior, public interfaces, and black-box inputs/outputs without reading internal proprietary code or decompiling target binaries.
- **Deep Mode (`--deep`):** Unlocks full instruction disassembly, Pseudo-C lifting, Ghidra headless decompilation, bytecode recovery, and internal container extraction.

### 3. Comprehensive Artifact Extraction

Each disassembly run exports structured, versionable artifacts:

- `disassembly.asm`: Complete disassembly of code sections with address offsets and instruction mnemonics.
- `pseudocode.c`: Structured clean-room Pseudo-C decompilation of discovered procedures.
- `functions.txt`: List of all detected symbols, functions, sizes, instruction counts, and entry points.
- `components.json`: Full catalog of application bundle resources, manifests, libraries, and assets.
- `metadata.txt`: Architecture, endianness, file format, binary size, SHA-256 digest, and Shannon entropy.
- `overview.json`: Full structured analysis report (imports, exports, sections, strings, entitlements, and security mitigations).

---

## Requirements

### Operating System

- macOS 14+ (Apple Silicon arm64 or Intel x86_64)
- Linux (x86_64 or aarch64)
- Windows 10/11 (x86_64 or ARM64)

### Software Prerequisites

- **Rust Toolchain:** Rust 1.85+ (`cargo`, `rustfmt`, `clippy`) for building the native Rust workspace
- **Node.js:** v22.x or newer (npm 10+) for the TypeScript CLI and MCP package
- **Optional External Engines:**
  - **Java Development Kit:** OpenJDK 21+ (for Ghidra headless decompilation)
  - **Ghidra:** Version 11.x or 12.x
  - **Rizin / Radare2:** Current stable release
  - **Cutter:** Optional, for interactive GUI sessions

To install optional external engines on macOS via Homebrew:

```bash
brew install rust node openjdk ghidra rizin
brew install --cask cutter
```

---

## Installation & Bootstrapping

### Fast Bootstrap

```bash
git clone https://github.com/Aetherx86/rea.git
cd rea
./bootstrap.sh
```

### Build the Native Rust Workspace

```bash
# Build the CLI, desktop app, and all 13 crates
cargo build --workspace --release

# Run the native CLI directly
./target/release/rea-cli --help
./target/release/rea-cli commands
```

### Build the Node.js CLI & MCP Package

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

### 1. Disassemble and Decompile Applications and Binaries

#### Disassemble by Application Name

REA searches system and user application paths automatically:

```bash
# Disassemble a user app in ~/Documents or /Applications
rea disassemble Tangerine

# Disassemble a built-in macOS system app
rea disassemble Calculator
```

#### Disassemble by File Path

Pass an exact Mach-O, ELF, PE, or WebAssembly binary, or a `.app` bundle directory:

```bash
# Disassemble and decompile a system utility
rea disassemble /bin/ls

# Disassemble using the pure-Rust engine directly
rea-cli disassemble /bin/ls --output ./disassembly_ls
```

#### Disassemble a Single Function

Isolate a specific procedure or symbol by name or address:

```bash
rea disassemble /bin/ls --function _main
rea-cli disassemble /bin/ls --function 0x100003ab0
```

#### Disassembly Options

- `--output <dir>`: Custom destination directory for exported artifacts (defaults to `./disassembly_<target>`).
- `--limit <n>`: Limit terminal preview output to `n` lines (default: 40).
- `--no-save`: Preview disassembly and Pseudo-C in terminal without creating an output folder on disk.
- `--no-decompile`: Skip Pseudo-C generation and emit assembly only.
- `--function <name|addr>`: Target a single function or symbol.
- `--format <json|yaml|md|toon>`: Output structured metadata in the specified format.

### 2. Native Triage, Reporting, and 302-Tool CLI (`rea-cli`)

```bash
# Fast static triage of any binary, package, archive, or firmware image
rea-cli triage /bin/ls

# Generate a self-contained Markdown or HTML investigation report
rea-cli report /bin/ls --out report.md
rea-cli report /bin/ls --html --out report.html

# Run any of the 302 registered tools directly from the command line
rea-cli native-triage /bin/ls
rea-cli native-decompile /bin/ls --function _main
rea-cli format-detect /path/to/artifact

# Start the stdio MCP server for coding agents
rea-cli mcp
```

### 3. Deep Decompilation with Ghidra

```bash
# Decompile entry point or main procedure via Ghidra
rea decompile /path/to/binary _main --provider ghidra

# Decompile by procedure address
rea decompile /path/to/binary 0x100001ab8 --provider ghidra
```

### 4. Direct Rizin / Radare2 Commands

```bash
# Show binary information
rea execute-rizin-command "iI" /bin/ls

# List functions and basic blocks
rea execute-rizin-command "aa; afl" /bin/ls
```

---

## Testing & Quality Verification

### Rust Workspace Verification (`xtask` and `cargo test`)

```bash
# Check crate layer boundaries, lockfiles, localization coverage, and schemas
cargo xtask layers
cargo xtask locks
cargo xtask i18n-coverage
cargo xtask schemas --check
cargo xtask tools --check

# Run formatting, clippy lints, and unit/integration tests
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p rea-cli -p rea-web -p rea-disasm -p rea-formats -p rea-analysis
```

### Node.js / TypeScript Verification

```bash
# Disassembly CLI boundary tests
npx vitest run tests/boundary/cli/disassembleCli.test.ts

# Standalone multi-binary test suite
node scripts/test-disassembly-suite.mjs

# Fast typecheck and linting gate
npm run check:fast
```

---

## Project Structure

- `Cargo.toml`: Rust workspace manifest covering all 13 `rea-*` crates and 3 native/web applications
- `apps/rea/`: Native GPU-accelerated desktop workbench (`eframe` / `wgpu`)
- `apps/rea-cli/`: Native command-line interface, `disassemble` engine, and stdio MCP server
- `apps/rea-web/`: Browser WebAssembly binary triage, disassembler, and Pseudo-C viewer
- `crates/evidence/`: Hash-chained evidence ledger and confidence types
- `crates/formats/`: Pure-Rust parsers for executable, archive, mobile, game, and firmware formats
- `crates/disasm/`: Multi-architecture disassembler, CFG builder, and Pseudo-C decompiler
- `crates/js/`: JavaScript/TypeScript bundle analyzer and source-map recovery engine
- `crates/analysis/`: Native triage, bytecode decompilers, and clean-room reconstruction analysis
- `crates/platform/`: Process sandboxing, cancellation, and keychain integration
- `crates/engines/`: External adapters for Ghidra, Rizin, Frida, ADB, and GDB/LLDB
- `crates/engine/`: Session state, `.rea` project folders, and the 302-tool registry
- `crates/ai/`: Agent orchestration and clean-room rebuild workflows
- `crates/mcp/`: Model Context Protocol stdio server
- `crates/setup/`: Agent registration and diagnostic checks
- `crates/ui-egui/`: Desktop workbench UI views and headless parity tests
- `crates/testkit/`: Synthetic binary, archive, and firmware test generators
- `xtask/`: Workspace architecture, lockfile, schema, and localization verification tasks
- `src/`: Node.js/TypeScript CLI (`rea`) and MCP tool definitions
- `docs/tools.md`: Complete catalog of all 302 tools across 25 toolsets
- `docs/schemas/`: JSON Schemas for `rea.json`, build progress, mechanics, and self-test manifests

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
