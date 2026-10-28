#!/usr/bin/env node

/**
 * Multi-target test suite for REA Disassembly and Reverse Engineering capabilities.
 * Tests multiple binary architectures, formats, bundles, and edge cases.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REA_CLI = join(import.meta.dirname, "rea.mjs");
const tempSuiteDir = join(tmpdir(), `rea-suite-${Date.now()}`);
mkdirSync(tempSuiteDir, { recursive: true });

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  process.stdout.write(`[TEST] ${name} ... `);
  try {
    fn();
    console.log("PASSED");
    passed++;
  } catch (err) {
    console.log("FAILED");
    console.error(`       Error: ${err.message}`);
    failed++;
  }
}

function execRea(args, expectFail = false) {
  try {
    const stdout = execFileSync("node", [REA_CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    if (expectFail) {
      return {
        ok: false,
        stdout: err.stdout?.toString() ?? "",
        stderr: err.stderr?.toString() ?? "",
      };
    }
    throw new Error(
      `Command failed: rea ${args.join(" ")}\n${err.stderr?.toString() || err.message}`,
    );
  }
}

console.log("=================================================");
console.log("  REA Multi-Binary Reverse Engineering Test Suite");
console.log("=================================================");

// Test 1: CLI binary (/bin/ls)
runTest("Disassemble system CLI binary (/bin/ls)", () => {
  if (!existsSync("/bin/ls")) return;
  const outDir = join(tempSuiteDir, "out_ls");
  const res = execRea([
    "disassemble",
    "/bin/ls",
    "--output",
    outDir,
    "--format",
    "json",
  ]);
  const data = JSON.parse(res.stdout);
  if (data.target !== "ls")
    throw new Error(`Unexpected target: ${data.target}`);
  if (!existsSync(join(outDir, "disassembly.asm"))) {
    throw new Error("disassembly.asm was not created");
  }
  const asm = readFileSync(join(outDir, "disassembly.asm"), "utf8");
  if (!asm.includes("mach-o") && !asm.includes("section")) {
    throw new Error(
      "Disassembly output missing expected Mach-O section header",
    );
  }
});

// Test 2: System Application Bundle (/System/Applications/Calculator.app)
runTest("Disassemble macOS System App Bundle (Calculator.app)", () => {
  if (!existsSync("/System/Applications/Calculator.app")) return;
  const outDir = join(tempSuiteDir, "out_calc");
  const res = execRea([
    "disassemble",
    "Calculator",
    "--output",
    outDir,
    "--format",
    "json",
  ]);
  const data = JSON.parse(res.stdout);
  if (data.target !== "Calculator")
    throw new Error(`Unexpected target: ${data.target}`);
  if (data.component_counts.manifests < 1) {
    throw new Error("Failed to catalog Calculator bundle manifests");
  }
  if (!existsSync(join(outDir, "components.json"))) {
    throw new Error("components.json missing");
  }
  const comp = JSON.parse(
    readFileSync(join(outDir, "components.json"), "utf8"),
  );
  if (!Array.isArray(comp.manifests) || comp.manifests.length === 0) {
    throw new Error("Manifests array in components.json is empty");
  }
});

// Test 3: Function extraction with --function
runTest("Disassemble specific function (_main) with --function", () => {
  const res = execRea([
    "disassemble",
    "/bin/ls",
    "--function",
    "_main",
    "--no-save",
    "--format",
    "json",
  ]);
  const data = JSON.parse(res.stdout);
  if (!data.disassembly_preview) {
    throw new Error("Missing disassembly_preview");
  }
});

// Test 4: Line preview limits with --limit
runTest("Preview limit flag (--limit 3)", () => {
  const res = execRea([
    "disassemble",
    "/bin/ls",
    "--limit",
    "3",
    "--no-save",
    "--format",
    "json",
  ]);
  const data = JSON.parse(res.stdout);
  const lines = data.disassembly_preview.split("\n");
  if (lines.length > 3) {
    throw new Error(`Expected at most 3 lines, got ${lines.length}`);
  }
});

// Test 5: Edge case - Non-existent binary
runTest("Handle non-existent binary gracefully", () => {
  const res = execRea(["disassemble", "NonExistentBinaryName_9999"], true);
  if (res.ok) throw new Error("Expected command to fail on missing target");
  const combined = res.stderr + res.stdout;
  if (!combined.includes("Could not locate target")) {
    throw new Error(`Expected error message not found in output: ${combined}`);
  }
});

// Test 6: Edge case - Non-executable text file
runTest("Reject non-executable text file", () => {
  const txtFile = join(tempSuiteDir, "sample.txt");
  writeFileSync(txtFile, "plain text not a binary");
  const res = execRea(["disassemble", txtFile], true);
  if (res.ok) throw new Error("Expected command to fail on text file");
  const combined = res.stderr + res.stdout;
  if (!combined.includes("not an executable binary")) {
    throw new Error(
      `Expected 'not an executable binary' message, got: ${combined}`,
    );
  }
});

// Cleanup
rmSync(tempSuiteDir, { recursive: true, force: true });

console.log("-------------------------------------------------");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=================================================");

if (failed > 0) {
  process.exit(1);
}
