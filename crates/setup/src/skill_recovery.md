<!-- rea skill reference -->
# Connection and recovery

| Symptom | What to do |
|---|---|
| No `rea` tools in the app | `rea-cli doctor`; if the registration is missing or stale, `rea-cli setup --client <id> --dry-run`, show the plan, then apply with `--yes` after the user agrees |
| Registration looks right but no tools | Restart or reconnect the app; it reads its config at start-up |
| `rea-cli` not found from a shell | The program isn't on `PATH`; registrations use its absolute path, so the app may still work |
| The app asks to approve each tool | That's the app's own policy; don't change it without the user |
| A tool says an engine is missing | Follow its remediation (Settings → Engines in the desktop app) |

Setup only ever adds or updates the `rea` entry. It keeps comments and every other server,
writes a `.rea.backup` copy of the original file first (never overwriting an older backup),
and puts the original back if the result doesn't read back correctly. `rea-cli uninstall`
removes only entries and skill files that REA itself created.

Command-line fallback when no app is connected: every tool is a subcommand, for example
`rea-cli triage /path/to/program` or
`rea-cli core-target-open --json '{"path": "/path/to/program"}'`.
