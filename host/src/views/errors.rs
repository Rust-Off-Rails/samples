//! Error pages. Standalone documents: no layout, no `ctx`, no database. They link
//! `/static/app.css` without a digest, so they still render when everything else is broken.

use askama::Template;

#[derive(Template)]
#[template(path = "errors/404.html")]
pub struct NotFound;

#[derive(Template)]
#[template(path = "errors/403.html")]
pub struct Forbidden;

#[derive(Template)]
#[template(path = "errors/429.html")]
pub struct TooManyRequests;

#[derive(Template)]
#[template(path = "errors/503.html")]
pub struct Unavailable;

/// `detail` (the error chain) is `Some` only in development.
#[derive(Template)]
#[template(path = "errors/500.html")]
pub struct ServerError {
    pub detail: Option<String>,
}

/// The 422 fallback: a fragment listing full messages (handlers normally re-render the form).
#[derive(Template)]
#[template(path = "errors/_invalid.html")]
pub struct Invalid {
    pub messages: Vec<String>,
}
