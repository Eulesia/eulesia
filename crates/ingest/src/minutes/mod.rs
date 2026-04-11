//! Meeting-minutes import orchestration.
//!
//! Top-level entry point is [`run_import`], which walks every configured
//! [`crate::sources::all_sources`] entry, hands it to the appropriate
//! fetcher, runs each meeting through the 3-stage Mistral pipeline, and
//! writes the resulting articles as Agora threads.

use std::collections::VecDeque;

use chrono::{NaiveDate, Utc};
use sea_orm::DatabaseConnection;
use serde::Serialize;
use tracing::{info, warn};

use crate::ai::MistralClient;
use crate::error::IngestError;
use crate::fetchers::{
    CloudNcFetcher, DynastyFetcher, FetcherType, MFilesFetcher, Meeting, MinuteFetcher,
    MinuteSource, TwebFetcher,
};
use crate::sources::all_sources;

pub mod dates;
pub mod dedup;
pub mod institutions;
pub mod location_resolver;
pub mod pipeline;
pub mod thread_writer;

/// Runtime options passed into [`run_import`].
#[derive(Debug, Clone)]
pub struct MinutesImportOptions {
    /// When true, the importer still fetches and summarises meetings but
    /// does not write anything to the database.
    pub dry_run: bool,
    /// Only process meetings newer than this many days. Meetings without a
    /// parseable date are always skipped.
    pub max_age_days: i64,
    /// Maximum number of meetings processed per source per run. Prevents a
    /// single misbehaving municipality from monopolising the AI budget.
    pub limit_per_source: usize,
    /// When set, restrict processing to the listed entity names
    /// (case-insensitive). Useful for manual runs.
    pub municipalities: Option<Vec<String>>,
}

impl Default for MinutesImportOptions {
    fn default() -> Self {
        Self {
            dry_run: false,
            max_age_days: 7,
            limit_per_source: 10,
            municipalities: None,
        }
    }
}

/// Summary of a single [`run_import`] call.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MinutesImportReport {
    pub sources_processed: usize,
    pub meetings_fetched: usize,
    pub meetings_considered: usize,
    pub items_created: usize,
    pub items_skipped: usize,
    pub errors: Vec<String>,
}

/// Run the import pipeline end to end.
///
/// Errors from individual sources or meetings are accumulated in
/// [`MinutesImportReport::errors`] rather than aborting the whole run —
/// one broken municipality should not starve the others.
pub async fn run_import(
    db: &DatabaseConnection,
    mistral: &MistralClient,
    options: &MinutesImportOptions,
) -> Result<MinutesImportReport, IngestError> {
    let mut report = MinutesImportReport::default();
    let all = all_sources();
    let filtered: Vec<MinuteSource> = all
        .into_iter()
        .filter(|s| source_matches_filter(s, options))
        .collect();

    if filtered.is_empty() {
        warn!("minutes import: no sources to process");
        return Ok(report);
    }

    info!(
        sources = filtered.len(),
        dry_run = options.dry_run,
        max_age_days = options.max_age_days,
        limit_per_source = options.limit_per_source,
        "minutes import started"
    );

    // Build one fetcher instance per fetcher type, owning its own rate limiter.
    let mfiles = MFilesFetcher::new()?;
    let dynasty = DynastyFetcher::new()?;
    let cloudnc = CloudNcFetcher::new()?;
    let tweb = TwebFetcher::new()?;

    let pick_fetcher = |ty: FetcherType| -> Option<&dyn MinuteFetcher> {
        match ty {
            FetcherType::MFiles => Some(&mfiles as &dyn MinuteFetcher),
            FetcherType::Dynasty => Some(&dynasty as &dyn MinuteFetcher),
            FetcherType::CloudNc => Some(&cloudnc as &dyn MinuteFetcher),
            FetcherType::Tweb => Some(&tweb as &dyn MinuteFetcher),
            FetcherType::Adaptive => None,
        }
    };

    // Pre-fetch meeting lists for every source so we can round-robin them
    // after filtering. Rate limits apply per-fetcher instance internally.
    let cutoff = recent_cutoff(options.max_age_days);
    let mut queues: Vec<(MinuteSource, VecDeque<Meeting>)> = Vec::new();

    for source in filtered {
        report.sources_processed += 1;
        let Some(fetcher) = pick_fetcher(source.fetcher_type) else {
            report.errors.push(format!(
                "{}: fetcher type {:?} not implemented yet",
                source.entity_name, source.fetcher_type
            ));
            continue;
        };
        let meetings = match fetcher.fetch_meetings(&source).await {
            Ok(m) => m,
            Err(err) => {
                warn!(source = %source.entity_name, error = %err, "fetch_meetings failed");
                report.errors.push(format!("{}: {err}", source.entity_name));
                continue;
            }
        };
        report.meetings_fetched += meetings.len();

        let filtered_meetings: Vec<Meeting> = meetings
            .into_iter()
            .filter(|m| meeting_is_recent(m, cutoff))
            .take(options.limit_per_source)
            .collect();
        report.meetings_considered += filtered_meetings.len();

        queues.push((source, filtered_meetings.into()));
    }

    // Round-robin: process one meeting per source per round, so a single
    // prolific source cannot starve its neighbours under rate limits.
    loop {
        let mut any_work = false;
        for (source, queue) in &mut queues {
            let Some(meeting) = queue.pop_front() else {
                continue;
            };
            any_work = true;

            let Some(fetcher) = pick_fetcher(source.fetcher_type) else {
                continue;
            };

            let result = pipeline::process_meeting(
                db,
                mistral,
                fetcher,
                &meeting,
                source,
                options,
                &mut report,
            )
            .await;

            if let Err(err) = result {
                warn!(
                    source = %source.entity_name,
                    meeting = %meeting.id,
                    error = %err,
                    "process_meeting failed"
                );
                report
                    .errors
                    .push(format!("{}/{}: {err}", source.entity_name, meeting.id));
            }
        }
        if !any_work {
            break;
        }
    }

    info!(
        sources_processed = report.sources_processed,
        meetings_fetched = report.meetings_fetched,
        meetings_considered = report.meetings_considered,
        items_created = report.items_created,
        items_skipped = report.items_skipped,
        errors = report.errors.len(),
        "minutes import finished"
    );
    Ok(report)
}

fn source_matches_filter(source: &MinuteSource, options: &MinutesImportOptions) -> bool {
    match &options.municipalities {
        None => true,
        Some(list) => list
            .iter()
            .any(|name| name.eq_ignore_ascii_case(&source.entity_name)),
    }
}

fn recent_cutoff(max_age_days: i64) -> NaiveDate {
    let today = Utc::now().date_naive();
    today - chrono::Duration::days(max_age_days)
}

fn meeting_is_recent(meeting: &Meeting, cutoff: NaiveDate) -> bool {
    match meeting.date {
        Some(date) => date >= cutoff,
        None => false,
    }
}
