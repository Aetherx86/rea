# Changelog

All notable changes to this project are documented in this file.

## [1.0.0] - 2026-10-28

### Features
- Automated `rea disassemble <target>` command for automatic application discovery, component file cataloging, and opcode extraction.
- Native Ghidra 12.2 headless decompilation engine replacing proprietary disassemblers on Apple Silicon and modern architectures.
- High-speed Rizin and Radare2 disassembly integration.
- Interactive Cutter GUI synchronization bridge.
- Standalone multi-binary test suite in `scripts/test-disassembly-suite.mjs`.
- Comprehensive CLI boundary tests in `tests/boundary/cli/disassembleCli.test.ts`.
- One-command turnkey installer in `bootstrap.sh`.
