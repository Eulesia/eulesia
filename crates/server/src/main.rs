mod config;

use config::Config;
use eulesia_api::AppState;
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

    let db = if let Some(ref url) = config.database_url {
        let conn = eulesia_db::connect(url).await?;
        eulesia_db::migrate(&conn).await?;
        conn
    } else {
        info!("no DATABASE_URL set, running without database");
        sea_orm::Database::connect("sqlite::memory:")
            .await
            .map_err(|e| anyhow::anyhow!("fallback db: {e}"))?
    };

    let state = AppState {
        db: std::sync::Arc::new(db),
    };
    let app = eulesia_api::router(state).layer(TraceLayer::new_for_http());

    let addr = config.bind_addr();
    info!(addr = %addr, "listening");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
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

async fn shutdown_signal() {
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
}
