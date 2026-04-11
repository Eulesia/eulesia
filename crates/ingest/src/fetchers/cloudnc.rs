//! CloudNC minute fetcher.
//!
//! CloudNC powers a growing set of Finnish municipal and welfare-region
//! publishing sites. URLs look like `https://<slug>.cloudnc.fi/fi-FI` for
//! kunnat and `https://<subdomain>.cloudnc.fi/fi-FI` for hyvinvointialueet.
//!
//! The listing page is a plain HTML table linking into
//! `/fi-FI/Toimielimet/<Organ>/Kokous_<Date>` pages. The signed minutes
//! download is reached via a `/download/noname/{GUID}/<id>` href inside
//! the meeting page; the response is a PDF.

use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use tracing::debug;
use url::Url;

use crate::error::IngestError;
use crate::fetchers::types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
use crate::http::RateLimitedClient;
use crate::minutes::dates::parse_fi_date;
use crate::pdf;

const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(2000);
const LISTING_LIMIT: usize = 20;

pub struct CloudNcFetcher {
    client: RateLimitedClient,
}

impl CloudNcFetcher {
    pub fn new() -> Result<Self, IngestError> {
        Ok(Self {
            client: RateLimitedClient::with_default_interval(DEFAULT_RATE_LIMIT)?,
        })
    }
}

#[async_trait]
impl MinuteFetcher for CloudNcFetcher {
    fn fetcher_type(&self) -> FetcherType {
        FetcherType::CloudNc
    }

    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError> {
        let response = self.client.get(&source.url).await?;
        if !response.status().is_success() {
            return Err(IngestError::Fetcher {
                context: "cloudnc listing",
                message: format!("{} returned status {}", source.url, response.status()),
            });
        }
        let html = response.text().await.map_err(|source| IngestError::Http {
            context: "read cloudnc listing body",
            source,
        })?;

        let meetings = parse_listing(&html, source);
        debug!(source = %source.entity_name, count = meetings.len(), "parsed cloudnc listing");
        Ok(meetings.into_iter().take(LISTING_LIMIT).collect())
    }

    async fn extract_content(
        &self,
        meeting: &Meeting,
        _source: &MinuteSource,
    ) -> Result<Option<String>, IngestError> {
        let response = self.client.get(&meeting.page_url).await?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let html = response.text().await.map_err(|source| IngestError::Http {
            context: "read cloudnc meeting page",
            source,
        })?;

        let Some(path) = find_download_path(&html) else {
            return Ok(None);
        };

        let origin = Url::parse(&meeting.page_url)
            .ok()
            .and_then(|u| u.host_str().map(|h| format!("{}://{h}", u.scheme())))
            .ok_or(IngestError::HtmlParse {
                context: "cloudnc download origin",
                message: "could not parse meeting page URL origin".into(),
            })?;
        let pdf_url = format!("{origin}{path}");
        let bytes = self
            .client
            .get(&pdf_url)
            .await?
            .bytes()
            .await
            .map_err(|source| IngestError::Http {
                context: "download cloudnc pdf",
                source,
            })?;
        Ok(Some(pdf::extract_text(&bytes)?))
    }
}

/// CloudNC meeting links look like:
/// `href='/fi-FI/Toimielimet/Kunnanhallitus/Kokous_28032026'>Kunnanhallitus - Kokous 28.3.2026 Pöytäkirja</a>`
/// We capture the Pöytäkirja variants and drop Esityslista.
fn parse_listing(html: &str, source: &MinuteSource) -> Vec<Meeting> {
    let re = Regex::new(
        r#"(?is)href=['"]([^'"]*/Kokous_[^'"]+)['"][^>]*>([^<]*?p(?:ö|&ouml;)yt(?:ä|&auml;)kirja[^<]*)"#,
    )
    .expect("valid regex");
    let date_re = Regex::new(r"(\d{1,2}\.\d{1,2}\.\d{4})").expect("valid regex");

    let mut out = Vec::new();
    for cap in re.captures_iter(html) {
        let href = cap[1].to_string();
        let title_raw = cap[2].to_string();
        let title = title_raw.trim().to_string();

        // Split on " - " to recover organ name (if present).
        let organ = title.split(" - ").next().map(|s| s.trim().to_string());

        let id = href.rsplit('/').next().unwrap_or(&href).to_string();

        let page_url = Url::parse(&source.url)
            .and_then(|base| base.join(&href))
            .map(|u| u.to_string())
            .unwrap_or_else(|_| format!("{}{href}", source.url.trim_end_matches('/')));

        let date = date_re.find(&title).and_then(|m| parse_fi_date(m.as_str()));

        out.push(Meeting {
            id,
            page_url,
            title,
            date,
            organ,
        });
    }
    out
}

fn find_download_path(html: &str) -> Option<String> {
    let re =
        Regex::new(r#"(?i)href="(/download/noname/\{[0-9A-Fa-f-]+\}/\d+)""#).expect("valid regex");
    re.captures(html).map(|c| c[1].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src() -> MinuteSource {
        MinuteSource {
            entity_name: "Rautalampi".into(),
            slug: "rautalampi".into(),
            fetcher_type: FetcherType::CloudNc,
            url: "https://rautalampi.cloudnc.fi/fi-FI".into(),
            country: "FI".into(),
            language: "fi".into(),
            region: None,
            path_prefix: None,
        }
    }

    #[test]
    fn parses_poytakirja_rows() {
        let html = r#"
<a href='/fi-FI/Toimielimet/Kunnanhallitus/Kokous_28032026'>Kunnanhallitus - Kokous 28.3.2026 Pöytäkirja</a>
<a href='/fi-FI/Toimielimet/Valtuusto/Kokous_14032026'>Valtuusto - Kokous 14.3.2026 Esityslista</a>
<a href='/fi-FI/Toimielimet/Valtuusto/Kokous_14032026b'>Valtuusto - Kokous 14.3.2026 Pöytäkirja</a>"#;
        let meetings = parse_listing(html, &src());
        assert_eq!(meetings.len(), 2);
        assert_eq!(meetings[0].organ.as_deref(), Some("Kunnanhallitus"));
        assert_eq!(meetings[1].organ.as_deref(), Some("Valtuusto"));
    }

    #[test]
    fn finds_download_guid_path() {
        let html =
            r#"<a href="/download/noname/{01930A9F-AAAA-BBBB-CCCC-123456789ABC}/42">Lataa</a>"#;
        assert_eq!(
            find_download_path(html),
            Some("/download/noname/{01930A9F-AAAA-BBBB-CCCC-123456789ABC}/42".to_string())
        );
    }
}
