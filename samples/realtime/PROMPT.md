# Prompt: install the realtime sample

Paste this to the agent working in your Rust off Rails app:

---

Install the **realtime** sample from the Rust off Rails samples (`get_sample realtime` on the samples MCP server, or the `samples/realtime/` folder) into this app: channels over WebSocket (`offrails.v1`) with SSE and long-poll fallbacks, topic authorization, presence, resume, socket tokens, `/dev/sockets` and a live room demo.

1. Read `samples/realtime/README.md` and `CHECKS.md` first, and `.offrails/guides/channels.md`.
2. If this repo has `tools/install.sh`, run `tools/install.sh realtime .`; otherwise follow the README's "Install" steps by hand: the three `cargo add` lines, copy `files/` keeping paths (replace `offrails_host` with this crate's name), then each wiring step at its `samples: <anchor>` comment or the spot the README describes.
3. If the app has accounts, follow "Use your accounts" in the README: point `src/channels/identity.rs` at the app's sessions, call `crate::channels::session_ended(&state, user.id)` wherever a session ends (logout, sign out everywhere, password change and reset), and remove the development guests. If the app already has a `kernel/hub.rs` or `/socket` routes, replace them and keep the app's rooms by moving them onto `Room`.
4. Change only lines marked `// APP:` (topics in `authorize`, limits, rooms), unless the README's "Adapting it" says otherwise. Keep every `// SECURITY:`, `// INVARIANT:` and `// WHY:` line and the code under it. Every app link into `/live` or `/dev/sockets` carries `hx-boost="false"`. Record in `docs/decisions.md` that channels replay from the database and that per-room limits are per node.
5. Prove it, and paste the output:

```sh
cargo fmt --all && cargo run -q -- routes
bin/tailwindcss -i assets/app.css -o static/app.css --minify
sh .offrails/tools/offrails-check
cargo clippy --all-targets -- -D warnings
cargo nextest run realtime_test
cargo nextest run
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres cargo nextest run
cargo deny check
# with the app running (bin/dev), in a real browser:
BASE=http://localhost:3000 node tests/e2e/live_room.e2e.mjs
SCENARIO=tests/e2e/live.scenario.mjs BASE=http://localhost:3000 bash .offrails/tools/browser-smoke/run.sh a11y
curl -s http://localhost:3000/dev/sockets.json | jq '.connections, .topics'
```

Then open `/live` in two browsers (one private window), talk, and watch `/dev/sockets`. Report what you installed, what you replaced, which topics `authorize` allows, and the results.
