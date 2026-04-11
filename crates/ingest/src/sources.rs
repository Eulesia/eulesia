//! Static list of configured minute sources.
//!
//! Phase 1 ships only the M-Files entities we need right now. Phase 2
//! will port the Dynasty, CloudNC and Tweb lists from the old TypeScript
//! importer. Phase 3 adds database-backed adaptive sources discovered by
//! URL probing.

use crate::fetchers::{FetcherType, MinuteSource};

/// Build a Finnish M-Files source for the given slug and display name.
///
/// URL pattern: `https://mfiles.<slug>.fi/Kokoukset/<slug>`
fn mfiles_fi(slug: &'static str, entity_name: &'static str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::MFiles,
        url: format!("https://mfiles.{slug}.fi/Kokoukset/{slug}"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
    }
}

/// Return the full list of sources the importer should process on each run.
///
/// This is a function rather than a constant because `MinuteSource` contains
/// owned `String`s. The list is small so rebuilding it each run is cheap.
pub fn all_sources() -> Vec<MinuteSource> {
    let mut sources = Vec::new();
    sources.extend(mfiles_sources());
    sources
}

/// M-Files sources. The Imatra URL is best-effort — confirm on first run and
/// adjust if the server actually serves from a different hostname.
pub fn mfiles_sources() -> Vec<MinuteSource> {
    vec![
        mfiles_fi("lappeenranta", "Lappeenranta"),
        mfiles_fi("imatra", "Imatra"),
    ]
}
