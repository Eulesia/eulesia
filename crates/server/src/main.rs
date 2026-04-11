mod config;

use std::sync::Arc;

use axum::http::{HeaderValue, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use config::Config;
use eulesia_api::{AppConfig, AppState};
use tokio_util::sync::CancellationToken;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowHeaders, AllowMethods, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

fn should_spa_fallback(path: &str) -> bool {
    if path.starts_with("/api/")
        || path.starts_with("/assets/")
        || path.starts_with("/ws/")
        || path.starts_with("/uploads/")
    {
        return false;
    }

    let last_segment = path.rsplit('/').next().unwrap_or(path);
    !last_segment.contains('.')
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::parse();
    init_logging(&config);

    info!(
        version = env!("CARGO_PKG_VERSION"),
        "starting eulesia-server"
    );

    let database_url = config
        .database_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("DATABASE_URL is required"))?;

    let db = eulesia_db::connect(database_url).await?;
    eulesia_db::migrate(&db).await?;
    let seed_report = eulesia_db::seed::sync_reference_data(&db).await?;
    info!(?seed_report, "reference data synced");

    if let Some(legacy_database_url) = config.resolved_legacy_database_url() {
        match eulesia_db::connect(&legacy_database_url).await {
            Ok(legacy_db) => {
                let report =
                    eulesia_db::legacy_import::import_legacy_social_data(&db, &legacy_db).await?;
                info!(?report, "legacy social import finished");
            }
            Err(error) => {
                warn!(
                    database_url = %legacy_database_url,
                    error = %error,
                    "legacy database unavailable, skipping import"
                );
            }
        }
    }

    // Bootstrap admin accounts from SOPS-managed JSON file (idempotent).
    if let Some(ref path) = config.admin_bootstrap_file {
        bootstrap_admins(&db, path).await?;
    }

    let db = Arc::new(db);

    let app_config = AppConfig {
        cookie_domain: config.cookie_domain.clone(),
        cookie_secure: config.cookie_secure,
        session_max_age_days: config.session_max_age_days,
        frontend_origin: config.frontend_origin.clone(),
    };

    // Optionally create Meilisearch search client and configure indexes
    let search_client = if let Some(ref url) = config.meili_url {
        let client =
            eulesia_search::client::SearchClient::new(url, config.meili_api_key.as_deref())
                .map_err(|e| anyhow::anyhow!(e))?;
        info!("Meilisearch client configured at {url}");

        // Ensure indexes exist with correct settings
        eulesia_search::indexes::ensure_indexes(client.inner()).await;

        Some(Arc::new(client))
    } else {
        None
    };

    let ws_registry = eulesia_ws::registry::ConnectionRegistry::new();

    let ftn_config = eulesia_api::ftn::FtnConfig::from_env().map(Arc::new);
    if ftn_config.is_some() {
        info!("FTN (Idura) authentication enabled");
    }

    let state = AppState {
        db: Arc::clone(&db),
        config: Arc::new(app_config),
        search_client: search_client.clone(),
        ws_registry,
        ftn_config,
    };

    let cors = CorsLayer::new()
        .allow_origin(
            config
                .frontend_origin
                .parse::<axum::http::HeaderValue>()
                .expect("invalid EULESIA_FRONTEND_ORIGIN"),
        )
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
        .allow_credentials(true);

    let upload_dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into());
    let mut app = eulesia_api::router(state).nest_service("/uploads", ServeDir::new(upload_dir));

    // Optionally serve the built frontend — eliminates the need for a
    // separate webserver (nginx). Hashed assets get immutable caching;
    // index.html is never cached so deploys take effect immediately.
    if let Some(ref frontend_dir) = config.frontend_dir {
        info!(dir = %frontend_dir, "serving frontend");
        let frontend_dir = frontend_dir.clone();
        let index_path = std::path::PathBuf::from(&frontend_dir).join("index.html");

        // Serve static files WITHOUT SPA fallback — missing assets return 404,
        // not index.html. This prevents stale hashed asset URLs from being
        // cached as HTML with immutable headers.
        let static_files = ServeDir::new(&frontend_dir).fallback(axum::routing::get(
            move |req: axum::extract::Request| {
                let index = index_path.clone();
                async move {
                    let path = req.uri().path();
                    if !should_spa_fallback(path) {
                        return axum::http::StatusCode::NOT_FOUND.into_response();
                    }

                    // Everything else → SPA index.html (navigation routes)
                    match tokio::fs::read(&index).await {
                        Ok(body) => axum::response::Html(body).into_response(),
                        Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                    }
                }
            },
        ));

        app = app
            .fallback_service(static_files)
            .layer(middleware::from_fn(cache_headers));
    }

    let app = app
        .layer(cors)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http());

    // Build outbox worker context with optional integrations
    let dispatcher = Arc::new(eulesia_notify::dispatch::NotificationDispatcher::new(
        Arc::clone(&db),
    ));
    let search_sync = search_client
        .as_ref()
        .map(|c| Arc::new(eulesia_search::sync::SearchSync::new(c.inner().clone())));
    let worker_ctx = Arc::new(eulesia_jobs::outbox_worker::WorkerContext {
        db: Arc::clone(&db),
        dispatcher: Some(dispatcher),
        search_sync,
    });

    // Spawn outbox worker
    let cancel = CancellationToken::new();
    let worker_cancel = cancel.clone();
    tokio::spawn(async move {
        eulesia_jobs::outbox_worker::run(worker_ctx, worker_cancel).await;
    });

    let addr = config.bind_addr();
    info!(addr = %addr, "listening");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(cancel))
        .await?;

    info!("server stopped");
    Ok(())
}

fn init_logging(config: &Config) {
    use tracing_subscriber::{EnvFilter, fmt, prelude::*};

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(&config.log_level));

    if config.log_json {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt::layer())
            .init();
    }
}

#[cfg(test)]
mod tests {
    use super::should_spa_fallback;

    #[test]
    fn spa_navigation_routes_fall_back_to_index() {
        assert!(should_spa_fallback("/"));
        assert!(should_spa_fallback("/profile"));
        assert!(should_spa_fallback("/messages/direct"));
    }

    #[test]
    fn file_like_requests_do_not_fall_back_to_index() {
        assert!(!should_spa_fallback("/sw.js"));
        assert!(!should_spa_fallback("/manifest.webmanifest"));
        assert!(!should_spa_fallback("/favicon.svg"));
        assert!(!should_spa_fallback("/locales/fi/profile.json"));
        assert!(!should_spa_fallback("/icons/missing.webp"));
    }

    #[test]
    fn reserved_prefixes_never_fall_back_to_index() {
        assert!(!should_spa_fallback("/api/v1/health"));
        assert!(!should_spa_fallback("/assets/missing.js"));
        assert!(!should_spa_fallback("/ws/v2"));
        assert!(!should_spa_fallback("/uploads/missing.png"));
    }
}

async fn shutdown_signal(cancel: CancellationToken) {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install ctrl+c handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => info!("received ctrl+c"),
        () = terminate => info!("received SIGTERM"),
    }

    info!("cancelling background workers");
    cancel.cancel();
}

/// Bootstrap admin accounts from a SOPS-managed JSON file.
///
/// Idempotent: inserts new accounts, reseeds passwords when
/// `reseedPassword` is true. Safe to run on every server start.
async fn bootstrap_admins(db: &sea_orm::DatabaseConnection, path: &str) -> anyhow::Result<()> {
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AdminEntry {
        username: String,
        email: Option<String>,
        name: String,
        password: String,
        managed_key: String,
        #[serde(default)]
        reseed_password: bool,
    }

    let content = tokio::fs::read_to_string(path).await?;
    let entries: Vec<AdminEntry> = serde_json::from_str(&content)?;
    info!(count = entries.len(), "bootstrapping admin accounts");

    for entry in &entries {
        // Argon2 is CPU-intensive — run off the async executor.
        let pw = entry.password.clone();
        let hash = tokio::task::spawn_blocking(move || eulesia_auth::password::hash_password(&pw))
            .await??;

        let sql = if entry.reseed_password {
            r"INSERT INTO admin_accounts (id, username, email, password_hash, name, managed_by, managed_key, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, 'sops', $5, NOW(), NOW())
               ON CONFLICT (username) DO UPDATE SET
                 password_hash = $3, name = $4, email = $2, updated_at = NOW()"
        } else {
            r"INSERT INTO admin_accounts (id, username, email, password_hash, name, managed_by, managed_key, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, 'sops', $5, NOW(), NOW())
               ON CONFLICT (username) DO UPDATE SET
                 name = $4, email = $2, updated_at = NOW()"
        };

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            [
                entry.username.as_str().into(),
                entry.email.as_deref().into(),
                hash.as_str().into(),
                entry.name.as_str().into(),
                entry.managed_key.as_str().into(),
            ],
        ))
        .await?;

        info!(username = %entry.username, reseed = entry.reseed_password, "admin account synced");
    }

    Ok(())
}

/// Middleware: set `Cache-Control` based on request path.
/// - Fingerprinted Vite assets under `/assets/`: immutable, cached 1 year
/// - HTML / SPA fallback routes: never cached
async fn cache_headers(req: axum::extract::Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut resp = next.run(req).await;

    // Skip API routes, uploads, and websocket — they set their own headers
    if path.starts_with("/api/") || path.starts_with("/uploads/") || path.starts_with("/ws/") {
        return resp;
    }

    // Only cache successful responses for hashed assets — never cache 404/5xx
    let is_hashed_asset = path.starts_with("/assets/") && resp.status().is_success();

    let value = if is_hashed_asset {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache, no-store, must-revalidate"
    };

    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));

    resp
}
