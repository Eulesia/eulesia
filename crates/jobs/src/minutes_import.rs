//! Job-level wrapper around `eulesia-ingest`'s minutes importer.
//!
//! The heavy lifting (fetching, parsing, AI pipeline, DB writes) lives in
//! [`eulesia_ingest::minutes`]. This module holds only the config shape
//! and the scheduler bridging code.

use sea_orm::DatabaseConnection;
use serde::Serialize;
use thiserror::Error;

use eulesia_ingest::IngestError;
use eulesia_ingest::ai::MistralClient;
use eulesia_ingest::minutes::{self, MinutesImportOptions, MinutesImportReport as IngestReport};

/// Configuration passed through `SchedulerContext::imports.minutes`.
#[derive(Debug, Clone)]
pub struct MinutesImportConfig {
    pub enabled: bool,
    pub schedule: String,
    pub mistral_api_key: String,
    pub mistral_model: Option<String>,
    pub rate_limit_ms: Option<u64>,
    pub max_age_days: i64,
    pub limit_per_source: usize,
    pub dry_run: bool,
}

impl Default for MinutesImportConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            schedule: "0 30 2 * * *".into(),
            mistral_api_key: String::new(),
            mistral_model: None,
            rate_limit_ms: None,
            max_age_days: 7,
            limit_per_source: 10,
            dry_run: false,
        }
    }
}

/// Serializable report wrapper — plain `eulesia_ingest::MinutesImportReport`
/// is already `Serialize`, but we re-export it here so schedulers don't
/// need to depend on the ingest crate directly.
#[derive(Debug, Clone, Serialize)]
pub struct MinutesImportReport {
    #[serde(flatten)]
    pub inner: IngestReport,
}

#[derive(Debug, Error)]
pub enum MinutesJobError {
    #[error("ingest error: {0}")]
    Ingest(#[from] IngestError),
}

/// Run the minutes importer once with the given configuration.
pub async fn run(
    db: &DatabaseConnection,
    config: &MinutesImportConfig,
) -> Result<MinutesImportReport, MinutesJobError> {
    let mistral = MistralClient::new(
        config.mistral_api_key.clone(),
        config.mistral_model.clone(),
        config.rate_limit_ms,
    )?;
    let options = MinutesImportOptions {
        dry_run: config.dry_run,
        max_age_days: config.max_age_days,
        limit_per_source: config.limit_per_source,
        municipalities: None,
    };
    let report = minutes::run_import(db, &mistral, &options).await?;
    Ok(MinutesImportReport { inner: report })
}
