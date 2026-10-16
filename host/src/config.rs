//! Typed configuration, parsed from env vars once at startup.
//! This is the only module that reads environment variables.

use std::fmt;
use std::time::Duration;

/// The human product name: page titles, kernel UIs (/dev), the default MAIL_FROM.
/// Never derived from the crate name: crates get renamed, products don't.
pub const APP_NAME: &str = "Offrails Host";
/// The home page title is "Offrails Host: <tagline>"; the social card carries it too.
pub const APP_TAGLINE: &str = "the blank app every sample installs into";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Test,
    Production,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Pretty,
    Json,
}

/// `APP_TLS_CERT` + `APP_TLS_KEY`: serve HTTPS (h2 + http/1.1 via ALPN) directly.
#[derive(Debug, Clone)]
pub struct TlsFiles {
    pub cert: String,
    pub key: String,
}

#[derive(Clone)]
pub struct Config {
    pub env: AppEnv,
    pub database_url: String,
    pub database_pool: u32,
    pub app_url: String,
    pub port: u16,
    /// `APP_SHUTDOWN_DRAIN_SECS`: how long open connections get after SIGTERM.
    pub shutdown_drain: Duration,
    /// `APP_TRUSTED_PROXY`: trust the rightmost X-Forwarded-For hop (rate limiting).
    pub trusted_proxy: bool,
    pub log_format: LogFormat,
    /// `APP_REVISION`: git sha of the build, shown on /dev/system.
    pub revision: Option<String>,
    pub tls: Option<TlsFiles>,
    /// `APP_DEV_HTTP_PORT` (development only, with TLS on): the same app on plain http.
    pub dev_http_port: Option<u16>,
    // samples: config fields
}

// Credentials live in these fields, so Debug is hand-written.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut d = f.debug_struct("Config");
        d.field("env", &self.env)
            .field("database_url", &"[redacted]")
            .field("database_pool", &self.database_pool)
            .field("app_url", &self.app_url)
            .field("port", &self.port)
            .field("shutdown_drain", &self.shutdown_drain)
            .field("trusted_proxy", &self.trusted_proxy)
            .field("log_format", &self.log_format)
            .field("revision", &self.revision)
            .field("tls", &self.tls.is_some())
            .field("dev_http_port", &self.dev_http_port);
        // samples: config debug
        d.finish()
    }
}

const DEV_DATABASE_URL: &str = "sqlite://storage/development.sqlite3?mode=rwc";

/// In development `APP_URL` follows `PORT` (https when `bin/dev` serves TLS), so links and the
/// CSRF origin check still work when the app runs on another port.
pub fn dev_app_url(port: u16, https: bool) -> String {
    let scheme = if https { "https" } else { "http" };
    format!("{scheme}://localhost:{port}")
}

/// Where links (emails, canonical URLs, the CSRF origin) point. Production: `APP_URL`, required.
/// Development: the address actually served. A localhost `APP_URL` left in `.env` from another
/// port would send every emailed link to the wrong server, so on localhost the port and scheme
/// always follow `PORT` and TLS; a non-local `APP_URL` (a tunnel) is kept as given.
pub fn resolve_app_url(env: AppEnv, app_url: Option<&str>, port: u16, https: bool) -> String {
    let given = app_url.map(|u| u.trim().trim_end_matches('/').to_owned());
    match (env, given) {
        (AppEnv::Production, Some(url)) => url,
        (AppEnv::Production, None) => String::new(),
        (_, Some(url)) if !is_localhost(&url) => url,
        (_, Some(url)) => {
            let served = dev_app_url(port, https);
            if url != served {
                tracing::warn!(app_url = %url, served = %served, "APP_URL points at another local address; links follow the one being served");
            }
            served
        }
        (_, None) => dev_app_url(port, https),
    }
}

fn is_localhost(url: &str) -> bool {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let host = rest.split('/').next().unwrap_or_default();
    let host = host.rsplit_once(':').map_or(host, |(h, _)| h);
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "0.0.0.0")
}

impl Config {
    /// Called once in `main`. Collects ALL missing or invalid vars and fails with one message.
    pub fn from_env() -> anyhow::Result<Self> {
        let raw_env = std::env::var("APP_ENV").ok();
        let env = match raw_env.as_deref() {
            None | Some("") | Some("development") => AppEnv::Development,
            Some("test") => AppEnv::Test,
            Some("production") => AppEnv::Production,
            Some(other) => {
                anyhow::bail!("invalid APP_ENV: {other} (development | test | production)")
            }
        };
        if env == AppEnv::Development {
            dotenvy::dotenv().ok();
        }

        let get = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
        let mut missing: Vec<String> = Vec::new();
        let mut invalid: Vec<String> = Vec::new();
        let production = env == AppEnv::Production;

        let mut parse_num = |name: &str, default: u64| -> u64 {
            match get(name) {
                None => default,
                Some(v) => v.parse().unwrap_or_else(|_| {
                    invalid.push(format!("{name} (expected a number)"));
                    default
                }),
            }
        };
        // PORT first: the development APP_URL default depends on it.
        let port = parse_num("PORT", 3000) as u16;
        let database_pool = parse_num("DATABASE_POOL", 10) as u32;
        let shutdown_drain = Duration::from_secs(parse_num("APP_SHUTDOWN_DRAIN_SECS", 5));
        let dev_http_port = get("APP_DEV_HTTP_PORT").map(|v| {
            v.parse::<u16>().unwrap_or_else(|_| {
                invalid.push("APP_DEV_HTTP_PORT (expected a port number)".into());
                0
            })
        });
        if dev_http_port.is_some() && env != AppEnv::Development {
            invalid.push("APP_DEV_HTTP_PORT (development only)".into());
        }

        let tls = match (get("APP_TLS_CERT"), get("APP_TLS_KEY")) {
            (Some(cert), Some(key)) => Some(TlsFiles { cert, key }),
            (None, None) => None,
            _ => {
                invalid.push("APP_TLS_CERT and APP_TLS_KEY (set both, or neither)".into());
                None
            }
        };

        let database_url = match get("DATABASE_URL") {
            Some(v) => v,
            None if production => {
                missing.push("DATABASE_URL".into());
                String::new()
            }
            None => DEV_DATABASE_URL.into(),
        };
        if production && get("APP_URL").is_none() {
            missing.push("APP_URL".into());
        }
        // With APP_DEV_HTTP_PORT the browser uses the plain-http port; links stay http.
        let https = tls.is_some() && dev_http_port.is_none();
        let app_url = resolve_app_url(env, get("APP_URL").as_deref(), port, https);

        let trusted_proxy = match get("APP_TRUSTED_PROXY").as_deref() {
            None | Some("false") | Some("0") => false,
            Some("true") | Some("1") => true,
            Some(_) => {
                invalid.push("APP_TRUSTED_PROXY (expected true or false)".into());
                false
            }
        };

        let log_format = match get("LOG_FORMAT").as_deref() {
            None if production => LogFormat::Json,
            None => LogFormat::Pretty,
            Some("json") => LogFormat::Json,
            Some("pretty") => LogFormat::Pretty,
            Some(_) => {
                invalid.push("LOG_FORMAT (expected pretty or json)".into());
                LogFormat::Pretty
            }
        };

        // samples: config parse

        if !missing.is_empty() || !invalid.is_empty() {
            let mut parts = Vec::new();
            if !missing.is_empty() {
                parts.push(format!("missing required env vars: {}", missing.join(", ")));
            }
            if !invalid.is_empty() {
                parts.push(format!("invalid env vars: {}", invalid.join(", ")));
            }
            anyhow::bail!("{} (see .env.example)", parts.join("; "));
        }

        Ok(Self {
            env,
            database_url,
            database_pool,
            app_url,
            port,
            shutdown_drain,
            trusted_proxy,
            log_format,
            revision: get("APP_REVISION"),
            tls,
            dev_http_port,
            // samples: config init
        })
    }

    /// The test suite's config. Never reads the environment.
    pub fn test() -> Self {
        Self {
            env: AppEnv::Test,
            database_url: "sqlite::memory:".into(),
            database_pool: 5,
            app_url: dev_app_url(3000, false),
            port: 3000,
            shutdown_drain: Duration::from_secs(5),
            trusted_proxy: false,
            log_format: LogFormat::Pretty,
            revision: None,
            tls: None,
            dev_http_port: None,
            // samples: config test
        }
    }

    pub fn is_production(&self) -> bool {
        self.env == AppEnv::Production
    }

    pub fn is_development(&self) -> bool {
        self.env == AppEnv::Development
    }
}

// samples: config sections

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_test_config_never_reads_the_environment() {
        let c = Config::test();
        assert_eq!(c.database_url, "sqlite::memory:");
        assert!(!c.is_production() && !c.is_development());
    }

    #[test]
    fn debug_redacts_credentials() {
        let mut c = Config::test();
        c.database_url = "postgres://user:hunter2@db.example.com/app".into();
        assert!(!format!("{c:?}").contains("hunter2"));
    }

    #[test]
    fn a_stale_local_app_url_follows_the_port_being_served() {
        let dev = AppEnv::Development;
        assert_eq!(
            resolve_app_url(dev, Some("http://localhost:3000/"), 3960, false),
            "http://localhost:3960"
        );
        assert_eq!(
            resolve_app_url(dev, Some("http://127.0.0.1:3000"), 3960, true),
            "https://localhost:3960"
        );
        assert_eq!(
            resolve_app_url(dev, None, 3960, false),
            "http://localhost:3960"
        );
        // A tunnel or a LAN name is kept: that's where the links must go.
        assert_eq!(
            resolve_app_url(dev, Some("https://dev.example.com"), 3960, false),
            "https://dev.example.com"
        );
        assert_eq!(
            resolve_app_url(
                AppEnv::Production,
                Some("https://app.example.com/"),
                3960,
                false
            ),
            "https://app.example.com"
        );
    }

    #[test]
    fn the_development_url_follows_port_and_tls() {
        assert_eq!(dev_app_url(3001, false), "http://localhost:3001");
        assert_eq!(dev_app_url(3000, true), "https://localhost:3000");
    }
}
