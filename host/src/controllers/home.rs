use axum::response::{IntoResponse, Response};

use crate::error::AppError;
use crate::views::{self, Ctx, home::HomeIndex};

pub async fn index(ctx: Ctx) -> Result<Response, AppError> {
    Ok(views::render(HomeIndex { ctx })?.into_response())
}
