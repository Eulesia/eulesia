//! Mistral AI client and 3-stage editorial pipeline.
//!
//! The pipeline has three stages:
//!
//! 1. **Editorial gate** — split minutes into individual agenda items and
//!    decide which ones are newsworthy (vs procedural boilerplate).
//! 2. **Article writing** — turn a single newsworthy excerpt into a short
//!    summary, key points, and tags.
//! 3. **Verification** — cross-check the article against the original
//!    excerpt and flag any hallucinations or accuracy issues.
//!
//! Each stage calls [`mistral::MistralClient::call_json`] with a
//! stage-specific system prompt and user template.

pub mod editorial_gate;
pub mod mistral;
pub mod prompts_fi;
pub mod verify_article;
pub mod write_article;

pub use editorial_gate::{EditorialItem, editorial_gate};
pub use mistral::MistralClient;
pub use verify_article::{Severity, Verification, verify_article};
pub use write_article::{ArticleDraft, write_article};
