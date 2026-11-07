# Changelog

All notable changes to this project are documented in this file.

## [7.0.1] - 2026-11-07

### Fixes & Improvements
- Added stripped-binary entry-point fallback in `rea-cli disassemble` so binaries with no symbol table or function boundaries still emit entry-region assembly and Pseudo-C stubs.
- Updated `bootstrap.sh` to automatically compile the native Rust `rea-cli` release binary when `cargo` is available.

## [7.0.0] - 2026-11-07

### Features
- Integrated the 13-crate native Rust architecture (`rea-evidence`, `rea-formats`, `rea-disasm`, `rea-js`, `rea-analysis`, `rea-platform`, `rea-engines`, `rea-engine`, `rea-ai`, `rea-mcp`, `rea-setup`, `rea-ui-egui`, `rea-testkit`) and 3 native/web applications (`rea`, `rea-cli`, `rea-web`).
- Added pure-Rust multi-architecture instruction decoding (`x86`, `x86_64`, `ARM64`, `ARMv7`/Thumb, `RISC-V`, `MIPS`, `PowerPC`, `eBPF`/`sBPF`), CFG recovery, and structured clean-room Pseudo-C decompilation (`rea_disasm::pseudo::lift`).
- Added pure-Rust `rea-cli disassemble <target>` command and upgraded `rea disassemble <target>` with SHA-256 hashing, Shannon entropy calculation, Android DEX detection, and automatic `pseudocode.c` generation.
- Upgraded `rea-web` WebAssembly workbench to display discovered functions, assembly instructions, and clean-room Pseudo-C decompilation directly in the browser.
- Expanded the tool registry to 302 tools across 25 toolsets (`docs/tools.md`) with JSON Schema validation (`docs/schemas/`).

## [1.0.0] - 2026-10-28

### Features
- Automated `rea disassemble <target>` command for automatic application discovery, component file cataloging, and opcode extraction.
- Native Ghidra 12.2 headless decompilation engine replacing proprietary disassemblers on Apple Silicon and modern architectures.
- High-speed Rizin and Radare2 disassembly integration.
- Interactive Cutter GUI synchronization bridge.
- Standalone multi-binary test suite in `scripts/test-disassembly-suite.mjs`.
- Comprehensive CLI boundary tests in `tests/boundary/cli/disassembleCli.test.ts`.
- One-command turnkey installer in `bootstrap.sh`.
