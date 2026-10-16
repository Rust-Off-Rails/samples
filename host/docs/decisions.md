# Decisions

<!-- Agent-maintained. One dated line per decision not already dictated by .offrails/. Newest last. Format:
YYYY-MM-DD: <decision> (because <reason>; spec: product/features/<x>.md) -->

2026-10-16: app generated (mode=htmx, prod db=postgres, deploy=later)
2026-10-16: the mailer, dev mailbox, job queue and jobs dashboard are not generated here; they install as samples (because this app is the samples repo's host, and each sample must be proven by adding it to a blank app)
2026-10-16: shared files carry inert `samples: <anchor>` comments where samples insert their wiring (because tools/install.sh applies wiring at anchors, and the same anchors tell an agent where each line goes)
2026-10-16: croner is not a dependency yet (because only recurring jobs use it; the jobs sample adds it)
2026-10-16: kernel pages declare their own stylesheets and scripts on `Chrome` (`.stylesheet()`, `.script()`), and the kernel layout links exactly those (because a page whose CSS lived in app.css rendered unstyled: kernel pages never load app.css)
2026-10-16: asset keys are exact paths unless they end in `-` or `.` (a versioned vendor prefix), and the catalog is a BTreeMap (because prefix matching on HashMap order picked the wrong file)
2026-10-16: in development a localhost APP_URL follows the port and scheme actually served (`config::resolve_app_url`); a non-local APP_URL (a tunnel) is kept (because a stale APP_URL in .env sent every emailed link to another port)
2026-10-16: errors under /api and for event streams are JSON (`{"error": "not_found"}`), every 503 carries Retry-After, and 5xx responses are logged with their request id (errors-and-logging.md#response-mapping)
2026-10-16: the theme switch (System / Light / Dark) lives in the kernel header; the choice is the `offrails_theme` cookie (`system|light|dark`, not HttpOnly, SameSite=Lax, a year), the server renders `<html data-theme>` from it on kernel pages, app pages and error pages, `POST /theme` is the no-JS fallback (same-site `return_to` only), and admin.js switches instantly and dispatches `themechange` (because views.md#dark-mode asks for a server-rendered `data-theme`; the name is namespaced so it never collides with an app's own `theme` cookie, and it stays out of the production HttpOnly backstop because a script can't overwrite an HttpOnly cookie)
2026-10-16: kernel CSS defines each color token once with `light-dark()`, and `:root[data-theme]` sets `color-scheme`; no prefers-color-scheme color blocks (because those ignore the switch)
2026-10-16: request URIs reach logs only through `kernel::redact` (`{token}` segments of `TOKEN_ROUTES`, long random segments and secret query values become `[redacted]`), and the log filter caps `tower_http::csrf` at debug whatever RUST_LOG says (because emailed links carry tokens in the path, and the CSRF layer traces raw paths)
2026-10-16: development listens on 127.0.0.1 unless `APP_BIND` says otherwise (a dev container sets `APP_BIND=0.0.0.0`); production keeps 0.0.0.0 (because /dev tools have no login, and anyone on the same network could open them). Deviates from `.offrails/cli.md`, which says `serve` binds 0.0.0.0
2026-10-16: development refuses a `Host` that isn't localhost, 127.0.0.1, [::1], `*.localhost`, `APP_URL`'s host or an `APP_ALLOWED_HOSTS` entry, with a 403 page saying how to allow it (`kernel::hosts`, like Rails' HostAuthorization) (because DNS rebinding reaches /dev same-origin, past the CSRF layer)
2026-10-16: an unset APP_ENV still means development (so `cargo run` works) but logs a warning at every boot (`Config::boot_warnings`) (because on a server it means a missing setting, and development mounts /dev tools)
2026-10-16: the samples' tracing layers are added as `Option<Vec<…>>`, `None` when empty (because an empty `Vec` layer answers `Interest::never()` and silenced every log line of an app with no sample layers)
