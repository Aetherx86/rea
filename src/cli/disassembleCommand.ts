import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "incur";
import type { Logger } from "pino";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { withCommandCancellation } from "./commandCancellation.js";
import type { CliInstance } from "./types.js";

const execFileAsync = promisify(execFile);

interface ComponentInventory {
  manifests: string[];
  assets_and_icons: string[];
  frameworks_and_bundles: string[];
  embedded_scripts_and_code: string[];
  resources: string[];
}

interface ResolvedTarget {
  name: string;
  binaryPath: string;
  bundleOrProjectDir: string | null;
  componentFiles: ComponentInventory;
}

function isBinaryOrExecutable(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    if ((stat.mode & 0o111) !== 0) return true;
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(4);
    const bytesRead = readSync(fd, buffer, 0, 4, 0);
    closeSync(fd);
    if (bytesRead < 2) return false;
    const magic32 = buffer.readUInt32BE(0);
    const magic16 = buffer.readUInt16BE(0);
    if (
      magic32 === 0xfeedface ||
      magic32 === 0xfeedfacf ||
      magic32 === 0xcefaedfe ||
      magic32 === 0xcffaedfe ||
      magic32 === 0xcafebabe ||
      magic32 === 0xbebafeca ||
      magic32 === 0x7f454c46 ||
      magic32 === 0x0061736d ||
      magic16 === 0x4d5a
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Automatically locate the binary and component files for a target name,
 * directory, or exact binary path.
 */
function resolveAppTarget(target: string): ResolvedTarget {
  const home = process.env.HOME ?? "";
  const candidates: string[] = [];

  if (target.startsWith("/") || target.startsWith(".")) {
    candidates.push(resolve(target));
  } else {
    // Search current directory, Documents, and Applications
    candidates.push(
      resolve(target),
      resolve(`${target}.app`),
      join(home, "Documents", target),
      join(home, "Documents", `${target}.app`),
      `/Applications/${target}.app`,
      join(home, "Applications", `${target}.app`),
      `/Applications/${target}`,
      `/System/Applications/${target}.app`,
      `/System/Applications/Utilities/${target}.app`,
      `/opt/homebrew/bin/${target}`,
      `/usr/local/bin/${target}`,
      `/usr/bin/${target}`,
      `/bin/${target}`,
    );
  }

  let foundPath: string | null = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      foundPath = candidate;
      break;
    }
  }

  if (!foundPath) {
    throw new Error(
      `Could not locate target '${target}'. Checked:\n  ${candidates.join("\n  ")}`,
    );
  }

  const stat = statSync(foundPath);
  let binaryPath: string | null = null;
  let bundleOrProjectDir: string | null = null;
  const targetName = basename(foundPath).replace(/\.app$/, "");

  if (stat.isFile()) {
    if (!isBinaryOrExecutable(foundPath)) {
      throw new Error(
        `Target file '${foundPath}' is not an executable binary or recognized binary target.`,
      );
    }
    binaryPath = foundPath;
    bundleOrProjectDir = dirname(foundPath);
  } else if (stat.isDirectory()) {
    bundleOrProjectDir = foundPath;
    // Check if macOS .app bundle
    const macosDir = join(foundPath, "Contents", "MacOS");
    if (existsSync(macosDir)) {
      const files = readdirSync(macosDir);
      const exe = files.find((f) => f === targetName) ?? files[0];
      if (exe) binaryPath = join(macosDir, exe);
    }

    // Check common Swift/CMake/Go/Rust build outputs
    if (!binaryPath) {
      const buildCandidates = [
        join(foundPath, ".build", "out", "Products", "Release", targetName),
        join(foundPath, ".build", "out", "Products", "Debug", targetName),
        join(foundPath, ".build", "arm64-apple-macosx", "release", targetName),
        join(foundPath, ".build", "arm64-apple-macosx", "debug", targetName),
        join(foundPath, "build", "Release", targetName),
        join(foundPath, "build", targetName),
        join(foundPath, "dist", targetName),
        join(foundPath, "bin", targetName),
        join(foundPath, targetName),
      ];
      for (const bc of buildCandidates) {
        if (existsSync(bc) && statSync(bc).isFile()) {
          binaryPath = bc;
          break;
        }
      }
    }

    // Deep search if still not found
    if (!binaryPath) {
      binaryPath = findExecutableFile(foundPath, targetName);
    }
  }

  if (!binaryPath) {
    throw new Error(`Could not find an executable binary in '${foundPath}'.`);
  }

  // Scan component files
  const componentFiles = bundleOrProjectDir
    ? scanComponentFiles(bundleOrProjectDir)
    : {
        manifests: [],
        assets_and_icons: [],
        frameworks_and_bundles: [],
        embedded_scripts_and_code: [],
        resources: [],
      };

  return {
    name: targetName,
    binaryPath,
    bundleOrProjectDir,
    componentFiles,
  };
}

function findExecutableFile(
  dir: string,
  preferredName: string,
  depth = 0,
): string | null {
  if (depth > 4) return null;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    // First pass: exact name match
    for (const entry of entries) {
      if (entry.isFile() && entry.name === preferredName) {
        return join(dir, entry.name);
      }
    }
    // Second pass: recurse into non-ignored directories
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules" &&
        entry.name !== "Pods"
      ) {
        const found = findExecutableFile(
          join(dir, entry.name),
          preferredName,
          depth + 1,
        );
        if (found) return found;
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return null;
}

function scanComponentFiles(rootDir: string): ComponentInventory {
  const result: ComponentInventory = {
    manifests: [],
    assets_and_icons: [],
    frameworks_and_bundles: [],
    embedded_scripts_and_code: [],
    resources: [],
  };

  function walk(current: string, depth = 0) {
    if (depth > 3) return;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".git") || entry.name === "node_modules")
          continue;
        const fullPath = join(current, entry.name);
        const relPath = fullPath.replace(`${rootDir}/`, "");

        if (entry.isDirectory()) {
          if (
            entry.name.endsWith(".framework") ||
            entry.name.endsWith(".bundle")
          ) {
            result.frameworks_and_bundles.push(relPath);
          } else {
            walk(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (lower.endsWith(".plist") || lower.endsWith(".xcprivacy")) {
            result.manifests.push(relPath);
          } else if (
            lower.endsWith(".car") ||
            lower.endsWith(".icns") ||
            lower.endsWith(".iconset") ||
            lower.endsWith(".png") ||
            lower.endsWith(".svg")
          ) {
            result.assets_and_icons.push(relPath);
          } else if (lower.endsWith(".dylib") || lower.endsWith(".so")) {
            result.frameworks_and_bundles.push(relPath);
          } else if (
            lower.endsWith(".js") ||
            lower.endsWith(".sh") ||
            lower.endsWith(".py") ||
            lower.endsWith(".json")
          ) {
            result.embedded_scripts_and_code.push(relPath);
          } else if (
            current.includes("Resources") ||
            lower.endsWith(".mp3") ||
            lower.endsWith(".wav")
          ) {
            result.resources.push(relPath);
          }
        }
      }
    } catch {
      // Ignore directory scan errors
    }
  }

  walk(rootDir);
  return result;
}

export const registerDisassembleCommand = (
  cli: CliInstance,
  logger: Logger,
): void => {
  cli.command(CLI_COMMANDS.disassemble, {
    description:
      "Automatically discover an application, catalog its components, and disassemble its opcodes and assembly",
    args: z.object({
      target: z
        .string()
        .describe(
          "Application name, bundle directory, or binary path (e.g. 'Tangerine')",
        ),
    }),
    options: z.object({
      output: z
        .string()
        .optional()
        .describe(
          "Directory to export full assembly and components (defaults to ./disassembly_<name>)",
        ),
      function: z
        .string()
        .optional()
        .describe("Disassemble only a specific function by name or address"),
      limit: z
        .number()
        .default(40)
        .describe("Maximum preview lines to show in terminal"),
      save: z
        .boolean()
        .default(true)
        .describe(
          "Whether to write full disassembly and component analysis to disk",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async () =>
        logCliCommand(logger, CLI_COMMANDS.disassemble, async () => {
          const target = resolveAppTarget(args.target);

          // 1. Gather binary metadata using rizin or file
          let binaryInfo = "";
          try {
            const { stdout } = await execFileAsync("rizin", [
              "-N",
              "-q",
              "-e",
              "scr.color=0",
              "-c",
              "iI",
              target.binaryPath,
            ]);
            binaryInfo = stdout;
          } catch {
            const { stdout } = await execFileAsync("file", [target.binaryPath]);
            binaryInfo = stdout;
          }

          // 2. Extract function list
          let functionsList = "";
          try {
            const { stdout } = await execFileAsync("rizin", [
              "-N",
              "-q",
              "-e",
              "scr.color=0",
              "-c",
              "aa; afl",
              target.binaryPath,
            ]);
            functionsList = stdout;
          } catch {
            // Fallback if rizin analysis fails
          }

          // 3. Extract opcodes & assembly
          let disassemblyText = "";
          if (options.function) {
            try {
              const fn = options.function;
              const { stdout } = await execFileAsync("rizin", [
                "-N",
                "-q",
                "-e",
                "scr.color=0",
                "-c",
                `aa; s ${fn} || s sym.${fn} || s sym.imp.${fn}; pdf`,
                target.binaryPath,
              ]);
              disassemblyText = stdout
                .split("\n")
                .filter(
                  (line) =>
                    !line.startsWith("ERROR: Cannot seek to unknown address"),
                )
                .join("\n")
                .trim();
            } catch (err: unknown) {
              disassemblyText = `Failed to disassemble function ${options.function}: ${String(err)}`;
            }
          } else {
            // Disassemble entire binary with objdump or rizin
            try {
              const { stdout } = await execFileAsync(
                "objdump",
                ["-d", target.binaryPath],
                {
                  maxBuffer: 64 * 1024 * 1024,
                },
              );
              disassemblyText = stdout;
            } catch {
              try {
                const { stdout } = await execFileAsync(
                  "rizin",
                  [
                    "-N",
                    "-q",
                    "-e",
                    "scr.color=0",
                    "-c",
                    "pda",
                    target.binaryPath,
                  ],
                  { maxBuffer: 64 * 1024 * 1024 },
                );
                disassemblyText = stdout;
              } catch (err: unknown) {
                disassemblyText = `Disassembly error: ${String(err)}`;
              }
            }
          }

          // 4. Save artifacts to disk
          const outputDir = resolve(
            options.output ?? `./disassembly_${target.name}`,
          );
          if (options.save) {
            mkdirSync(outputDir, { recursive: true });
            writeFileSync(
              join(outputDir, "disassembly.asm"),
              disassemblyText,
              "utf8",
            );
            if (functionsList) {
              writeFileSync(
                join(outputDir, "functions.txt"),
                functionsList,
                "utf8",
              );
            }
            writeFileSync(
              join(outputDir, "components.json"),
              JSON.stringify(target.componentFiles, null, 2),
              "utf8",
            );
            writeFileSync(join(outputDir, "metadata.txt"), binaryInfo, "utf8");
          }

          // 5. Build summary output
          const functionCount = functionsList
            ? functionsList.trim().split("\n").length
            : 0;
          const totalComponents = Object.values(target.componentFiles).reduce(
            (acc, arr) => acc + arr.length,
            0,
          );

          const previewLines = disassemblyText
            .split("\n")
            .slice(0, options.limit)
            .join("\n");

          return {
            target: target.name,
            binary_path: target.binaryPath,
            bundle_directory: target.bundleOrProjectDir,
            function_count: functionCount,
            component_counts: {
              manifests: target.componentFiles.manifests?.length ?? 0,
              assets_and_icons:
                target.componentFiles.assets_and_icons?.length ?? 0,
              frameworks_and_bundles:
                target.componentFiles.frameworks_and_bundles?.length ?? 0,
              embedded_scripts_and_code:
                target.componentFiles.embedded_scripts_and_code?.length ?? 0,
              resources: target.componentFiles.resources?.length ?? 0,
              total_components: totalComponents,
            },
            export_directory: options.save ? outputDir : null,
            exported_files: options.save
              ? [
                  "disassembly.asm",
                  "functions.txt",
                  "components.json",
                  "metadata.txt",
                ]
              : [],
            disassembly_preview: previewLines,
          };
        }),
      ),
  });
};
