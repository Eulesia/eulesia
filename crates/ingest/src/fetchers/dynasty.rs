//! Dynasty (Innofactor) minute fetcher.
//!
//! Dynasty is the most widespread meeting-minutes system in Finland — used
//! by 40–50+ municipalities. It exposes a CGI front end at `DREQUEST.PHP`
//! with four page types:
//!
//! - `?page=meeting_frames` — latest meetings for every decision body
//! - `?page=meetings&id=X`  — single body's meeting list
//! - `?page=meeting&id=X`   — single meeting agenda
//! - `?page=meetingitem&id=X-N` — single agenda item decision
//!
//! Per-meeting PDFs are available at `<origin><pathPrefix>/kokous/<id>.PDF`.
//! URL variants handled via `MinuteSource.path_prefix`:
//! - default: `https://poytakirjat.<kunta>.fi/cgi/DREQUEST.PHP`
//! - regional: `https://dynastyjulkaisu.<region>.fi/D10_<kunta>/cgi/DREQUEST.PHP`
//! - custom: `https://dynasty.<kunta>.fi/djulkaisu/cgi/DREQUEST.PHP`

use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use tracing::{debug, warn};
use url::Url;

use crate::error::IngestError;
use crate::fetchers::html::strip_html;
use crate::fetchers::types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
use crate::http::RateLimitedClient;
use crate::minutes::dates::parse_fi_date;
use crate::pdf;

const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(2000);
const LISTING_LIMIT: usize = 20;

pub struct DynastyFetcher {
    client: RateLimitedClient,
}

impl DynastyFetcher {
    pub fn new() -> Result<Self, IngestError> {
        Ok(Self {
            client: RateLimitedClient::with_default_interval(DEFAULT_RATE_LIMIT)?,
        })
    }
}

#[async_trait]
impl MinuteFetcher for DynastyFetcher {
    fn fetcher_type(&self) -> FetcherType {
        FetcherType::Dynasty
    }

    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError> {
        let url = format!("{}?page=meeting_frames", source.url);
        let response = self.client.get(&url).await?;
        if !response.status().is_success() {
            return Err(IngestError::Fetcher {
                context: "dynasty listing",
                message: format!("{url} returned status {}", response.status()),
            });
        }
        let html = response.text().await.map_err(|source| IngestError::Http {
            context: "read dynasty listing body",
            source,
        })?;

        let meetings = parse_listing(&html, source);
        debug!(source = %source.entity_name, count = meetings.len(), "parsed dynasty listing");
        Ok(meetings.into_iter().take(LISTING_LIMIT).collect())
    }

    async fn extract_content(
        &self,
        meeting: &Meeting,
        source: &MinuteSource,
    ) -> Result<Option<String>, IngestError> {
        // Strategy A: try the predictable meeting PDF first.
        if let Some(pdf_url) = build_pdf_url(source, &meeting.id) {
            match self.client.get(&pdf_url).await {
                Ok(resp) if resp.status().is_success() => {
                    let ct = resp
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    if ct.contains("pdf") || ct.contains("octet-stream") {
                        let bytes = resp.bytes().await.map_err(|source| IngestError::Http {
                            context: "download dynasty pdf",
                            source,
                        })?;
                        return Ok(Some(pdf::extract_text(&bytes)?));
                    }
                }
                Ok(_) | Err(_) => {
                    debug!(url = %pdf_url, "dynasty pdf not available, falling back to HTML");
                }
            }
        }

        // Strategy B: fetch the agenda page and assemble individual items.
        let agenda = self.client.get(&meeting.page_url).await?;
        if !agenda.status().is_success() {
            warn!(url = %meeting.page_url, "dynasty agenda fetch failed");
            return Ok(None);
        }
        let agenda_html = agenda.text().await.map_err(|source| IngestError::Http {
            context: "read dynasty agenda",
            source,
        })?;

        let items = parse_agenda_items(&agenda_html);
        if items.is_empty() {
            return Ok(None);
        }

        let mut parts = Vec::with_capacity(items.len());
        for (item_id, title) in items {
            let item_url = format!("{}?page=meetingitem&id={item_id}", source.url);
            let Ok(resp) = self.client.get(&item_url).await else {
                continue;
            };
            if !resp.status().is_success() {
                continue;
            }
            let Ok(html) = resp.text().await else {
                continue;
            };
            let text = extract_item_text(&html);
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

fn build_pdf_url(source: &MinuteSource, meeting_id: &str) -> Option<String> {
    let parsed = Url::parse(&source.url).ok()?;
    let origin = format!("{}://{}", parsed.scheme(), parsed.host_str()?,);
    let prefix = source.path_prefix.as_deref().unwrap_or("");
    Some(format!("{origin}{prefix}/kokous/{meeting_id}.PDF"))
}

/// Parse the `meeting_frames` page. Each `<tr>` holds a single body's latest
/// meeting; we pick only rows whose "Pöytäkirja" link is present (skipping
/// Esityslista-only rows).
fn parse_listing(html: &str, source: &MinuteSource) -> Vec<Meeting> {
    // Split on `<tr` so we can inspect each row even when the closing tag
    // is missing, which is common in old Dynasty templates.
    let protocol_id = Regex::new(r"(?i)page=meeting&(?:amp;)?id=(\d+)").expect("valid regex");
    let organ_link = Regex::new(r#"(?i)page=meetings&(?:amp;)?id=\d+[^'"]*['"][^>]*>([^<]+)"#)
        .expect("valid regex");
    let date_re = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})").expect("valid regex");
    let protocol_class = Regex::new(r#"(?i)class=['"][^'"]*\bprotocol\b"#).expect("valid regex");
    let protocol_word =
        Regex::new(r"(?i)>\s*p(?:ö|&ouml;)yt(?:ä|&auml;)kirja\s*<").expect("valid regex");

    let mut meetings = Vec::new();
    for row in html.split("<tr").skip(1) {
        let Some(id_cap) = protocol_id.captures(row) else {
            continue;
        };
        let meeting_id = id_cap[1].to_string();

        // Require some signal that this row is a signed protocol, not just
        // an agenda. Esityslista-only rows have no icon_protocol, no class
        // "protocol", and no "Pöytäkirja" text — they get dropped here.
        let is_protocol = row.contains("icon_protocol")
            || protocol_class.is_match(row)
            || protocol_word.is_match(row);
        if !is_protocol {
            continue;
        }

        let organ = organ_link
            .captures(row)
            .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()));

        let date_str = date_re.find(row).map(|m| m.as_str());
        let date = date_str.and_then(parse_fi_date);

        let title = match (&organ, date_str) {
            (Some(o), Some(d)) => format!("{o} {d} Pöytäkirja"),
            (Some(o), None) => format!("{o} Pöytäkirja"),
            (None, Some(d)) => format!("Pöytäkirja {d}"),
            (None, None) => format!("Pöytäkirja {meeting_id}"),
        };

        meetings.push(Meeting {
            id: meeting_id.clone(),
            page_url: format!("{}?page=meeting&id={meeting_id}", source.url),
            title,
            date,
            organ,
        });
    }
    meetings
}

fn parse_agenda_items(html: &str) -> Vec<(String, String)> {
    let re = Regex::new(r#"(?i)page=meetingitem&(?:amp;)?id=(\d+-\d+)[^"']*["'][^>]*>([^<]*)"#)
        .expect("valid regex");
    re.captures_iter(html)
        .map(|c| (c[1].to_string(), c[2].trim().to_string()))
        .collect()
}

fn extract_item_text(html: &str) -> String {
    // Prefer a content div if present, otherwise fall back to the whole body.
    let content_re = Regex::new(r#"(?is)<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)</div>"#)
        .expect("valid regex");
    if let Some(cap) = content_re.captures(html) {
        return strip_html(&cap[1]);
    }
    let body_re = Regex::new(r"(?is)<body[^>]*>(.*?)</body>").expect("valid regex");
    if let Some(cap) = body_re.captures(html) {
        return strip_html(&cap[1]);
    }
    strip_html(html)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src() -> MinuteSource {
        MinuteSource {
            entity_name: "Ylivieska".into(),
            slug: "ylivieska".into(),
            fetcher_type: FetcherType::Dynasty,
            url: "https://poytakirjat.ylivieska.fi/cgi/DREQUEST.PHP".into(),
            country: "FI".into(),
            language: "fi".into(),
            region: None,
            path_prefix: None,
        }
    }

    #[test]
    fn pdf_url_uses_origin_and_path_prefix() {
        let mut s = src();
        s.path_prefix = Some("/D10_Haapajarvi".into());
        let url = build_pdf_url(&s, "1234").unwrap();
        assert_eq!(
            url,
            "https://poytakirjat.ylivieska.fi/D10_Haapajarvi/kokous/1234.PDF"
        );
    }

    #[test]
    fn pdf_url_without_prefix() {
        let url = build_pdf_url(&src(), "42").unwrap();
        assert_eq!(url, "https://poytakirjat.ylivieska.fi/kokous/42.PDF");
    }

    #[test]
    fn parses_protocol_rows_and_skips_agenda_only() {
        let html = r#"
<table>
<tr>
  <td><a href="DREQUEST.PHP?page=meetings&id=5">Kunnanhallitus</a></td>
  <td>28.3.2026</td>
  <td><img src="icon_protocol.png"><a href="DREQUEST.PHP?page=meeting&id=101">Pöytäkirja</a></td>
</tr>
<tr>
  <td><a href="DREQUEST.PHP?page=meetings&id=7">Sivistyslautakunta</a></td>
  <td>1.4.2026</td>
  <td><a href="DREQUEST.PHP?page=meeting&id=102">Esityslista</a></td>
</tr>
<tr>
  <td><a href="DREQUEST.PHP?page=meetings&id=9">Valtuusto</a></td>
  <td>14.3.2026</td>
  <td><a class="protocol" href="DREQUEST.PHP?page=meeting&id=103">Pöytäkirja</a></td>
</tr>
</table>"#;
        let meetings = parse_listing(html, &src());
        let ids: Vec<_> = meetings.iter().map(|m| m.id.clone()).collect();
        assert_eq!(ids, vec!["101", "103"]);
    }

    #[test]
    fn parses_agenda_items_from_links() {
        let html = r#"
<a href="DREQUEST.PHP?page=meetingitem&id=500-1">Avaus</a>
<a href="DREQUEST.PHP?page=meetingitem&id=500-2">Kaavoituspäätös</a>"#;
        let items = parse_agenda_items(html);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].1, "Kaavoituspäätös");
    }
}
