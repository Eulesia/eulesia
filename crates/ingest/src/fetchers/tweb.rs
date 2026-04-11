//! Tweb (Triplan) minute fetcher.
//!
//! Tweb's public interface lives at `<kunta>.tweb.fi/ktwebbin`. It has three
//! URL types we care about:
//!
//! - `/dbisa.dll/ktwebscr/pk_tek_tweb.htm` — search page listing recent
//!   meetings
//! - `/dbisa.dll/ktwebscr/pk_asil_tweb.htm?+bid=<bid>` — meeting agenda
//! - `/ktproxy2.dll?doctype=3&docid=<id>` — single agenda item HTML
//!
//! No PDF parsing — Tweb serves content as HTML directly.

use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use tracing::debug;

use crate::error::IngestError;
use crate::fetchers::html::strip_html;
use crate::fetchers::types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
use crate::http::RateLimitedClient;
use crate::minutes::dates::parse_fi_date;

const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(2000);
const LISTING_LIMIT: usize = 20;

pub struct TwebFetcher {
    client: RateLimitedClient,
}

impl TwebFetcher {
    pub fn new() -> Result<Self, IngestError> {
        Ok(Self {
            client: RateLimitedClient::with_default_interval(DEFAULT_RATE_LIMIT)?,
        })
    }
}

#[async_trait]
impl MinuteFetcher for TwebFetcher {
    fn fetcher_type(&self) -> FetcherType {
        FetcherType::Tweb
    }

    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError> {
        let search_url = format!("{}/dbisa.dll/ktwebscr/pk_tek_tweb.htm", source.url);
        let response = self.client.get(&search_url).await?;
        if !response.status().is_success() {
            return Err(IngestError::Fetcher {
                context: "tweb listing",
                message: format!("{search_url} returned status {}", response.status()),
            });
        }
        let html = response.text().await.map_err(|source| IngestError::Http {
            context: "read tweb listing",
            source,
        })?;

        let meetings = parse_listing(&html, source);
        debug!(source = %source.entity_name, count = meetings.len(), "parsed tweb listing");
        Ok(meetings.into_iter().take(LISTING_LIMIT).collect())
    }

    async fn extract_content(
        &self,
        meeting: &Meeting,
        source: &MinuteSource,
    ) -> Result<Option<String>, IngestError> {
        let response = self.client.get(&meeting.page_url).await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let agenda_html = response.text().await.map_err(|source| IngestError::Http {
            context: "read tweb agenda",
            source,
        })?;

        let items = parse_agenda_items(&agenda_html);
        if items.is_empty() {
            // No sub-items — fall back to the body of the agenda page itself.
            return Ok(Some(strip_html(&agenda_html)).filter(|s| s.len() > 100));
        }

        let mut parts = Vec::with_capacity(items.len());
        for (doc_id, title) in items {
            let item_url = format!("{}/ktproxy2.dll?doctype=3&docid={doc_id}", source.url);
            let Ok(resp) = self.client.get(&item_url).await else {
                continue;
            };
            if !resp.status().is_success() {
                continue;
            }
            let Ok(html) = resp.text().await else {
                continue;
            };
            let text = strip_html(&html);
            if text.chars().count() > 20 {
                parts.push(format!("§ {title}\n\n{text}"));
            }
        }
        if parts.is_empty() {
            Ok(None)
        } else {
            Ok(Some(parts.join("\n\n---\n\n")))
        }
    }
}

fn parse_listing(html: &str, source: &MinuteSource) -> Vec<Meeting> {
    let re = Regex::new(r#"(?i)pk_asil_tweb\.htm\?\+bid=(\d+)[^"']*["'][^>]*>([^<]*)"#)
        .expect("valid regex");

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    for cap in re.captures_iter(html) {
        let bid = cap[1].to_string();
        if !seen.insert(bid.clone()) {
            continue;
        }
        let link_text = cap[2].trim().to_string();

        let date_str = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})")
            .expect("valid regex")
            .find(&link_text)
            .map(|m| m.as_str().to_string());
        let date = date_str.as_deref().and_then(parse_fi_date);

        // Organ is everything before the first numeric token.
        let organ = link_text
            .split_whitespace()
            .take_while(|word| !word.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
        let organ = if organ.is_empty() { None } else { Some(organ) };

        let title = if link_text.is_empty() {
            format!("Kokous {bid}")
        } else {
            link_text.clone()
        };

        out.push(Meeting {
            id: format!("tweb-{bid}"),
            page_url: format!(
                "{}/dbisa.dll/ktwebscr/pk_asil_tweb.htm?+bid={bid}",
                source.url
            ),
            title,
            date,
            organ,
        });
    }
    out
}

fn parse_agenda_items(html: &str) -> Vec<(String, String)> {
    let re = Regex::new(r#"(?i)ktproxy2\.dll\?[^"']*docid=(\d+)[^"']*["'][^>]*>([^<]*)"#)
        .expect("valid regex");
    re.captures_iter(html)
        .map(|c| (c[1].to_string(), c[2].trim().to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src() -> MinuteSource {
        MinuteSource {
            entity_name: "Uurainen".into(),
            slug: "uurainen".into(),
            fetcher_type: FetcherType::Tweb,
            url: "https://uurainen.tweb.fi/ktwebbin".into(),
            country: "FI".into(),
            language: "fi".into(),
            region: None,
            path_prefix: None,
        }
    }

    #[test]
    fn parses_meeting_links_with_dates() {
        let html = r#"
<a href="pk_asil_tweb.htm?+bid=1234&amp;pre=">Kunnanhallitus 28.3.2026</a>
<a href="pk_asil_tweb.htm?+bid=1235">Valtuusto 14.3.2026</a>
<a href="pk_asil_tweb.htm?+bid=1234">Kunnanhallitus 28.3.2026</a>"#;
        let meetings = parse_listing(html, &src());
        assert_eq!(meetings.len(), 2, "duplicates should be deduped");
        assert_eq!(meetings[0].organ.as_deref(), Some("Kunnanhallitus"));
        assert!(meetings[0].date.is_some());
    }

    #[test]
    fn parses_agenda_items() {
        let html = r#"
<a href="ktproxy2.dll?doctype=3&docid=9001">Kokouksen avaus</a>
<a href="ktproxy2.dll?doctype=3&amp;docid=9002">Kaavoituspäätös</a>"#;
        let items = parse_agenda_items(html);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].1, "Kaavoituspäätös");
    }
}
