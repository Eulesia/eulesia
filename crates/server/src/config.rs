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
}

impl Config {
    pub fn parse() -> Self {
        <Self as Parser>::parse()
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
