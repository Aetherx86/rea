//! One-command automated discovery, bundle component cataloging, instruction disassembly,
//! and clean-room Pseudo-C decompilation (`rea-cli disassemble <target>`).

use crate::output::Format;
use crate::{Cli, emit, fail};
use clap::Args;
use rea_analysis::native;
use rea_disasm::pseudo::lift;
use rea_disasm::{Image, Limits, NoControl, Program};
use rea_evidence::{ToolError, sha256_hex};
use rea_formats::{entropy, parse_binary};
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Args)]
pub struct DisassembleArgs {
    /// Application name, bundle directory, or binary path (e.g. `Calculator` or `/bin/ls`).
    pub target: String,
    /// Directory to export full assembly, pseudo-C, and components (defaults to `./disassembly_<name>`).
    #[arg(long)]
    pub output: Option<PathBuf>,
    /// Disassemble and decompile only a specific function by name or hex address.
    #[arg(long)]
    pub function: Option<String>,
    /// Maximum preview lines to include in terminal output.
    #[arg(long, default_value_t = 40)]
    pub limit: usize,
    /// Preview disassembly without writing artifacts to disk.
    #[arg(long)]
    pub no_save: bool,
    /// Emit structured Pseudo-C decompilation (`pseudocode.c`) alongside assembly (`disassembly.asm`).
    #[arg(long, default_value_t = true)]
    pub decompile: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct ComponentInventory {
    pub manifests: Vec<String>,
    pub assets_and_icons: Vec<String>,
    pub frameworks_and_bundles: Vec<String>,
    pub embedded_scripts_and_code: Vec<String>,
    pub resources: Vec<String>,
}

impl ComponentInventory {
    pub fn total(&self) -> usize {
        self.manifests.len() + self.assets_and_icons.len() + self.frameworks_and_bundles.len() + self.embedded_scripts_and_code.len() + self.resources.len()
    }
}

struct ResolvedTarget {
    name: String,
    binary_path: PathBuf,
    bundle_dir: Option<PathBuf>,
    components: ComponentInventory,
}

fn is_recognized_binary(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.len() < 4 {
        return false;
    }
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    if parse_binary(&bytes).is_ok() {
        return true;
    }
    matches!(
        bytes.get(..4),
        Some(
            [0xfe, 0xed, 0xfa, 0xce]
                | [0xfe, 0xed, 0xfa, 0xcf]
                | [0xce, 0xfa, 0xed, 0xfe]
                | [0xcf, 0xfa, 0xed, 0xfe]
                | [0xca, 0xfe, 0xba, 0xbe]
                | [0xbe, 0xba, 0xfe, 0xca]
                | [0xca, 0xfe, 0xba, 0xbf]
                | [0xbf, 0xba, 0xfe, 0xca]
                | [0x7f, b'E', b'L', b'F']
                | [0x00, b'a', b's', b'm']
                | [b'd', b'e', b'x', b'\n']
        )
    ) || bytes.starts_with(b"MZ")
}

fn resolve_target(target: &str) -> Result<ResolvedTarget, ToolError> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let explicit = target.starts_with('/') || target.starts_with('.');
    let mut candidates = Vec::new();
    if explicit {
        candidates.push(PathBuf::from(target));
    } else {
        candidates.extend([
            PathBuf::from(target),
            PathBuf::from(format!("{target}.app")),
            home.join("Documents").join(target),
            home.join("Documents").join(format!("{target}.app")),
            PathBuf::from(format!("/Applications/{target}.app")),
            home.join("Applications").join(format!("{target}.app")),
            PathBuf::from(format!("/Applications/{target}")),
            PathBuf::from(format!("/System/Applications/{target}.app")),
            PathBuf::from(format!("/System/Applications/Utilities/{target}.app")),
            PathBuf::from(format!("/opt/homebrew/bin/{target}")),
            PathBuf::from(format!("/usr/local/bin/{target}")),
            PathBuf::from(format!("/usr/bin/{target}")),
            PathBuf::from(format!("/bin/{target}")),
        ]);
    }

    let mut found: Option<PathBuf> = None;
    for cand in &candidates {
        if !cand.exists() {
            continue;
        }
        if explicit {
            found = Some(cand.clone());
            break;
        }
        if cand.is_file() && is_recognized_binary(cand) {
            found = Some(cand.clone());
            break;
        }
        if cand.is_dir() && (cand.join("Contents").join("MacOS").exists() || cand.extension().is_some_and(|e| e == "app")) {
            found = Some(cand.clone());
            break;
        }
    }
    if found.is_none() {
        found = candidates.into_iter().find(|c| c.exists());
    }
    let Some(found_path) = found else {
        return Err(ToolError::invalid(format!("Could not locate target '{target}'.")));
    };
    let found_path = std::path::absolute(&found_path).unwrap_or(found_path);
    let raw_name = found_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| target.to_string());
    let name = raw_name.strip_suffix(".app").unwrap_or(&raw_name).to_string();

    let (binary_path, bundle_dir) = if found_path.is_file() {
        if !is_recognized_binary(&found_path) {
            return Err(ToolError::invalid(format!("Target file '{}' is not an executable binary or recognized binary container.", found_path.display())));
        }
        (found_path.clone(), found_path.parent().map(Path::to_path_buf))
    } else if found_path.is_dir() {
        let mut bin_opt = None;
        let macos_dir = found_path.join("Contents").join("MacOS");
        if macos_dir.is_dir()
            && let Ok(entries) = fs::read_dir(&macos_dir)
        {
            let files: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
            let preferred = files.iter().find(|p| p.file_name().is_some_and(|n| n.to_string_lossy() == name)).or_else(|| files.first());
            if let Some(p) = preferred
                && is_recognized_binary(p)
            {
                bin_opt = Some(p.clone());
            }
        }
        if bin_opt.is_none() {
            let build_cands = [
                found_path.join("target").join("release").join(&name),
                found_path.join("target").join("debug").join(&name),
                found_path.join(".build").join("release").join(&name),
                found_path.join(".build").join("debug").join(&name),
                found_path.join("build").join("Release").join(&name),
                found_path.join("build").join(&name),
                found_path.join("dist").join(&name),
                found_path.join("bin").join(&name),
                found_path.join(&name),
            ];
            for bc in build_cands {
                if is_recognized_binary(&bc) {
                    bin_opt = Some(bc);
                    break;
                }
            }
        }
        if bin_opt.is_none() {
            bin_opt = find_executable(&found_path, &name, 0);
        }
        let Some(b) = bin_opt else {
            return Err(ToolError::invalid(format!("Could not find an executable binary in '{}'.", found_path.display())));
        };
        (b, Some(found_path))
    } else {
        return Err(ToolError::invalid(format!("Could not read target '{}'.", found_path.display())));
    };

    let components = bundle_dir.as_deref().map(scan_components).unwrap_or_default();
    Ok(ResolvedTarget { name, binary_path, bundle_dir, components })
}

fn find_executable(dir: &Path, preferred: &str, depth: usize) -> Option<PathBuf> {
    if depth > 4 {
        return None;
    }
    let entries: Vec<_> = fs::read_dir(dir).ok()?.flatten().collect();
    for entry in &entries {
        let p = entry.path();
        if p.is_file() && entry.file_name().to_string_lossy() == preferred && is_recognized_binary(&p) {
            return Some(p);
        }
    }
    for entry in &entries {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if p.is_dir()
            && !name.starts_with('.')
            && !matches!(name.as_str(), "node_modules" | "Pods" | "target")
            && let Some(found) = find_executable(&p, preferred, depth + 1)
        {
            return Some(found);
        }
    }
    None
}

fn scan_components(root: &Path) -> ComponentInventory {
    let mut inv = ComponentInventory::default();
    fn walk(root: &Path, cur: &Path, depth: usize, inv: &mut ComponentInventory) {
        if depth > 3 {
            return;
        }
        let Ok(entries) = fs::read_dir(cur) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(".git") || matches!(name.as_str(), "node_modules" | "target") {
                continue;
            }
            let full = entry.path();
            let rel = full.strip_prefix(root).unwrap_or(&full).to_string_lossy().into_owned();
            if full.is_dir() {
                if name.ends_with(".framework") || name.ends_with(".bundle") {
                    inv.frameworks_and_bundles.push(rel);
                } else {
                    walk(root, &full, depth + 1, inv);
                }
            } else if full.is_file() {
                let lower = name.to_ascii_lowercase();
                if lower.ends_with(".plist") || lower.ends_with(".xcprivacy") || lower.ends_with(".toml") {
                    inv.manifests.push(rel);
                } else if lower.ends_with(".car")
                    || lower.ends_with(".icns")
                    || lower.ends_with(".iconset")
                    || lower.ends_with(".png")
                    || lower.ends_with(".svg")
                {
                    inv.assets_and_icons.push(rel);
                } else if lower.ends_with(".dylib") || lower.ends_with(".so") || lower.ends_with(".dll") {
                    inv.frameworks_and_bundles.push(rel);
                } else if lower.ends_with(".js") || lower.ends_with(".sh") || lower.ends_with(".py") || lower.ends_with(".json") {
                    inv.embedded_scripts_and_code.push(rel);
                } else if cur.to_string_lossy().contains("Resources") || lower.ends_with(".mp3") || lower.ends_with(".wav") {
                    inv.resources.push(rel);
                }
            }
        }
    }
    walk(root, root, 0, &mut inv);
    inv
}

fn match_function<'a>(prog: &'a Program, filter: &str) -> Option<&'a rea_disasm::Function> {
    let trimmed = filter.trim();
    if let Some(hex_str) = trimmed.strip_prefix("0x").or_else(|| trimmed.strip_prefix("0X"))
        && let Ok(addr) = u64::from_str_radix(hex_str, 16)
        && let Some(f) = prog.functions.get(&addr).or_else(|| prog.function_containing(addr))
    {
        return Some(f);
    }
    let clean = trimmed.trim_start_matches('_');
    prog.functions.values().find(|f| f.name == trimmed || f.name.trim_start_matches('_') == clean || f.name.ends_with(&format!("::{clean}")))
}

pub fn disassemble(cli: &Cli, args: &DisassembleArgs, f: Format) -> u8 {
    if cli.clean_room {
        return fail(
            &ToolError::invalid("Clean-room mode refuses static binary disassembly.")
                .with_remediation("Run with `--deep` or omit `--clean-room` to inspect internal instructions."),
            f,
        );
    }
    let resolved = match resolve_target(&args.target) {
        Ok(r) => r,
        Err(e) => return fail(&e, f),
    };
    let bytes = match fs::read(&resolved.binary_path) {
        Ok(b) => b,
        Err(e) => return fail(&ToolError::io(resolved.binary_path.display(), e), f),
    };
    let sha256 = sha256_hex(&bytes);
    let ent = entropy(bytes.get(..bytes.len().min(4 * 1024 * 1024)).unwrap_or_default());

    let data: Arc<[u8]> = Arc::from(bytes);
    let img = match Image::parse(data.clone()) {
        Ok(i) => i,
        Err(e) => return fail(&ToolError::invalid(format!("Failed to parse binary '{}': {e}", resolved.binary_path.display())), f),
    };
    let triage = native::triage(&img.bin, &data, &resolved.name);
    let prog = match Program::analyze(&img, &Limits::default(), &NoControl) {
        Ok(p) => p,
        Err(e) => return fail(&ToolError::invalid(format!("Failed to analyze instructions in '{}': {e}", resolved.binary_path.display())), f),
    };
    let overview = native::overview(&img, &prog, &resolved.name);

    let mut functions_lines = Vec::new();
    for func in prog.functions.values() {
        functions_lines.push(format!("{:#010x}  {:>6}B  {:>4} insns  {}", func.entry, func.size(), func.insn_count, func.name));
    }
    let functions_text = functions_lines.join("\n");

    let selected: Vec<&rea_disasm::Function> = if let Some(ref flt) = args.function {
        match match_function(&prog, flt) {
            Some(func) => vec![func],
            None => {
                return fail(&ToolError::invalid(format!("Function '{flt}' was not found in '{}'.", resolved.name)), f);
            }
        }
    } else {
        prog.functions.values().collect()
    };

    let mut asm_lines = Vec::new();
    let mut pseudo_blocks = Vec::new();
    for func in &selected {
        asm_lines.push(format!("; ==================== {} ({:#x}) ====================", func.name, func.entry));
        for insn in prog.instructions(&img, func, true) {
            asm_lines.push(format!("{:#010x}:  {}", insn.addr, insn.text()));
        }
        asm_lines.push(String::new());
        if args.decompile && pseudo_blocks.len() < 250 {
            let lifted = lift(&img, &prog, func, &|_| None);
            pseudo_blocks.push(format!("// {} ({:#x})\n{}", func.name, func.entry, lifted.text));
        }
    }
    if asm_lines.is_empty()
        && let Some(entry_addr) = img.bin.entry
    {
        asm_lines.push(format!("; ==================== entry ({entry_addr:#x}) ===================="));
        let mut cursor = entry_addr;
        for _ in 0..64 {
            let Some(insn) = img.decode(cursor, true) else {
                break;
            };
            asm_lines.push(format!("{:#010x}:  {}", insn.addr, insn.text()));
            let step = u64::from(insn.len.max(1));
            cursor = cursor.saturating_add(step);
        }
        if args.decompile && pseudo_blocks.is_empty() {
            pseudo_blocks.push(format!("// entry ({entry_addr:#x})\nvoid entry_{:x}(void) {{\n    /* stripped binary entry region */\n}}", entry_addr));
        }
    }
    let asm_text = asm_lines.join("\n");
    let pseudo_text = pseudo_blocks.join("\n\n");

    let metadata_text = format!(
        "Target: {}\nBinary: {}\nFormat: {:?} ({})\nArchitecture: {} ({}-bit)\nEntry Point: {}\nSHA-256: {}\nEntropy (first 4 MB): {:.2} bits/byte\nSummary: {}\nFunctions: {}\nBasic Blocks: {}\nInstructions: {}\nStrings: {}\n",
        resolved.name,
        resolved.binary_path.display(),
        img.bin.format,
        img.bin.kind,
        img.bin.arch.name(),
        img.bin.bits,
        img.bin.entry.map(|e| format!("{e:#x}")).unwrap_or_else(|| "none".into()),
        sha256,
        ent,
        triage.summary,
        prog.functions.len(),
        prog.stats.blocks,
        prog.stats.instructions,
        prog.strings.len(),
    );

    let out_dir = args.output.clone().unwrap_or_else(|| PathBuf::from(format!("./disassembly_{}", resolved.name)));
    let out_dir = std::path::absolute(&out_dir).unwrap_or(out_dir);
    let mut exported_files = Vec::new();

    if !args.no_save {
        if let Err(e) = fs::create_dir_all(&out_dir) {
            return fail(&ToolError::io(out_dir.display(), e), f);
        }
        let files_to_write = [
            ("disassembly.asm", asm_text.clone()),
            ("functions.txt", functions_text),
            ("components.json", serde_json::to_string_pretty(&resolved.components).unwrap_or_default()),
            ("metadata.txt", metadata_text),
            ("overview.json", serde_json::to_string_pretty(&overview.result).unwrap_or_default()),
        ];
        for (fname, content) in files_to_write {
            let p = out_dir.join(fname);
            if let Err(e) = fs::write(&p, content) {
                return fail(&ToolError::io(p.display(), e), f);
            }
            exported_files.push(fname.to_string());
        }
        if args.decompile && !pseudo_text.is_empty() {
            let p = out_dir.join("pseudocode.c");
            if let Err(e) = fs::write(&p, &pseudo_text) {
                return fail(&ToolError::io(p.display(), e), f);
            }
            exported_files.push("pseudocode.c".to_string());
        }
    }

    let preview: String = asm_text.lines().take(args.limit).collect::<Vec<_>>().join("\n");
    let pseudo_preview: String = pseudo_text.lines().take(args.limit).collect::<Vec<_>>().join("\n");

    let out = json!({
        "target": resolved.name,
        "binary_path": resolved.binary_path,
        "bundle_directory": resolved.bundle_dir,
        "format": format!("{:?}", img.bin.format),
        "architecture": img.bin.arch.name(),
        "bits": img.bin.bits,
        "sha256": sha256,
        "entropy": (ent * 100.0).round() / 100.0,
        "summary": triage.summary,
        "function_count": prog.functions.len(),
        "basic_block_count": prog.stats.blocks,
        "instruction_count": prog.stats.instructions,
        "string_count": prog.strings.len(),
        "component_counts": {
            "manifests": resolved.components.manifests.len(),
            "assets_and_icons": resolved.components.assets_and_icons.len(),
            "frameworks_and_bundles": resolved.components.frameworks_and_bundles.len(),
            "embedded_scripts_and_code": resolved.components.embedded_scripts_and_code.len(),
            "resources": resolved.components.resources.len(),
            "total_components": resolved.components.total(),
        },
        "export_directory": if args.no_save { None } else { Some(out_dir) },
        "exported_files": exported_files,
        "disassembly_preview": preview,
        "pseudocode_preview": pseudo_preview,
    });
    emit(&out, f);
    0
}
