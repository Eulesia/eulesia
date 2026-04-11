//! M-Files minute fetcher.
//!
//! M-Files is the document management system used by, among others,
//! Lappeenranta, Imatra, Eksote and Ekhva. A site looks like
//! `https://mfiles.<slug>.fi/Kokoukset/<slug>` and lists decision-making
//! bodies in a simple HTML table, each with their latest meeting date
//! and a link to either the Pöytäkirja (signed minutes) or the
//! Esityslista (agenda).
//!
//! Phase 1 implementation: parse only the top-level listing. Each body is
//! represented by its latest meeting. Because the cron job runs nightly
//! and council bodies rarely meet more than once a week, this catches
//! essentially everything without crawling each body's history page.
//! A full per-body crawl can be layered on later if we start missing
//! meetings.

use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use scraper::{Html, Selector};
use tracing::{debug, warn};

use crate::error::IngestError;
use crate::fetchers::types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
use crate::http::RateLimitedClient;
use crate::minutes::dates::parse_fi_date;
use crate::pdf;

/// How long to wait between requests to the same M-Files host.
const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(1500);

pub struct MFilesFetcher {
    client: RateLimitedClient,
}

impl MFilesFetcher {
    pub fn new() -> Result<Self, IngestError> {
        Ok(Self {
            client: RateLimitedClient::with_default_interval(DEFAULT_RATE_LIMIT)?,
        })
    }
}

#[async_trait]
impl MinuteFetcher for MFilesFetcher {
    fn fetcher_type(&self) -> FetcherType {
        FetcherType::MFiles
    }

    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError> {
        let response = self.client.get(&source.url).await?;
        let status = response.status();
        if !status.is_success() {
            return Err(IngestError::Fetcher {
                context: "mfiles listing",
                message: format!("{} returned status {status}", source.url),
            });
        }
        let html = response.text().await.map_err(|source| IngestError::Http {
            context: "read mfiles listing body",
            source,
        })?;

        let meetings = parse_listing(&html, source);
        debug!(
            source = %source.slug,
            count = meetings.len(),
            "parsed mfiles listing"
        );
        Ok(meetings)
    }

    async fn extract_content(
        &self,
        meeting: &Meeting,
        _source: &MinuteSource,
    ) -> Result<Option<String>, IngestError> {
        let response = self.client.get(&meeting.page_url).await?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            warn!(url = %meeting.page_url, "mfiles document missing (404)");
            return Ok(None);
        }
        if !status.is_success() {
            return Err(IngestError::Fetcher {
                context: "mfiles document",
                message: format!("{} returned status {status}", meeting.page_url),
            });
        }

        let bytes = response.bytes().await.map_err(|source| IngestError::Http {
            context: "download mfiles document",
            source,
        })?;

        // M-Files serves a PDF when you open a document URL. Extract the text.
        let text = pdf::extract_text(&bytes)?;
        if text.trim().is_empty() {
            warn!(url = %meeting.page_url, "mfiles document returned empty text");
            return Ok(None);
        }
        Ok(Some(text))
    }
}

/// Parse the body listing page into [`Meeting`] rows.
///
/// Only rows whose document link is titled "Pöytäkirja" survive — the
/// agenda ("Esityslista") is skipped because it is published before the
/// meeting and its content is not authoritative for summarisation.
fn parse_listing(html: &str, source: &MinuteSource) -> Vec<Meeting> {
    let document = Html::parse_document(html);
    let row_selector = Selector::parse("tr").expect("static selector must compile");
    let cell_selector = Selector::parse("td").expect("static selector must compile");
    let anchor_selector = Selector::parse("a").expect("static selector must compile");

    // Body link: /Kokoukset/<slug>/<body_id>
    let body_href =
        Regex::new(r"(?i)/Kokoukset/[^/]+/(\d+)/?$").expect("static regex must compile");
    // Document link: /Kokoukset/<slug>/<body_id>/<doc_id>
    let doc_href =
        Regex::new(r"(?i)/Kokoukset/[^/]+/(\d+)/(\d+)/?$").expect("static regex must compile");
    let date_pattern = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})").expect("static regex must compile");

    let mut meetings = Vec::new();

    for row in document.select(&row_selector) {
        let mut body_id: Option<String> = None;
        let mut body_name: Option<String> = None;
        let mut doc_id: Option<String> = None;
        let mut doc_href_str: Option<String> = None;
        let mut doc_label: Option<String> = None;

        for anchor in row.select(&anchor_selector) {
            let Some(href) = anchor.value().attr("href") else {
                continue;
            };
            let label = anchor.text().collect::<String>().trim().to_string();

            if let Some(caps) = doc_href.captures(href) {
                // Document link — only take the first one.
                if doc_id.is_none() {
                    doc_id = Some(caps[2].to_string());
                    doc_href_str = Some(href.to_string());
                    doc_label = Some(label);
                }
            } else if let Some(caps) = body_href.captures(href) {
                if body_id.is_none() {
                    body_id = Some(caps[1].to_string());
                    body_name = Some(label);
                }
            }
        }

        let Some(doc_id) = doc_id else {
            continue;
        };
        let Some(body_id) = body_id else {
            continue;
        };
        let Some(doc_label) = doc_label else {
            continue;
        };

        // Only proceed for actual signed minutes, not draft agendas.
        if !is_poytakirja(&doc_label) {
            continue;
        }

        // Find a date string anywhere in the row cells.
        let date = row
            .select(&cell_selector)
            .flat_map(|cell| {
                let text = cell.text().collect::<String>();
                date_pattern
                    .find(&text)
                    .map(|m| m.as_str().to_string())
                    .into_iter()
                    .collect::<Vec<_>>()
            })
            .next()
            .and_then(|s| parse_fi_date(&s));

        let href = doc_href_str.expect("set above when doc_id is set");
        let page_url = absolute_url(&source.url, &href);
        let id = format!("{body_id}-{doc_id}");

        meetings.push(Meeting {
            id,
            page_url,
            title: body_name
                .clone()
                .unwrap_or_else(|| format!("{} kokous", source.entity_name)),
            date,
            organ: body_name,
        });
    }

    meetings
}

/// Resolve a (possibly relative) href against the listing URL.
fn absolute_url(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    if let Ok(parsed) = url::Url::parse(base) {
        if let Ok(joined) = parsed.join(href) {
            return joined.to_string();
        }
    }
    // Fallback: crude prefix.
    format!(
        "{}{}",
        base.trim_end_matches('/'),
        if href.starts_with('/') {
            href.to_string()
        } else {
            format!("/{href}")
        }
    )
}

fn is_poytakirja(label: &str) -> bool {
    let lower = label.to_lowercase();
    // Accept any label that contains "pöytäkirja" (with or without dotless o)
    // while rejecting "esityslista".
    if lower.contains("esityslista") {
        return false;
    }
    lower.contains("pöytäkirja") || lower.contains("poytakirja")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"
<html>
<body>
<table>
  <tr>
    <td><a href="/Kokoukset/lappeenranta/124">Asukas- ja alueneuvosto</a></td>
    <td>1.4.2026</td>
    <td><a href="/Kokoukset/lappeenranta/124/1756">Esityslista</a></td>
  </tr>
  <tr>
    <td><a href="/Kokoukset/lappeenranta/70">Kaupunginhallitus 2021 - 2025</a></td>
    <td>28.3.2026</td>
    <td><a href="/Kokoukset/lappeenranta/70/1588">Pöytäkirja</a></td>
  </tr>
  <tr>
    <td><a href="/Kokoukset/lappeenranta/116">Kaupunginvaltuusto</a></td>
    <td>14.3.2026</td>
    <td><a href="/Kokoukset/lappeenranta/116/1512">Pöytäkirja</a></td>
  </tr>
</table>
</body>
</html>"#;

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

    #[test]
    fn parses_only_signed_minutes() {
        let meetings = parse_listing(FIXTURE, &sample_source());
        assert_eq!(meetings.len(), 2);
        let titles: Vec<_> = meetings.iter().map(|m| m.organ.clone().unwrap()).collect();
        assert!(titles.iter().any(|t| t.contains("Kaupunginhallitus")));
        assert!(titles.iter().any(|t| t == "Kaupunginvaltuusto"));
        assert!(!titles.iter().any(|t| t.contains("Asukas- ja alueneuvosto")));
    }

    #[test]
    fn meeting_ids_are_unique_and_stable() {
        let meetings = parse_listing(FIXTURE, &sample_source());
        assert_eq!(meetings[0].id, "70-1588");
        assert_eq!(meetings[1].id, "116-1512");
    }

    #[test]
    fn meeting_urls_are_absolute() {
        let meetings = parse_listing(FIXTURE, &sample_source());
        for m in &meetings {
            assert!(m.page_url.starts_with("https://mfiles.lappeenranta.fi/"));
        }
    }

    #[test]
    fn dates_parsed_from_finnish_format() {
        let meetings = parse_listing(FIXTURE, &sample_source());
        let kh = meetings
            .iter()
            .find(|m| {
                m.organ
                    .as_deref()
                    .unwrap_or("")
                    .contains("Kaupunginhallitus")
            })
            .unwrap();
        let date = kh.date.expect("date should be parsed");
        assert_eq!(date.to_string(), "2026-03-28");
    }

    #[test]
    fn is_poytakirja_accepts_both_spellings() {
        assert!(is_poytakirja("Pöytäkirja"));
        assert!(is_poytakirja("POYTAKIRJA"));
        assert!(is_poytakirja("pöytäkirja (allekirjoitettu)"));
        assert!(!is_poytakirja("Esityslista"));
        assert!(!is_poytakirja("Kokouskutsu"));
    }

    #[test]
    fn absolute_url_joins_relative_hrefs() {
        let base = "https://mfiles.lappeenranta.fi/Kokoukset/lappeenranta";
        assert_eq!(
            absolute_url(base, "/Kokoukset/lappeenranta/70/1588"),
            "https://mfiles.lappeenranta.fi/Kokoukset/lappeenranta/70/1588"
        );
        assert_eq!(
            absolute_url(base, "https://other.example/foo"),
            "https://other.example/foo"
        );
    }
}
