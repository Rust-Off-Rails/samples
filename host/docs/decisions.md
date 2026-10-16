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
