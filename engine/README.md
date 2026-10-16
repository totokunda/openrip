# OpenRip engine (Rust)

Cargo workspace for the engine that replaces the TypeScript media pipeline. See [ROADMAP.md](../ROADMAP.md) §2.

| Crate | Status | What it is |
|---|---|---|
| `openrip-model` | started | Project format: microsecond time with exact frame-rate maths, `Animated<T>` keyframes, tracks → segments → materials mirroring CapCut's drafts |
| `openrip-capcut` | started | CapCut draft importer (read-only) with an import report — coverage in [docs/parity/capcut-import.md](../docs/parity/capcut-import.md) |
| `openrip-dev` | started | Developer CLI (`capcut-import`, `capcut-scan`) |

```bash
cd engine
cargo test
cargo run --release -p openrip-dev -- capcut-scan "$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft"
```
