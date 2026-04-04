mod config;

use std::sync::Arc;

use config::Config;
use eulesia_api::{AppConfig, AppState};
use tokio_util::sync::CancellationToken;
use tower_http::cors::{AllowHeaders, AllowMethods, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

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

    let state = AppState {
        db: Arc::clone(&db),
        config: Arc::new(app_config),
        search_client: search_client.clone(),
        ws_registry,
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

    let app = eulesia_api::router(state)
        .layer(cors)
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
