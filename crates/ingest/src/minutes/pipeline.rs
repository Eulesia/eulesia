//! Single-meeting pipeline: fetch content → 3-stage Mistral pipeline → write.

use sea_orm::DatabaseConnection;
use tracing::{info, warn};

use crate::ai::{MistralClient, Severity, editorial_gate, verify_article, write_article};
use crate::error::IngestError;
use crate::fetchers::{Meeting, MinuteFetcher, MinuteSource};
use crate::minutes::dedup::is_already_imported;
use crate::minutes::institutions::{
    InstitutionKind, find_municipality_by_name, get_or_create_institution,
    resolve_location_for_entity,
};
use crate::minutes::location_resolver::{ResolvedLocation, resolve_location_hints};
use crate::minutes::thread_writer::{ThreadContext, create_thread_from_article};
use crate::minutes::{MinutesImportOptions, MinutesImportReport};

/// Process a single meeting end to end.
pub async fn process_meeting(
    db: &DatabaseConnection,
    mistral: &MistralClient,
    fetcher: &dyn MinuteFetcher,
    meeting: &Meeting,
    source: &MinuteSource,
    options: &MinutesImportOptions,
    report: &mut MinutesImportReport,
) -> Result<(), IngestError> {
    // --- 1. Fetch raw minutes text ---
    let Some(raw_text) = fetcher.extract_content(meeting, source).await? else {
        report.errors.push(format!(
            "{}/{}: empty content",
            source.entity_name, meeting.id
        ));
        return Ok(());
    };

    // --- 2. Resolve municipality + institution placeholder + location ---
    let municipality = find_municipality_by_name(db, &source.entity_name, &source.country).await?;
    if municipality.is_none() {
        warn!(
            source = %source.entity_name,
            "no municipality record found — thread will be created without municipality_id"
        );
    }
    let municipality_id = municipality.as_ref().map(|m| m.id);

    let institution_id = get_or_create_institution(
        db,
        &source.entity_name,
        InstitutionKind::Municipality,
        municipality_id,
    )
    .await?;

    let location_id = resolve_location_for_entity(db, &source.entity_name, &source.country).await?;

    // --- 3. Stage 1: editorial gate ---
    info!(
        source = %source.entity_name,
        meeting = %meeting.id,
        "editorial gate starting"
    );
    let items = editorial_gate(
        mistral,
        &raw_text,
        &source.entity_name,
        meeting.organ.as_deref(),
    )
    .await?;

    let newsworthy: Vec<_> = items.into_iter().filter(|i| i.newsworthy).collect();
    info!(
        source = %source.entity_name,
        meeting = %meeting.id,
        newsworthy = newsworthy.len(),
        "editorial gate completed"
    );

    // --- 4. For each newsworthy item: write → verify → persist ---
    for item in newsworthy {
        let item_source_id = build_source_id(source, meeting, &item.item_number);

        if is_already_imported(db, &item_source_id).await? {
            report.items_skipped += 1;
            continue;
        }

        // Stage 2: write article
        let draft = match write_article(
            mistral,
            &item.excerpt,
            &source.entity_name,
            &item.item_number,
            meeting.organ.as_deref(),
        )
        .await
        {
            Ok(d) => d,
            Err(err) => {
                report
                    .errors
                    .push(format!("{item_source_id}: write_article: {err}"));
                continue;
            }
        };

        // Stage 3: verify
        let verification =
            match verify_article(mistral, &draft, &item.excerpt, &source.entity_name).await {
                Ok(v) => v,
                Err(err) => {
                    report
                        .errors
                        .push(format!("{item_source_id}: verify_article: {err}"));
                    continue;
                }
            };

        if !verification.passed && matches!(verification.severity, Severity::Major) {
            warn!(
                item = %item_source_id,
                issues = ?verification.issues,
                "verification failed — skipping"
            );
            report.errors.push(format!(
                "{item_source_id}: verification failed: {}",
                verification.issues.join("; ")
            ));
            continue;
        }
        if !verification.issues.is_empty() {
            info!(item = %item_source_id, issues = ?verification.issues, "verification minor issues");
        }

        // Stage 3.5: resolve any location hints the writer surfaced.
        // Failures here are non-fatal — fall back to the default location.
        let resolved: ResolvedLocation =
            match resolve_location_hints(db, &draft.location_hints, municipality_id, location_id)
                .await
            {
                Ok(r) => r,
                Err(err) => {
                    warn!(item = %item_source_id, error = %err, "location hint resolution failed");
                    ResolvedLocation {
                        place_id: None,
                        location_id,
                        matched_hint: None,
                    }
                }
            };
        if let Some(hint) = &resolved.matched_hint {
            info!(
                item = %item_source_id,
                hint = %hint,
                place_id = ?resolved.place_id,
                location_id = ?resolved.location_id,
                "resolved location hint"
            );
        }

        if options.dry_run {
            info!(
                item = %item_source_id,
                title = %draft.title,
                "dry-run: would create thread"
            );
            report.items_created += 1;
            continue;
        }

        // Stage 4: persist
        let ctx = ThreadContext {
            source,
            meeting,
            item_source_id: &item_source_id,
            institution_id,
            municipality_id,
            location_id: resolved.location_id,
            place_id: resolved.place_id,
            model_name: mistral.model(),
        };
        create_thread_from_article(db, &draft, &ctx).await?;
        report.items_created += 1;
    }

    Ok(())
}

/// Build a stable source ID for a single agenda item. Deterministic so that
/// a re-run with the same inputs is a no-op via the dedup lookup.
fn build_source_id(source: &MinuteSource, meeting: &Meeting, item_number: &str) -> String {
    let cleaned: String = item_number.chars().filter(|c| !c.is_whitespace()).collect();
    format!("{}-{}-{cleaned}", source.slug, meeting.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetchers::FetcherType;

    fn sample_source() -> MinuteSource {
        MinuteSource {
            entity_name: "Lappeenranta".into(),
            slug: "lappeenranta".into(),
            fetcher_type: FetcherType::MFiles,
            url: "https://mfiles.lappeenranta.fi/Kokoukset/lappeenranta".into(),
            country: "FI".into(),
            language: "fi".into(),
            region: None,
            path_prefix: None,
        }
    }

    fn sample_meeting() -> Meeting {
        Meeting {
            id: "70-1588".into(),
            page_url: "https://mfiles.lappeenranta.fi/Kokoukset/lappeenranta/70/1588".into(),
            title: "Kaupunginhallitus".into(),
            date: None,
            organ: Some("Kaupunginhallitus".into()),
        }
    }

    #[test]
    fn source_id_is_whitespace_free() {
        let id = build_source_id(&sample_source(), &sample_meeting(), "§ 5");
        assert_eq!(id, "lappeenranta-70-1588-§5");
    }
}
