import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe("rea disassemble target discovery and extraction", () => {
  cliTest("disassembles a system Mach-O binary (/bin/ls)", async ({ cli }) => {
    if (!existsSync("/bin/ls")) return;
    const tempDir = await createTestTempDirectory("rea-test-disasm-ls-");
    const outDir = join(tempDir, "out_ls");

    const result = await cli.run({
      arguments: [
        "disassemble",
        "/bin/ls",
        "--output",
        outDir,
        "--limit",
        "10",
        "--format",
        "json",
      ],
    });

    expect(result.exitCode).toBe(0);
    const parsed = result.json as any;
    expect(parsed.target).toBe("ls");
    expect(parsed.binary_path).toBe("/bin/ls");
    expect(parsed.export_directory).toBe(outDir);
    expect(existsSync(join(outDir, "disassembly.asm"))).toBe(true);
    expect(existsSync(join(outDir, "components.json"))).toBe(true);

    const asm = readFileSync(join(outDir, "disassembly.asm"), "utf8");
    expect(asm.length).toBeGreaterThan(0);
    rmSync(tempDir, { recursive: true, force: true });
  });

  cliTest(
    "disassembles an application bundle with components",
    async ({ cli }) => {
      const tempDir = await createTestTempDirectory("rea-test-bundle-");
      const appDir = join(tempDir, "TestMock.app");
      const macosDir = join(appDir, "Contents", "MacOS");
      const resDir = join(appDir, "Contents", "Resources");
      await mkdir(macosDir, { recursive: true });
      await mkdir(resDir, { recursive: true });

      // Write minimal Mach-O binary
      await writeFile(
        join(macosDir, "TestMock"),
        thinMach(0xfeedfacf, 0x100000c),
      );
      // Write component files: manifest and icon
      await writeFile(
        join(appDir, "Contents", "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>TestMock</string></dict></plist>",
      );
      await writeFile(join(resDir, "AppIcon.icns"), "fake-icon-data");

      const outDir = join(tempDir, "out_bundle");
      const result = await cli.run({
        arguments: [
          "disassemble",
          appDir,
          "--output",
          outDir,
          "--format",
          "json",
        ],
      });

      expect(result.exitCode).toBe(0);
      const parsed = result.json as any;
      expect(parsed.target).toBe("TestMock");
      expect(parsed.component_counts.manifests).toBe(1);
      expect(parsed.component_counts.assets_and_icons).toBe(1);
      expect(existsSync(join(outDir, "components.json"))).toBe(true);

      const compJson = JSON.parse(
        readFileSync(join(outDir, "components.json"), "utf8"),
      );
      expect(compJson.manifests).toContain("Contents/Info.plist");
      expect(compJson.assets_and_icons).toContain(
        "Contents/Resources/AppIcon.icns",
      );

      rmSync(tempDir, { recursive: true, force: true });
    },
  );
});

describe("rea disassemble options and error edge cases", () => {
  cliTest(
    "handles --no-save flag without creating export directory",
    async ({ cli }) => {
      const tempDir = await createTestTempDirectory("rea-test-nosave-");
      const outDir = join(tempDir, "should_not_exist");

      const result = await cli.run({
        arguments: [
          "disassemble",
          "/bin/ls",
          "--output",
          outDir,
          "--no-save",
          "--format",
          "json",
        ],
      });

      expect(result.exitCode).toBe(0);
      const parsed = result.json as any;
      expect(parsed.export_directory).toBeNull();
      expect(existsSync(outDir)).toBe(false);
      expect(parsed.disassembly_preview.length).toBeGreaterThan(0);

      rmSync(tempDir, { recursive: true, force: true });
    },
  );

  cliTest("handles preview line limit option", async ({ cli }) => {
    const result = await cli.run({
      arguments: [
        "disassemble",
        "/bin/ls",
        "--no-save",
        "--limit",
        "5",
        "--format",
        "json",
      ],
    });

    expect(result.exitCode).toBe(0);
    const parsed = result.json as any;
    const lines = parsed.disassembly_preview.split("\n");
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  cliTest(
    "fails gracefully with clean error message when target does not exist",
    async ({ cli }) => {
      const result = await cli.run({
        arguments: [
          "disassemble",
          "DefinitelyNonExistentApp1234567890",
          "--format",
          "json",
        ],
      });

      expect(result.exitCode).not.toBe(0);
      const errOutput = (result.stderr ?? "") + (result.stdout ?? "");
      expect(errOutput).toContain("Could not locate target");
      expect(errOutput).toContain("DefinitelyNonExistentApp1234567890");
    },
  );

  cliTest(
    "fails gracefully when target is a non-executable file",
    async ({ cli }) => {
      const tempDir = await createTestTempDirectory("rea-test-nonexec-");
      const dummyFile = join(tempDir, "dummy.txt");
      await writeFile(
        dummyFile,
        "Hello, this is just plain text, not a binary.",
      );

      const result = await cli.run({
        arguments: ["disassemble", dummyFile, "--format", "json"],
      });

      // Should exit with non-zero or fail disassembly without unhandled crash
      expect(result.exitCode).not.toBe(0);
      rmSync(tempDir, { recursive: true, force: true });
    },
  );

  cliTest(
    "supports disassembling a specific function using --function",
    async ({ cli }) => {
      if (!existsSync("/bin/ls")) return;
      const result = await cli.run({
        arguments: [
          "disassemble",
          "/bin/ls",
          "--function",
          "_main",
          "--no-save",
          "--format",
          "json",
        ],
      });

      expect(result.exitCode).toBe(0);
      const parsed = result.json as any;
      expect(parsed.target).toBe("ls");
      expect(parsed.disassembly_preview).toBeDefined();
    },
  );

  cliTest("handles non-existent function name gracefully", async ({ cli }) => {
    if (!existsSync("/bin/ls")) return;
    const result = await cli.run({
      arguments: [
        "disassemble",
        "/bin/ls",
        "--function",
        "completely_nonexistent_function_symbol_xyz",
        "--no-save",
        "--format",
        "json",
      ],
    });

    expect(result.exitCode).toBe(0);
    const parsed = result.json as any;
    expect(parsed.target).toBe("ls");
    // Should return empty or error message without crash
    expect(parsed.disassembly_preview).toBeDefined();
  });
});
