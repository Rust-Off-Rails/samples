//! The access matrix and the other security guarantees (test-standards.md §3). Most of these
//! iterate over `ROUTES`, so a new route is covered automatically.

use axum::http::StatusCode;
use offrails_host::{
    config::{AppEnv, Config},
    routes::{Access, ROUTES},
};

use crate::support::TestApp;

fn production() -> Config {
    Config {
        env: AppEnv::Production,
        app_url: "https://app.example.com".into(),
        ..Config::test()
    }
}

fn development() -> Config {
    Config {
        env: AppEnv::Development,
        ..Config::test()
    }
}

/// A concrete URL for a route pattern (parameters a test never resolves to a real record).
pub fn concrete(path: &str) -> String {
    path.replace("{id}", "1")
        .replace("{n}", "0")
        .replace("{token}", "not-a-real-token")
        .replace("{mailer}", "no_such_mailer")
        .replace("{action}", "no_such_action")
        .replace("{name}", "default")
}

async fn request(app: &TestApp, method: &str, path: &str) -> StatusCode {
    match method {
        // WHY: headers only: a streaming route (SSE) never ends its body.
        "GET" => app.request_head(path, &[]).await.0,
        _ => app.post_form(path, &[]).await.status,
    }
}

/// Every non-public route, requested anonymously in production: never a 2xx.
#[tokio::test]
async fn non_public_routes_never_answer_2xx_anonymously() {
    let app = TestApp::with_config(production()).await;
    for (method, path, handler, access) in ROUTES {
        if *access == Access::Public {
            continue;
        }
        let status = request(&app, method, &concrete(path)).await;
        assert!(
            !status.is_success(),
            "{method} {path} ({handler}, {}) answered {status} anonymously",
            access.as_str()
        );
    }
}

/// `Dev` routes don't exist in production or test: 404 from the router fallback, every one.
#[tokio::test]
async fn dev_routes_are_404_outside_development() {
    for config in [production(), Config::test()] {
        let app = TestApp::with_config(config).await;
        for (method, path, handler, access) in ROUTES {
            if *access != Access::Dev {
                continue;
            }
            let status = request(&app, method, &concrete(path)).await;
            assert_eq!(
                status,
                StatusCode::NOT_FOUND,
                "{method} {path} ({handler}) exists outside development"
            );
        }
    }
}

/// A cross-site POST to every unsafe route is rejected.
#[tokio::test]
async fn cross_site_posts_to_every_unsafe_route_are_403() {
    let app = TestApp::with_config(development()).await;
    for (method, path, handler, _) in ROUTES {
        if *method == "GET" {
            continue;
        }
        let res = app
            .post_form_with_headers(&concrete(path), &[], &[("sec-fetch-site", "cross-site")])
            .await;
        assert_eq!(
            res.status,
            StatusCode::FORBIDDEN,
            "{path} ({handler}) accepted a cross-site POST"
        );
    }
}

/// Without fetch metadata (older browsers) the `Origin` decides.
#[tokio::test]
async fn the_origin_header_decides_without_fetch_metadata() {
    let app = TestApp::with_config(development()).await;
    app.without_fetch_metadata()
        .with_origin("https://evil.example");
    app.post_form("/dev/migrations", &[("return_to", "/")])
        .await
        .assert_status(StatusCode::FORBIDDEN);

    app.with_origin("http://localhost:3000");
    app.post_form("/dev/migrations", &[("return_to", "/")])
        .await
        .assert_redirect_to("/");
}

#[tokio::test]
async fn the_error_pages_do_not_leak_internals_in_production() {
    let app = TestApp::with_config(production()).await;
    let res = app.get("/nope").await;
    res.assert_status(StatusCode::NOT_FOUND)
        .assert_not_contains("panicked")
        .assert_not_contains("DATABASE_URL");
}

/// A route someone mounts but forgets to list in `ROUTES` is invisible to the access matrix,
/// the CSRF sweep and the routability test. Parses the files that mount routes.
#[test]
fn every_mounted_route_is_in_the_routes_table() {
    let listed: std::collections::BTreeSet<&str> = ROUTES.iter().map(|(_, p, _, _)| *p).collect();
    let mut missing = Vec::new();
    let mut checked = 0;
    for file in [
        "src/routes.rs",
        "src/controllers/dev.rs",
        // samples: router sources
    ] {
        let source = std::fs::read_to_string(file).expect("read source");
        for (start, _) in source
            .match_indices(".route(\"")
            .chain(source.match_indices(".route_service(\""))
        {
            let rest = &source[start..];
            let after = &rest[rest.find('"').unwrap() + 1..];
            let path = &after[..after.find('"').unwrap()];
            checked += 1;
            if !listed.contains(path) {
                missing.push(format!("{file}: {path}"));
            }
        }
    }
    assert!(checked >= 10, "the parser found only {checked} route calls");
    assert!(
        missing.is_empty(),
        "mounted but not in ROUTES (add the row with its real Access): {missing:#?}"
    );
}
