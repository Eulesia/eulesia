use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(name = "eulesia-server", about = "Eulesia v2 API server")]
pub struct Config {
    /// Host address to bind to
    #[arg(long, env = "EULESIA_HOST", default_value = "127.0.0.1")]
    pub host: String,

    /// Port to listen on
    #[arg(short, long, env = "EULESIA_PORT", default_value_t = 3002)]
    pub port: u16,

    /// Log level (trace, debug, info, warn, error)
    #[arg(long, env = "EULESIA_LOG_LEVEL", default_value = "info")]
    pub log_level: String,

    /// Output logs as JSON
    #[arg(long, env = "EULESIA_LOG_JSON")]
    pub log_json: bool,

    /// Database connection URL
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: Option<String>,

    /// Optional explicit legacy database URL used for one-way v1 -> v2 import.
    #[arg(long, env = "LEGACY_DATABASE_URL")]
    pub legacy_database_url: Option<String>,

    /// Frontend origin for CORS
    #[arg(
        long,
        env = "EULESIA_FRONTEND_ORIGIN",
        default_value = "http://localhost:5173"
    )]
    pub frontend_origin: String,

    /// Cookie domain
    #[arg(long, env = "EULESIA_COOKIE_DOMAIN")]
    pub cookie_domain: Option<String>,

    /// Set Secure flag on cookies
    #[arg(long, env = "EULESIA_COOKIE_SECURE")]
    pub cookie_secure: bool,

    /// Session max age in days
    #[arg(long, env = "EULESIA_SESSION_MAX_AGE_DAYS", default_value_t = 30)]
    pub session_max_age_days: u32,

    /// Meilisearch URL (optional, disables search if unset)
    #[arg(long, env = "MEILI_URL")]
    pub meili_url: Option<String>,

    /// Meilisearch API key (optional)
    #[arg(long, env = "MEILI_API_KEY")]
    pub meili_api_key: Option<String>,

    /// Path to JSON file with admin accounts to bootstrap on startup
    #[arg(long, env = "ADMIN_BOOTSTRAP_FILE")]
    pub admin_bootstrap_file: Option<String>,

    /// Directory containing the built frontend (serves static files + SPA fallback).
    /// When set, the server serves the frontend directly — no separate webserver needed.
    #[arg(long, env = "EULESIA_FRONTEND_DIR")]
    pub frontend_dir: Option<String>,
}

impl Config {
    pub fn parse() -> Self {
        <Self as Parser>::parse()
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn resolved_legacy_database_url(&self) -> Option<String> {
        self.legacy_database_url
            .clone()
            .or_else(|| derive_legacy_database_url(self.database_url.as_deref()?))
    }
}

fn derive_legacy_database_url(current_database_url: &str) -> Option<String> {
    let (prefix, suffix) = current_database_url.rsplit_once('/')?;
    let (database_name, query) = match suffix.split_once('?') {
        Some((database_name, query)) => (database_name, Some(query)),
        None => (suffix, None),
    };

    if database_name != "eulesia_v2" {
        return None;
    }

    match query {
        Some(query) => Some(format!("{prefix}/eulesia?{query}")),
        None => Some(format!("{prefix}/eulesia")),
    }
}

#[cfg(test)]
mod tests {
    use super::derive_legacy_database_url;

    #[test]
    fn derives_legacy_database_url_for_local_peer_auth() {
        assert_eq!(
            derive_legacy_database_url("postgresql:///eulesia_v2"),
            Some(String::from("postgresql:///eulesia"))
        );
    }

    #[test]
    fn derives_legacy_database_url_with_query_string() {
        assert_eq!(
            derive_legacy_database_url(
                "postgresql://eulesia@db.internal/eulesia_v2?sslmode=disable"
            ),
            Some(String::from(
                "postgresql://eulesia@db.internal/eulesia?sslmode=disable"
            ))
        );
    }

    #[test]
    fn skips_derivation_for_non_v2_database() {
        assert_eq!(derive_legacy_database_url("postgresql:///eulesia"), None);
    }
}
