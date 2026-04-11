//! Common types shared by all minute fetchers.

use async_trait::async_trait;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::error::IngestError;

/// Which system publishes a given source of meeting minutes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FetcherType {
    /// M-Files publishing, e.g. `mfiles.lappeenranta.fi`.
    MFiles,
    /// CloudNC publishing, e.g. `rautalampi.cloudnc.fi/fi-FI`.
    CloudNc,
    /// Innofactor Dynasty, various URL patterns on `poytakirjat.*.fi` etc.
    Dynasty,
    /// Triplan Tweb, e.g. `uurainen.tweb.fi`.
    Tweb,
    /// Database-configured scraper driven by the adaptive discovery system.
    Adaptive,
}

impl FetcherType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::MFiles => "mfiles",
            Self::CloudNc => "cloudnc",
            Self::Dynasty => "dynasty",
            Self::Tweb => "tweb",
            Self::Adaptive => "adaptive",
        }
    }
}

/// A single meeting available from a publishing system.
#[derive(Debug, Clone)]
pub struct Meeting {
    /// System-local identifier for dedup. Combined with the source slug to
    /// form the `threads.source_id`.
    pub id: String,
    /// URL of the page or document shown to users.
    pub page_url: String,
    /// Raw title as shown on the listing page.
    pub title: String,
    /// Parsed meeting date when known. Meetings without a parseable date
    /// are dropped by the importer.
    pub date: Option<NaiveDate>,
    /// Name of the decision-making body (e.g. "Kaupunginhallitus"). Optional
    /// because some listings do not separate it out.
    pub organ: Option<String>,
}

/// A configured source of meeting minutes.
///
/// Typically constructed from static tables (see [`crate::sources`]) or from
/// database-backed adaptive configs. The `fetcher_type` field selects which
/// [`MinuteFetcher`] handles it.
#[derive(Debug, Clone)]
pub struct MinuteSource {
    /// Display name of the municipality or entity (e.g. "Lappeenranta").
    pub entity_name: String,
    /// Machine-readable slug used in URLs and source IDs.
    pub slug: String,
    pub fetcher_type: FetcherType,
    /// Base URL for the listing page.
    pub url: String,
    /// ISO 3166-1 alpha-2 country code.
    pub country: String,
    /// ISO 639-1 content language (used to pick AI prompts).
    pub language: String,
    /// Region label for welfare areas ("hyvinvointialueet"), optional.
    pub region: Option<String>,
    /// Dynasty-specific path prefix (e.g. `/D10_Haapajarvi` or `/djulkaisu`)
    /// used when constructing PDF URLs via the CGI pattern.
    pub path_prefix: Option<String>,
}

/// Contract implemented by each system-specific fetcher.
///
/// Implementations are expected to be stateless or to hold only cheap
/// clonable HTTP clients, so callers can put them behind a `dyn MinuteFetcher`.
#[async_trait]
pub trait MinuteFetcher: Send + Sync {
    fn fetcher_type(&self) -> FetcherType;

    /// Return the list of meetings currently visible for the given source.
    /// This is typically a flat, multi-organ view — the implementation is
    /// free to crawl multiple pages internally.
    async fn fetch_meetings(&self, source: &MinuteSource) -> Result<Vec<Meeting>, IngestError>;

    /// Download and extract the text of a single meeting's minutes.
    ///
    /// Returns `Ok(None)` when the content is inherently unavailable
    /// (e.g. the server returned 404 after a listing was cached). Returns
    /// `Err` for transport or parsing failures that should be reported.
    async fn extract_content(
        &self,
        meeting: &Meeting,
        source: &MinuteSource,
    ) -> Result<Option<String>, IngestError>;
}
