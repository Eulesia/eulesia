//! PDF text extraction.
//!
//! Thin wrapper around `pdf-extract` that normalises errors into
//! [`IngestError::PdfParse`] and logs extraction metrics.

use tracing::debug;

use crate::error::IngestError;

/// Extract plain text from in-memory PDF bytes.
///
/// Returns the entire document as a single string (pdf-extract does not
/// separate pages in its default API). Whitespace is preserved as-is —
/// downstream prompts can collapse it if needed.
pub fn extract_text(bytes: &[u8]) -> Result<String, IngestError> {
    let text = pdf_extract::extract_text_from_mem(bytes)
        .map_err(|e| IngestError::PdfParse(e.to_string()))?;
    debug!(
        bytes = bytes.len(),
        chars = text.len(),
        "extracted pdf text"
    );
    Ok(text)
}
