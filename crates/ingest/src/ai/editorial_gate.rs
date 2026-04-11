//! Stage 1: editorial gate.
//!
//! Splits raw minutes text into individual agenda items (`§ N`) and decides
//! which ones are newsworthy enough for publication. Procedural boilerplate
//! (opening, legality, minute-taker selection, adjournment) is filtered out
//! by the model.

use serde::{Deserialize, Serialize};

use crate::ai::mistral::MistralClient;
use crate::ai::prompts_fi::{EDITORIAL_GATE_SYSTEM, EDITORIAL_GATE_USER, fill_template};
use crate::error::IngestError;

/// A single agenda item produced by the editorial gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorialItem {
    #[serde(rename = "itemNumber")]
    pub item_number: String,
    pub title: String,
    pub excerpt: String,
    pub newsworthy: bool,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
struct EditorialGateResponse {
    items: Vec<EditorialItem>,
}

/// Maximum number of characters of minutes text passed to the model. Anything
/// longer is truncated with a `[...]` marker — the gate is robust to
/// truncation because it processes top-to-bottom.
const MAX_INPUT_CHARS: usize = 30_000;

/// Run the editorial gate and return the list of parsed items.
pub async fn editorial_gate(
    client: &MistralClient,
    full_text: &str,
    municipality: &str,
    organ: Option<&str>,
) -> Result<Vec<EditorialItem>, IngestError> {
    let organ_label = organ.unwrap_or("toimielin");
    let truncated = truncate_text(full_text);
    let user_prompt = fill_template(
        EDITORIAL_GATE_USER,
        &[
            ("municipality", municipality),
            ("organ", organ_label),
            ("text", &truncated),
        ],
    );

    let response: EditorialGateResponse = client
        .call_json(
            "editorial_gate",
            EDITORIAL_GATE_SYSTEM,
            &user_prompt,
            0.1,
            8_000,
        )
        .await?;

    Ok(response.items)
}

fn truncate_text(text: &str) -> String {
    if text.chars().count() <= MAX_INPUT_CHARS {
        return text.to_string();
    }
    let mut out: String = text.chars().take(MAX_INPUT_CHARS).collect();
    out.push_str("\n\n[...]");
    out
}

#[cfg(test)]
mod tests {
    use super::truncate_text;

    #[test]
    fn short_text_is_returned_as_is() {
        assert_eq!(truncate_text("hello"), "hello");
    }

    #[test]
    fn long_text_is_truncated_with_marker() {
        let long: String = "a".repeat(40_000);
        let truncated = truncate_text(&long);
        assert!(truncated.ends_with("[...]"));
        assert!(truncated.chars().count() < 40_000);
    }
}
