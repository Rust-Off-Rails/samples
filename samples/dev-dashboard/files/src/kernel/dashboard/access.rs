//! Who may open the read-only dashboard at `/admin/dashboard`. Applied as a `route_layer` on that
//! whole router, so no handler can forget it. `/dev/dashboard` (the full one) is development only.
//!
//! | Situation | `/admin/dashboard` |
//! |-----------|--------------------|
//! | development | open (it previews what production shows) |
//! | production, `DASHBOARD_IN_PRODUCTION=true`, the app has admin accounts | admins only; others 404, anonymous to login |
//! | production, `DASHBOARD_IN_PRODUCTION=true`, `APP_ADMIN_PASSWORD` set | HTTP Basic, constant time, failed tries limited |
//! | anything else | not mounted (404), and nothing is recorded |

use std::time::Duration;

use axum::extract::FromRequestParts;
use axum::http::{HeaderValue, StatusCode, header, request::Parts};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::config::Config;
use crate::controllers::application::ClientIp;
use crate::error::AppError;
use crate::state::AppState;

const FAILED_LIMIT: u32 = 10;
const FAILED_WINDOW: Duration = Duration::from_secs(180);

/// APP: `true` once an authentication sample is installed and `admin_from_session` asks it.
pub const HAS_ACCOUNTS: bool = false;

/// APP: the hook into your authentication: `Some(true)` for a signed-in admin, `Some(false)` for a
/// signed-in non-admin, `None` when nobody is signed in. With an auth sample:
///
/// ```ignore
/// match crate::controllers::application::CurrentUser::from_request_parts(parts, state).await {
///     Ok(CurrentUser(user)) => Some(user.is_admin()),
///     Err(_) => None,
/// }
/// ```
async fn admin_from_session(_parts: &mut Parts, _state: &AppState) -> Option<bool> {
    None
}

/// Whether `/admin/dashboard` is mounted in production.
// SECURITY: off unless asked for, and never without a gate: a misconfigured deploy shows 404,
// not an open dashboard (test: the_dashboard_is_404_in_production_by_default).
pub fn mounted_in_production(config: &Config) -> bool {
    config.is_production()
        && config.dashboard.in_production
        && (config.dashboard.admin_password.is_some() || HAS_ACCOUNTS)
}

/// Whether `/admin/dashboard` is mounted in this environment.
pub fn admin_mounted(config: &Config) -> bool {
    config.is_development() || mounted_in_production(config)
}

/// Proof the request may read the dashboard.
pub struct DashboardAccess;

impl FromRequestParts<AppState> for DashboardAccess {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        if state.config.is_development() {
            return Ok(Self);
        }
        match admin_from_session(parts, state).await {
            Some(true) => return Ok(Self),
            // SECURITY: a signed-in non-admin learns nothing: the page "doesn't exist"
            // (test: the_production_dashboard_needs_the_admin_password).
            Some(false) => return Err(AppError::NotFound.into_response()),
            None => {}
        }
        let Some(expected) = state.config.dashboard.admin_password.as_deref() else {
            return Err(AppError::Unauthorized.into_response());
        };
        let ip = ClientIp::from_request_parts(parts, state)
            .await
            .unwrap_or(ClientIp(None));
        let key = ip.key("dashboard-basic-auth");
        // SECURITY: once a client used up its failed tries, even the right password waits for the
        // window (test: the_production_dashboard_needs_the_admin_password).
        if state.rate_limit.exhausted(&key, FAILED_LIMIT).await {
            return Err(AppError::TooManyRequests.into_response());
        }
        match basic_password(parts) {
            None => Err(challenge()),
            Some(given) if same_secret(&given, expected) => Ok(Self),
            Some(_) => {
                if state
                    .rate_limit
                    .check(&key, FAILED_LIMIT, FAILED_WINDOW)
                    .await
                    .is_err()
                {
                    return Err(AppError::TooManyRequests.into_response());
                }
                tracing::warn!(client = %key, "dashboard: wrong admin password");
                Err(challenge())
            }
        }
    }
}

fn challenge() -> Response {
    let mut res = (StatusCode::UNAUTHORIZED, "Authentication required").into_response();
    res.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Basic realm=\"admin\", charset=\"UTF-8\""),
    );
    res
}

fn basic_password(parts: &Parts) -> Option<String> {
    let value = parts.headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let encoded = value
        .strip_prefix("Basic ")
        .or_else(|| value.strip_prefix("basic "))?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let text = String::from_utf8(decoded).ok()?;
    let (_, password) = text.split_once(':')?;
    Some(password.to_owned())
}

/// Compares SHA-256 digests in constant time (no timing hint of how much of a guess was right).
fn same_secret(given: &str, expected: &str) -> bool {
    let a = Sha256::digest(given.as_bytes());
    let b = Sha256::digest(expected.as_bytes());
    a.iter()
        .zip(b.iter())
        .fold(0_u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_secrets_compare_exactly() {
        assert!(same_secret(
            "correct horse battery",
            "correct horse battery"
        ));
        assert!(!same_secret(
            "correct horse batter",
            "correct horse battery"
        ));
    }
}
