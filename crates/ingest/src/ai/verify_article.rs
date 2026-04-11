//! Stage 3: verify the generated article against the original excerpt.

use serde::{Deserialize, Serialize};

use crate::ai::mistral::MistralClient;
use crate::ai::prompts_fi::{VERIFY_ARTICLE_SYSTEM, VERIFY_ARTICLE_USER, fill_template};
use crate::ai::write_article::ArticleDraft;
use crate::error::IngestError;

/// Severity of any issues the verifier finds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    None,
    Minor,
    Major,
}

/// Verification outcome for a generated article.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verification {
    pub passed: bool,
    #[serde(default = "default_severity")]
    pub severity: Severity,
    #[serde(default)]
    pub issues: Vec<String>,
}

fn default_severity() -> Severity {
    Severity::None
}

/// Cross-check a draft article against its source excerpt.
pub async fn verify_article(
    client: &MistralClient,
    article: &ArticleDraft,
    excerpt: &str,
    municipality: &str,
) -> Result<Verification, IngestError> {
    let key_points = article
        .key_points
        .iter()
        .enumerate()
        .map(|(i, p)| format!("{}. {p}", i + 1))
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = fill_template(
        VERIFY_ARTICLE_USER,
        &[
            ("title", &article.title),
            ("summary", &article.summary),
            ("keyPoints", &key_points),
            ("municipality", municipality),
            ("excerpt", excerpt),
        ],
    );

    let verification: Verification = client
        .call_json(
            "verify_article",
            VERIFY_ARTICLE_SYSTEM,
            &user_prompt,
            0.0,
            1_500,
        )
        .await?;
    Ok(verification)
}
