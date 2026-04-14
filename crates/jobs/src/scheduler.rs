use std::future::Future;
use std::sync::Arc;

use chrono::Utc;
use sea_orm::DatabaseConnection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio_cron_scheduler::{Job, JobScheduler};
use tokio_postgres::NoTls;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::geo_places::{
    LipasImportConfig, LipasImportReport, OsmImportConfig, OsmImportReport, PlaceImportError,
};
use crate::minutes_import::{MinutesImportConfig, MinutesImportReport, MinutesJobError};
use eulesia_common::types::JobStatus;
use eulesia_db::repo::jobs::JobRepo;
use eulesia_db::seed::{self, MunicipalitySyncReport};

#[derive(Clone, Debug)]
pub struct ImportConfig {
    pub lipas: LipasImportConfig,
    pub osm: OsmImportConfig,
    pub minutes: MinutesImportConfig,
}

#[derive(Clone)]
pub struct SchedulerContext {
    pub db: Arc<DatabaseConnection>,
    pub database_url: String,
    pub imports: ImportConfig,
}

#[derive(Debug, Error)]
pub enum SchedulerError {
    #[error("database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("postgres lock error: {0}")]
    Lock(#[from] tokio_postgres::Error),
    #[error("scheduler error: {0}")]
    Scheduler(#[from] tokio_cron_scheduler::JobSchedulerError),
    #[error("place import error: {0}")]
    Place(#[from] PlaceImportError),
    #[error("minutes import error: {0}")]
    Minutes(#[from] MinutesJobError),
    #[error("job skipped because another runner is active: {0}")]
    Skipped(String),
}

pub async fn run(
    ctx: Arc<SchedulerContext>,
    cancel: CancellationToken,
) -> Result<(), SchedulerError> {
    // Municipality reference data is seeded by eulesia-server on startup.
    // The cron job below handles subsequent nightly refreshes.
    let mut scheduler = JobScheduler::new().await?;
    let refresh_ctx = Arc::clone(&ctx);

    add_job(&scheduler, "0 17 3 * * *", move || {
        let refresh_ctx = Arc::clone(&refresh_ctx);
        async move {
            match run_municipality_refresh(refresh_ctx).await {
                Ok(_) | Err(SchedulerError::Skipped(_)) => {}
                Err(error) => error!(error = %error, "scheduled municipality refresh failed"),
            }
        }
    })
    .await?;

    let lipas_ctx = Arc::clone(&ctx);
    add_optional_job(
        &scheduler,
        ctx.imports.lipas.enabled,
        "lipas place sync",
        "0 35 3 * * *",
        move || {
            let lipas_ctx = Arc::clone(&lipas_ctx);
            async move {
                match run_lipas_place_sync(lipas_ctx).await {
                    Ok(_) | Err(SchedulerError::Skipped(_)) => {}
                    Err(error) => error!(error = %error, "scheduled lipas place sync failed"),
                }
            }
        },
    )
    .await?;

    let osm_ctx = Arc::clone(&ctx);
    add_optional_job(
        &scheduler,
        ctx.imports.osm.enabled,
        "osm place sync",
        "0 50 4 * * *",
        move || {
            let osm_ctx = Arc::clone(&osm_ctx);
            async move {
                match run_osm_place_sync(osm_ctx).await {
                    Ok(_) | Err(SchedulerError::Skipped(_)) => {}
                    Err(error) => error!(error = %error, "scheduled osm place sync failed"),
                }
            }
        },
    )
    .await?;

    let minutes_ctx = Arc::clone(&ctx);
    let minutes_schedule = ctx.imports.minutes.schedule.clone();
    add_optional_job(
        &scheduler,
        ctx.imports.minutes.enabled,
        "minutes import",
        &minutes_schedule,
        move || {
            let minutes_ctx = Arc::clone(&minutes_ctx);
            async move {
                match run_minutes_import(minutes_ctx).await {
                    Ok(_) | Err(SchedulerError::Skipped(_)) => {}
                    Err(error) => error!(error = %error, "scheduled minutes import failed"),
                }
            }
        },
    )
    .await?;

    scheduler.start().await?;
    info!("jobs scheduler started");

    cancel.cancelled().await;
    info!("jobs scheduler shutting down");
    scheduler.shutdown().await?;
    Ok(())
}

async fn add_job<F, Fut>(
    scheduler: &JobScheduler,
    schedule: &str,
    run: F,
) -> Result<(), SchedulerError>
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    scheduler
        .add(Job::new_async(schedule, move |_job_id, _scheduler| {
            Box::pin(run())
        })?)
        .await?;
    Ok(())
}

async fn add_optional_job<F, Fut>(
    scheduler: &JobScheduler,
    enabled: bool,
    label: &str,
    schedule: &str,
    run: F,
) -> Result<(), SchedulerError>
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    if enabled {
        add_job(scheduler, schedule, run).await?;
    } else {
        info!("{label} disabled");
    }
    Ok(())
}

pub async fn run_municipality_refresh(
    ctx: Arc<SchedulerContext>,
) -> Result<MunicipalitySyncReport, SchedulerError> {
    run_locked_job(
        Arc::clone(&ctx),
        "municipality-refresh",
        "statfi-2026",
        || async move {
            let report = seed::sync_finnish_municipalities(&ctx.db).await?;
            Ok(report)
        },
    )
    .await
}

pub async fn run_lipas_place_sync(
    ctx: Arc<SchedulerContext>,
) -> Result<LipasImportReport, SchedulerError> {
    let cursor_value = Utc::now().to_rfc3339();

    run_locked_job(
        Arc::clone(&ctx),
        "lipas-place-sync",
        &cursor_value,
        || async move { Ok(crate::geo_places::sync_lipas_places(&ctx.db, &ctx.imports.lipas).await?) },
    )
    .await
}

pub async fn run_osm_place_sync(
    ctx: Arc<SchedulerContext>,
) -> Result<OsmImportReport, SchedulerError> {
    let cursor_value = Utc::now().to_rfc3339();

    run_locked_job(
        Arc::clone(&ctx),
        "osm-place-sync",
        &cursor_value,
        || async move { Ok(crate::geo_places::sync_osm_places(&ctx.db, &ctx.imports.osm).await?) },
    )
    .await
}

pub async fn run_minutes_import(
    ctx: Arc<SchedulerContext>,
) -> Result<MinutesImportReport, SchedulerError> {
    let cursor_value = Utc::now().to_rfc3339();

    run_locked_job(
        Arc::clone(&ctx),
        "minutes-import",
        &cursor_value,
        || async move { Ok(crate::minutes_import::run(&ctx.db, &ctx.imports.minutes).await?) },
    )
    .await
}

async fn run_locked_job<T, F, Fut>(
    ctx: Arc<SchedulerContext>,
    job_name: &str,
    cursor_value: &str,
    run: F,
) -> Result<T, SchedulerError>
where
    T: Serialize,
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, SchedulerError>>,
{
    // tokio_postgres::connect requires an explicit host in the connection
    // string. Unix-socket URLs like `postgresql:///eulesia_v2` (no host)
    // work with sqlx but fail tokio_postgres with "both host and hostaddr
    // are missing". Append a default localhost host if none is present.
    let lock_url = ensure_host_in_url(&ctx.database_url);
    let (lock_client, lock_connection) = tokio_postgres::connect(&lock_url, NoTls).await?;
    tokio::spawn(async move {
        if let Err(error) = lock_connection.await {
            warn!(error = %error, "job lock connection closed");
        }
    });

    let lock_key = advisory_lock_key(job_name);
    let acquired: bool = lock_client
        .query_one("SELECT pg_try_advisory_lock($1)", &[&lock_key])
        .await?
        .try_get(0)?;

    if !acquired {
        let skipped = JobRepo::record_started(&ctx.db, job_name).await?;
        JobRepo::record_finished(
            &ctx.db,
            skipped,
            JobStatus::Skipped,
            Some(serde_json::json!({"reason": "advisory_lock_busy"})),
            None,
        )
        .await?;
        warn!(
            job_name,
            "skipping job because another runner holds the advisory lock"
        );
        return Err(SchedulerError::Skipped(job_name.to_owned()));
    }

    let run_record = JobRepo::record_started(&ctx.db, job_name).await?;
    let result = run().await;

    let finish_result: Result<(), SchedulerError> = match &result {
        Ok(report) => {
            let details = serde_json::to_value(report).unwrap_or_else(|e| {
                warn!("failed to serialize job report: {e}");
                serde_json::json!({})
            });
            JobRepo::record_finished(
                &ctx.db,
                run_record,
                JobStatus::Succeeded,
                Some(details),
                None,
            )
            .await?;
            JobRepo::upsert_cursor(&ctx.db, job_name, Some(cursor_value)).await?;
            info!(job_name, "job completed successfully");
            Ok(())
        }
        Err(error) => {
            JobRepo::record_finished(
                &ctx.db,
                run_record,
                JobStatus::Failed,
                None,
                Some(error.to_string()),
            )
            .await?;
            error!(job_name, error = %error, "job failed");
            Ok(())
        }
    };

    let unlocked: bool = lock_client
        .query_one("SELECT pg_advisory_unlock($1)", &[&lock_key])
        .await?
        .try_get(0)?;

    if !unlocked {
        warn!(job_name, "advisory lock was not held during unlock");
    }

    finish_result?;
    result
}

/// Ensure the connection string has a host. Unix-socket URLs like
/// `postgresql:///dbname` are valid libpq notation but tokio_postgres
/// rejects them with "both host and hostaddr are missing". Adding
/// `?host=/var/run/postgresql` or `host=localhost` fixes it.
fn ensure_host_in_url(url: &str) -> String {
    // If the URL already has a host component (anything between :// and the
    // next / or ?), leave it alone.
    if let Some(after_scheme) = url.strip_prefix("postgresql://") {
        if after_scheme.starts_with('/') {
            // No host: postgresql:///dbname → postgresql://localhost/dbname
            // Use localhost so tokio_postgres connects via TCP to the local
            // PostgreSQL. Alternatively we could use ?host=/var/run/postgresql
            // for Unix sockets, but TCP to localhost is universally safe.
            return format!("postgresql://localhost{after_scheme}");
        }
    }
    if let Some(after_scheme) = url.strip_prefix("postgres://") {
        if after_scheme.starts_with('/') {
            return format!("postgres://localhost{after_scheme}");
        }
    }
    url.to_string()
}

fn advisory_lock_key(job_name: &str) -> i64 {
    let mut hasher = Sha256::new();
    hasher.update(b"eulesia-jobs:");
    hasher.update(job_name.as_bytes());
    let digest = hasher.finalize();
    let bytes: [u8; 8] = digest[..8]
        .try_into()
        .expect("sha256 digest must contain eight bytes");
    i64::from_be_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::{advisory_lock_key, ensure_host_in_url};

    #[test]
    fn ensure_host_adds_localhost_for_unix_socket_url() {
        assert_eq!(
            ensure_host_in_url("postgresql:///eulesia_v2"),
            "postgresql://localhost/eulesia_v2"
        );
        assert_eq!(
            ensure_host_in_url("postgres:///mydb"),
            "postgres://localhost/mydb"
        );
    }

    #[test]
    fn ensure_host_preserves_existing_host() {
        let url = "postgresql://user:pass@db.host:5432/mydb";
        assert_eq!(ensure_host_in_url(url), url);
    }

    #[test]
    fn ensure_host_preserves_localhost() {
        let url = "postgresql://localhost/mydb";
        assert_eq!(ensure_host_in_url(url), url);
    }

    #[test]
    fn advisory_lock_key_is_stable() {
        assert_eq!(
            advisory_lock_key("municipality-refresh"),
            advisory_lock_key("municipality-refresh")
        );
        assert_ne!(
            advisory_lock_key("municipality-refresh"),
            advisory_lock_key("minutes-import")
        );
    }
}
