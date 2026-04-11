//! Stage 2: write a focused article from a single newsworthy excerpt.

use serde::{Deserialize, Serialize};

use crate::ai::mistral::MistralClient;
use crate::ai::prompts_fi::{WRITE_ARTICLE_SYSTEM, WRITE_ARTICLE_USER, fill_template};
use crate::error::IngestError;

/// A drafted article ready to be verified and published.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArticleDraft {
    pub title: String,
    pub summary: String,
    #[serde(rename = "keyPoints", default)]
    pub key_points: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Free-text location mentions extracted from the source excerpt:
    /// place names, districts, streets, landmarks. The downstream
    /// [`crate::minutes::location_resolver`] tries to resolve each hint
    /// into a concrete `locations` or `places` row so threads attach to
    /// the most specific available hierarchy level (kaupunginosa, katu,
    /// paikka) instead of only the kunta baseline.
    #[serde(rename = "locationHints", default)]
    pub location_hints: Vec<String>,
}

/// Ask Mistral to turn an agenda item excerpt into a short article.
pub async fn write_article(
    client: &MistralClient,
    excerpt: &str,
    municipality: &str,
    item_number: &str,
    organ: Option<&str>,
) -> Result<ArticleDraft, IngestError> {
    let organ_label = organ.unwrap_or("toimielin");
    let user_prompt = fill_template(
        WRITE_ARTICLE_USER,
        &[
            ("municipality", municipality),
            ("organ", organ_label),
            ("itemNumber", item_number),
            ("excerpt", excerpt),
        ],
    );

    let draft: ArticleDraft = client
        .call_json(
            "write_article",
            WRITE_ARTICLE_SYSTEM,
            &user_prompt,
            0.3,
            2_000,
        )
        .await?;
    Ok(draft)
}
