use std::sync::Arc;

use clap::Parser;
use tokio_util::sync::CancellationToken;
use tracing::info;

#[derive(Parser, Debug, Clone)]
#[command(name = "eulesia-jobs", about = "Eulesia scheduled jobs runner")]
struct Config {
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    #[arg(long, env = "EULESIA_JOBS_LOG_LEVEL", default_value = "info")]
    log_level: String,

    #[arg(long, env = "EULESIA_JOBS_LOG_JSON")]
    log_json: bool,

    #[arg(long, env = "EULESIA_JOBS_RUN_ONCE")]
    run_once: bool,

    #[arg(long, env = "EULESIA_JOBS_RUN_JOB")]
    run_job: Option<String>,

    #[arg(long, env = "EULESIA_JOBS_LIPAS_ENABLED")]
    lipas_enabled: bool,

    #[arg(
        long,
        env = "EULESIA_JOBS_LIPAS_BASE_URL",
        default_value = "https://api.lipas.fi/v2"
    )]
    lipas_base_url: String,

    #[arg(long, env = "EULESIA_JOBS_LIPAS_PAGE_SIZE", default_value_t = 100)]
    lipas_page_size: u32,

    #[arg(long, env = "EULESIA_JOBS_OSM_ENABLED")]
    osm_enabled: bool,

    #[arg(
        long,
        env = "EULESIA_JOBS_OSM_INTERPRETER_URL",
        default_value = "https://overpass-api.de/api/interpreter"
    )]
    osm_interpreter_url: String,

    #[arg(long, env = "EULESIA_JOBS_OSM_TIMEOUT_SECONDS", default_value_t = 180)]
    osm_timeout_seconds: u32,

    #[arg(long, env = "EULESIA_JOBS_MINUTES_ENABLED")]
    minutes_enabled: bool,

    #[arg(
        long,
        env = "EULESIA_JOBS_MINUTES_SCHEDULE",
        default_value = "0 30 2 * * *"
    )]
    minutes_schedule: String,

    #[arg(long, env = "EULESIA_JOBS_MINUTES_MAX_AGE_DAYS", default_value_t = 7)]
    minutes_max_age_days: i64,

    #[arg(
        long,
        env = "EULESIA_JOBS_MINUTES_LIMIT_PER_SOURCE",
        default_value_t = 10
    )]
    minutes_limit_per_source: usize,

    #[arg(long, env = "EULESIA_JOBS_MINUTES_DRY_RUN")]
    minutes_dry_run: bool,

    #[arg(long, env = "MISTRAL_API_KEY", default_value = "")]
    mistral_api_key: String,

    #[arg(long, env = "MISTRAL_MODEL")]
    mistral_model: Option<String>,

    #[arg(long, env = "MISTRAL_RATE_LIMIT_MS")]
    mistral_rate_limit_ms: Option<u64>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::parse();
    init_logging(&config);

    info!(version = env!("CARGO_PKG_VERSION"), "starting eulesia-jobs");

    let db = eulesia_db::connect(&config.database_url).await?;
    // Migrations are owned by eulesia-server which starts first.
    // Running them here races with the server on concurrent startup.

    let ctx = Arc::new(eulesia_jobs::scheduler::SchedulerContext {
        db: Arc::new(db),
        database_url: config.database_url.clone(),
        imports: eulesia_jobs::scheduler::ImportConfig {
            lipas: eulesia_jobs::geo_places::LipasImportConfig {
                enabled: config.lipas_enabled,
                base_url: config.lipas_base_url.clone(),
                page_size: config.lipas_page_size,
            },
            osm: eulesia_jobs::geo_places::OsmImportConfig {
                enabled: config.osm_enabled,
                interpreter_url: config.osm_interpreter_url.clone(),
                timeout_seconds: config.osm_timeout_seconds,
            },
            minutes: eulesia_jobs::minutes_import::MinutesImportConfig {
                enabled: config.minutes_enabled,
                schedule: config.minutes_schedule.clone(),
                mistral_api_key: config.mistral_api_key.clone(),
                mistral_model: config.mistral_model.clone(),
                rate_limit_ms: config.mistral_rate_limit_ms,
                max_age_days: config.minutes_max_age_days,
                limit_per_source: config.minutes_limit_per_source,
                dry_run: config.minutes_dry_run,
            },
        },
    });

    if let Some(job_name) = config.run_job.as_deref() {
        run_named_job(ctx, job_name).await?;
        return Ok(());
    }

    if config.run_once {
        let report = eulesia_jobs::scheduler::run_municipality_refresh(ctx).await?;
        info!(?report, "run-once municipality refresh completed");
        return Ok(());
    }

    let cancel = CancellationToken::new();
    let signal_cancel = cancel.clone();
    tokio::spawn(async move {
        shutdown_signal(signal_cancel).await;
    });
    eulesia_jobs::scheduler::run(ctx, cancel).await?;
    Ok(())
}

async fn run_named_job(
    ctx: Arc<eulesia_jobs::scheduler::SchedulerContext>,
    job_name: &str,
) -> anyhow::Result<()> {
    match job_name {
        "municipality-refresh" => {
            let report = eulesia_jobs::scheduler::run_municipality_refresh(ctx).await?;
            info!(?report, "named municipality refresh completed");
        }
        "lipas-place-sync" => {
            let report = eulesia_jobs::scheduler::run_lipas_place_sync(ctx).await?;
            info!(?report, "named lipas place sync completed");
        }
        "osm-place-sync" => {
            let report = eulesia_jobs::scheduler::run_osm_place_sync(ctx).await?;
            info!(?report, "named osm place sync completed");
        }
        "minutes-import" => {
            let report = eulesia_jobs::scheduler::run_minutes_import(ctx).await?;
            info!(?report, "named minutes import completed");
        }
        other => anyhow::bail!("unknown job name: {other}"),
    }

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

    info!("cancelling scheduled jobs");
    cancel.cancel();
}
