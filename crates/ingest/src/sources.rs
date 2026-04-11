//! Static list of configured minute sources.
//!
//! Ported from the old Node.js importer's static tables (CLOUDNC_SOURCES,
//! DYNASTY_SOURCES, TWEB_SOURCES) in commit `3b0bda7`, plus the new
//! M-Files entries for Etelä-Karjala (Lappeenranta, Imatra, …).
//!
//! The adaptive / DB-backed scraper configs come later in phase 3.

use crate::fetchers::{FetcherType, MinuteSource};

/// Helper for the `mfiles.<slug>.fi/Kokoukset/<slug>` pattern.
fn mfiles_fi(slug: &str, entity_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::MFiles,
        url: format!("https://mfiles.{slug}.fi/Kokoukset/{slug}"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for a basic CloudNC municipality site.
fn cloudnc(slug: &str, entity_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::CloudNc,
        url: format!("https://{slug}.cloudnc.fi/fi-FI"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for a CloudNC welfare region (custom subdomain + region label).
fn cloudnc_region(subdomain: &str, region_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: region_name.to_string(),
        slug: subdomain.to_string(),
        fetcher_type: FetcherType::CloudNc,
        url: format!("https://{subdomain}.cloudnc.fi/fi-FI"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: Some(region_name.to_string()),
        path_prefix: None,
    }
}

/// Helper for a Dynasty site at `poytakirjat.<slug>.fi/cgi/DREQUEST.PHP`
/// (no path prefix).
fn dynasty_poytakirjat(slug: &str, entity_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::Dynasty,
        url: format!("https://poytakirjat.{slug}.fi/cgi/DREQUEST.PHP"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Helper for an arbitrary Dynasty URL with an explicit path prefix.
fn dynasty_custom(
    slug: &str,
    entity_name: &str,
    url: String,
    path_prefix: Option<String>,
) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::Dynasty,
        url,
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix,
    }
}

/// Helper for a Tweb site at `<slug>.tweb.fi/ktwebbin`.
fn tweb(slug: &str, entity_name: &str) -> MinuteSource {
    MinuteSource {
        entity_name: entity_name.to_string(),
        slug: slug.to_string(),
        fetcher_type: FetcherType::Tweb,
        url: format!("https://{slug}.tweb.fi/ktwebbin"),
        country: "FI".to_string(),
        language: "fi".to_string(),
        region: None,
        path_prefix: None,
    }
}

/// Return the full list of configured sources.
pub fn all_sources() -> Vec<MinuteSource> {
    let mut sources = Vec::new();
    sources.extend(mfiles_sources());
    sources.extend(cloudnc_sources());
    sources.extend(dynasty_sources());
    sources.extend(tweb_sources());
    sources
}

// ---------------------------------------------------------------------------
// M-Files
// ---------------------------------------------------------------------------

/// M-Files entries. Phase 2 focuses on Etelä-Karjala where the system is
/// actually in use. Expand as we confirm more hosts.
pub fn mfiles_sources() -> Vec<MinuteSource> {
    vec![
        mfiles_fi("lappeenranta", "Lappeenranta"),
        mfiles_fi("imatra", "Imatra"),
    ]
}

// ---------------------------------------------------------------------------
// CloudNC
// ---------------------------------------------------------------------------

pub fn cloudnc_sources() -> Vec<MinuteSource> {
    let municipalities = [
        ("rautalampi", "Rautalampi"),
        ("tampere", "Tampere"),
        ("jyvaskyla", "Jyväskylä"),
        ("mikkeli", "Mikkeli"),
        ("rovaniemi", "Rovaniemi"),
        ("kajaani", "Kajaani"),
        ("pori", "Pori"),
        ("hollola", "Hollola"),
        ("tuusula", "Tuusula"),
        ("jarvenpaa", "Järvenpää"),
        ("laitila", "Laitila"),
        ("laihia", "Laihia"),
        ("kangasniemi", "Kangasniemi"),
        ("muonio", "Muonio"),
        ("aura", "Aura"),
        ("vesilahti", "Vesilahti"),
        ("mantyharju", "Mäntyharju"),
    ];

    let welfare_regions = [
        ("pirha", "Pirkanmaan hyvinvointialue"),
        ("pohde", "Pohjois-Pohjanmaan hyvinvointialue"),
        ("sata", "Satakunnan hyvinvointialue"),
        ("itauusimaa", "Itä-Uusimaan hyvinvointialue"),
        ("keuh", "Keski-Uusimaan hyvinvointialue"),
        ("vakehyva", "Vantaan ja Keravan hyvinvointialue"),
        ("kainuunhyvinvointialue", "Kainuun hyvinvointialue"),
    ];

    municipalities
        .iter()
        .map(|(slug, name)| cloudnc(slug, name))
        .chain(
            welfare_regions
                .iter()
                .map(|(sub, name)| cloudnc_region(sub, name)),
        )
        .collect()
}

// ---------------------------------------------------------------------------
// Dynasty
// ---------------------------------------------------------------------------

pub fn dynasty_sources() -> Vec<MinuteSource> {
    let mut sources = Vec::new();

    // --- Direct poytakirjat.<slug>.fi sites ---
    let poytakirjat = [
        ("ylivieska", "Ylivieska"),
        ("haapavesi", "Haapavesi"),
        ("merijarvi", "Merijärvi"),
        ("mynamaki", "Mynämäki"),
        ("nivala", "Nivala"),
        ("nousiainen", "Nousiainen"),
        ("oulainen", "Oulainen"),
        ("savukoski", "Savukoski"),
        ("siikajoki", "Siikajoki"),
        ("utsjoki", "Utsjoki"),
        ("vantaa", "Vantaa"),
    ];
    for (slug, name) in poytakirjat {
        sources.push(dynasty_poytakirjat(slug, name));
    }

    // --- poytakirjat.<slug>.fi with a D10_ prefix ---
    sources.push(dynasty_custom(
        "haapajarvi",
        "Haapajärvi",
        "https://poytakirjat.haapajarvi.fi/cgi/DREQUEST.PHP".to_string(),
        Some("/D10_Haapajarvi".to_string()),
    ));

    // --- Custom domain with djulkaisu prefix ---
    sources.push(dynasty_custom(
        "suonenjoki",
        "Suonenjoki",
        "https://www.suonenjoki.info/djulkaisu/cgi/DREQUEST.PHP".to_string(),
        Some("/djulkaisu".to_string()),
    ));

    // --- Kaustisen seutukunta: dynastyjulkaisu.kase.fi/D10_<slug>/... ---
    for (slug, name) in [
        ("toholampi", "Toholampi"),
        ("kaustinen", "Kaustinen"),
        ("perho", "Perho"),
        ("veteli", "Veteli"),
    ] {
        let cap = capitalize_first(slug);
        let prefix = format!("/D10_{cap}");
        let url = format!("https://dynastyjulkaisu.kase.fi{prefix}/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(slug, name, url, Some(prefix)));
    }

    // --- dynasty.<slug>.fi/djulkaisu ---
    for (slug, name) in [("rautavaara", "Rautavaara"), ("vesanto", "Vesanto")] {
        let url = format!("https://dynasty.{slug}.fi/djulkaisu/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(
            slug,
            name,
            url,
            Some("/djulkaisu".to_string()),
        ));
    }

    // --- www.<slug>.fi/djulkaisu ---
    for (slug, name) in [
        ("brando", "Brändo"),
        ("evijarvi", "Evijärvi"),
        ("hartola", "Hartola"),
        ("kristiinankaupunki", "Kristiinankaupunki"),
    ] {
        let url = format!("https://www.{slug}.fi/djulkaisu/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(
            slug,
            name,
            url,
            Some("/djulkaisu".to_string()),
        ));
    }

    // --- Pohjois-Karjala: dynastyjulkaisu.pohjoiskarjala.net/<Kunta>/... ---
    for (slug_cased, entity) in [
        ("Joensuu", "Joensuu"),
        ("Lieksa", "Lieksa"),
        ("Nurmes", "Nurmes"),
        ("Outokumpu", "Outokumpu"),
        ("Kitee", "Kitee"),
        ("Kontiolahti", "Kontiolahti"),
        ("Liperi", "Liperi"),
        ("Juuka", "Juuka"),
        ("Ilomantsi", "Ilomantsi"),
        ("Tohmajarvi", "Tohmajärvi"),
        ("Polvijarvi", "Polvijärvi"),
        ("Raakkyla", "Rääkkylä"),
        ("Heinavesi", "Heinävesi"),
    ] {
        let prefix = format!("/{slug_cased}");
        let url = format!("https://dynastyjulkaisu.pohjoiskarjala.net{prefix}/cgi/DREQUEST.PHP");
        sources.push(dynasty_custom(
            &slug_cased.to_lowercase(),
            entity,
            url,
            Some(prefix),
        ));
    }

    sources
}

fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Tweb
// ---------------------------------------------------------------------------

pub fn tweb_sources() -> Vec<MinuteSource> {
    vec![tweb("uurainen", "Uurainen")]
}
