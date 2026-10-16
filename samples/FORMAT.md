# The sample format

A sample is tested reference code an agent copies into a Rust off Rails app. Once copied, the app owns it. This file is the contract every sample follows, so an agent (by hand) and `tools/install.sh` (mechanically) install any sample the same way.

## Folder

```
samples/<name>/
  sample.toml     what to add (crates), where to wire it (anchors), what it depends on
  README.md       what it is, the install procedure for an agent, wiring, customizing, screenshots
  CHECKS.md       what "working and safe" means: threat model, invariants, and the test for each
  files/          the code, at the app paths it lands on (src/, templates/, static/, migration/, tests/)
```

- `<name>` is kebab-case (`dev-mailbox`, `auth-password`).
- **Every file under `files/` is copied to the same path in the app.** There is no file list to keep in sync. A sample never ships a file that `host/` already has; it changes shared files only through wiring.
- Files are written against `host/` exactly as they will look in an app: formatted with `cargo fmt`, clippy-clean, and using the host crate name `offrails_host` where a crate path is needed (tests: `use offrails_host::…`). `install.sh` replaces `offrails_host` with the app's package name; an agent installing by hand does the same.
- Migrations ship as files with a fixed timestamped name (`m20261016_000100_create_mailbox_messages.rs`), registered through wiring. Never edit a shipped migration; a change is a new migration.
- Tests live in `files/tests/app/<sample>_test.rs` (one module in the app's single test binary) and run on SQLite and Postgres.

## `sample.toml`

A strict subset of TOML so a POSIX shell can read it: top-level `key = "value"` lines, two arrays, then `[[wire]]` tables whose `text` is a `'''` literal block (the opening `'''` ends its line; the closing `'''` stands alone).

```toml
name = "dev-mailbox"
version = "0.7.0"                 # the framework release it was verified with
summary = "One line: what it adds."
depends_on = ["mailer"]           # other samples, installed first (recursively)
extracted_from = "Rust off Rails apps"

# `cargo add` arguments, one per line, never with a version: cargo picks it, Cargo.lock records it.
crates = [
  "lettre --no-default-features --features builder,smtp-transport,pool,hostname,tokio1-rustls-tls",
]

[[wire]]
file = "src/kernel/mod.rs"        # an app path
anchor = "kernel mods"            # the line in that file containing `samples: kernel mods`
text = '''
pub mod mailbox_web;
'''
```

| Key | Required | Meaning |
|-----|----------|---------|
| `name` | yes | The folder name |
| `version` | yes | The framework release the sample is verified with |
| `summary` | yes | One line, shown in listings and the MCP `list_samples` |
| `depends_on` | yes (may be `[]`) | Samples this one needs, installed first |
| `extracted_from` | yes | Where the code came from, in public words ("Rust off Rails apps") |
| `crates` | yes (may be `[]`) | `cargo add` argument lines |
| `[[wire]]` | no | One insertion into a shared file each |

### Wiring

Shared files (`routes.rs`, `kernel/mod.rs`, `config.rs`, `state.rs`, `migration/src/lib.rs`, `tests/app/main.rs`, layouts, `.env.example`, …) carry one-line anchor comments where samples insert code:

```rust
    // samples: config fields
```
```html
{# samples: nav links #}
```
```sh
# samples: env
```

A `[[wire]]` puts its `text` on the lines **above** the anchor line, indented like the anchor, so the anchor stays for the next sample. Rules for `text`:

- It is complete, compilable code for that spot (a field, a `mod` line, a match arm, a route), written at indentation zero; `install.sh` indents it.
- It is idempotent: when all its lines already appear together in the file, nothing is inserted.
- It is self-contained: use full paths (`crate::kernel::mailer::Mailer`) rather than adding `use` lines elsewhere.
- Run `cargo fmt --all` after installing (the Definition of Done does): `rustfmt` sorts `mod` lines and may rewrap.

The anchors `host/` provides (each file says what goes there):

| File | Anchors |
|------|---------|
| `src/lib.rs` | `lib mods` |
| `src/kernel/mod.rs` | `kernel mods` |
| `src/kernel/ui.rs` | `kernel tabs` (a `Tab { … }` in the kernel header) |
| `src/kernel/introspect.rs` | `introspect sections` (`out["x"] = …;`) |
| `src/config.rs` | `config fields`, `config debug`, `config parse`, `config init`, `config test`, `config sections` (a sample's own config struct, appended) |
| `src/state.rs` | `state fields`, `state build`, `state init`, `state fns` |
| `src/routes.rs` | `routes` (`app = app.route(…)`), `dev routers` (merged in development only), `paths`, `routes table` (`ROUTES` rows) |
| `src/controllers/mod.rs` | `controller mods` |
| `src/controllers/application.rs` | `ctx init`, `extractors` |
| `src/controllers/dev.rs` | `dev routes`, `dev tiles`, `dev try-it`, `system facts` |
| `src/controllers/meta.rs` | `sitemap paths` |
| `src/views/mod.rs` | `view mods`, `ctx fields` |
| `src/models/mod.rs` | `model mods`, `model aliases` |
| `src/tasks/mod.rs` | `task mods`, `tasks` |
| `src/main.rs` | `cli commands`, `cli dispatch`, `serve start`, `serve stop` |
| `migration/src/lib.rs` | `migration mods`, `migrations` |
| `templates/layouts/application.html` | `dev footer links` |
| `templates/shared/_nav.html` | `nav links` |
| `tests/app/main.rs` | `test mods` |
| `tests/app/support.rs` | `test support` (methods on `TestApp`) |
| `tests/app/factories.rs` | `factories` |
| `tests/app/security_test.rs` | `router sources` (files that mount routes, for the ROUTES check) |
| `tests/app/kernel_web_test.rs` | `no-store paths` |
| `.env.example` | `env` |
| `compose.yaml` | `compose env` |

An app made by `generators/new.md` before 0.7.0 has no anchors. Then `install.sh` refuses and names each missing anchor; the agent applies that wiring by hand at the spot the anchor table describes (README "Wiring" says it in words for every insertion).

## README.md

Sections, in this order:

1. **Title and one paragraph**: what it is, what it replaces (Rails/Phoenix), what it depends on, "extracted from Rust off Rails apps".
2. **Screenshots**: the light desktop screenshot inline, links to the rest (`docs/screenshots/<sample>/`).
3. **Install**: `get_sample` through the MCP server, or by hand: the exact numbered procedure (crates, copy `files/`, each wiring step in words with its file, then `cargo fmt`, `cargo run -- routes`, the Definition of Done). `tools/install.sh <sample> <app>` is the mechanical version.
4. **After installing**: what the agent must still do in the app (env vars in the deploy config, `docs/decisions.md`, the `AGENTS.md` header line).
5. **Customize**: what to rename or change, and what not to.
6. **How it works**: the design in a few paragraphs, with the routes table.
7. **Files**: one line per file.

## CHECKS.md

What "working and safe" means, each item with the test (or command) that proves it:

- **Threat model**: a STRIDE table (`| STRIDE | Threat | Control | Test |`) for anything reachable over HTTP; `n/a: <why>` where a category can't apply.
- **Invariants**: behavior that must hold (e.g. "development always delivers to the dev mailbox").
- **Commands**: how to run them (`tools/ci.sh <sample>`).

## Proving a sample

```sh
TEST_DATABASE_URL=postgres://… tools/ci.sh <sample>   # alone
TEST_DATABASE_URL=postgres://… tools/ci.sh all        # together with every other sample
```

`ci.sh` copies `host/` to `.cache/ci/<name>/app`, installs with `install.sh`, then runs `cargo fmt` (and fails when a shipped file changes: ship formatted code), builds the CSS, regenerates `docs/routes.md`, `clippy -D warnings`, the test suite on SQLite and on Postgres, `offrails-check`, `cargo deny` and `fmt --check`.

## host/ is frozen

Samples never edit `host/`. A change to it (a new anchor, a fix) is its own commit titled `host: …`, because every sample is proven against it.
