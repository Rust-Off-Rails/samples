//! Who is on the other end of a page, a socket or a stream: the one place realtime asks.
//!
//! APP: this sample ships development guests (`models::guest`, `models::guest_session`) so the
//! live room works on a blank app. With accounts (an auth sample), replace the bodies of
//! `current`, `by_session` and `session_live` with your session lookup, keep their signatures,
//! and call `channels::session_ended(&s, user.id)` wherever a session ends (logout, password
//! change, "sign out everywhere"). Nothing else in realtime changes.
//!
//! SECURITY: the person behind a connection comes from the server's session only; no frame,
//! query string or form field can choose it (test: a_push_cannot_post_as_someone_else).

use axum::extract::FromRequestParts;
use axum::http::HeaderMap;
use axum::http::request::Parts;
use chrono::Utc;
use serde_json::json;

use crate::error::AppError;
use crate::kernel::cookie;
use crate::kernel::hub::Member;
use crate::kernel::security::{SESSION_COOKIE_DEV, SESSION_COOKIE_PROD};
use crate::models::{guest, guest_session, room_message};
use crate::state::AppState;

/// A signed-in person, as realtime needs them.
#[derive(Clone, Debug, PartialEq)]
pub struct Person {
    pub id: i64,
    pub name: String,
}

impl Person {
    pub fn initials(&self) -> String {
        guest::initials(&self.name)
    }

    /// 0–7: the avatar color, stable per person.
    pub fn color(&self) -> u8 {
        room_message::color_of(self.id)
    }
}

/// A person and the session they're signed in with.
#[derive(Clone, Debug, PartialEq)]
pub struct Signed {
    pub person: Person,
    pub session_id: i64,
}

/// The session cookie's name: production reads only the `__Host-` one, so a cookie planted by a
/// sibling subdomain signs nobody in.
pub fn cookie_name(production: bool) -> &'static str {
    if production {
        SESSION_COOKIE_PROD
    } else {
        SESSION_COOKIE_DEV
    }
}

/// APP: the request's session → person. Here: a guest session cookie.
pub async fn current(s: &AppState, headers: &HeaderMap) -> Result<Option<Signed>, AppError> {
    let Some(token) = cookie::get(headers, cookie_name(s.config.is_production())) else {
        return Ok(None);
    };
    let found = guest_session::find_by_token(&s.db, &token, Utc::now()).await?;
    Ok(found.map(|(session, guest)| Signed {
        person: Person {
            id: guest.id,
            name: guest.name,
        },
        session_id: session.id,
    }))
}

/// APP: a session id (from a socket token) → person, while that session is live.
pub async fn by_session(s: &AppState, session_id: i64) -> Result<Option<Signed>, AppError> {
    let found = guest_session::find_live(&s.db, session_id, Utc::now()).await?;
    Ok(found.map(|(session, guest)| Signed {
        person: Person {
            id: guest.id,
            name: guest.name,
        },
        session_id: session.id,
    }))
}

/// APP: is this session still live? Fails closed: a database error counts as ended.
pub async fn session_live(s: &AppState, session_id: Option<i64>) -> bool {
    match session_id {
        Some(id) => guest_session::is_live(&s.db, id, Utc::now())
            .await
            .unwrap_or(false),
        None => false,
    }
}

/// What others see of a person in presence: a display name, initials and a color. Never an
/// email (test: presence_carries_names_never_emails).
pub fn member_for(signed: &Signed) -> Member {
    Member {
        key: signed.person.id.to_string(),
        meta: json!({
            "name": signed.person.name,
            "initials": signed.person.initials(),
            "color": signed.person.color(),
        }),
        session: Some(signed.session_id),
    }
}

/// The signed-in person, if any.
pub struct CurrentPerson(pub Option<Signed>);

impl FromRequestParts<AppState> for CurrentPerson {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, s: &AppState) -> Result<Self, Self::Rejection> {
        Ok(Self(current(s, &parts.headers).await?))
    }
}

/// A signed-in person, or `AppError::Unauthorized` (a redirect to sign in, for pages).
pub struct RequirePerson(pub Signed);

impl FromRequestParts<AppState> for RequirePerson {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, s: &AppState) -> Result<Self, Self::Rejection> {
        current(s, &parts.headers)
            .await?
            .map(Self)
            .ok_or(AppError::Unauthorized)
    }
}

/// A signed-in person, or a bare 401 (sockets, streams and their relays: a client that can't
/// follow a redirect to a sign-in page, and must not save its URL as the place to return to).
pub struct SocketPerson(pub Signed);

impl FromRequestParts<AppState> for SocketPerson {
    type Rejection = axum::response::Response;

    async fn from_request_parts(parts: &mut Parts, s: &AppState) -> Result<Self, Self::Rejection> {
        use axum::response::IntoResponse;
        match current(s, &parts.headers).await {
            Ok(Some(signed)) => Ok(Self(signed)),
            Ok(None) => Err(axum::http::StatusCode::UNAUTHORIZED.into_response()),
            Err(e) => Err(e.into_response()),
        }
    }
}
