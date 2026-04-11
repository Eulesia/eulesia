use thiserror::Error;

/// Errors produced by the ingest pipeline.
///
/// The variants carry a `context` string so callers can distinguish
/// between different failure sites (fetch, parse, DB write, AI call).
#[derive(Debug, Error)]
pub enum IngestError {
    #[error("http error ({context}): {source}")]
    Http {
        context: &'static str,
        #[source]
        source: reqwest::Error,
    },

    #[error("html parse error ({context}): {message}")]
    HtmlParse {
        context: &'static str,
        message: String,
    },

    #[error("pdf parse error: {0}")]
    PdfParse(String),

    #[error("database error ({context}): {source}")]
    Database {
        context: &'static str,
        #[source]
        source: sea_orm::DbErr,
    },

    #[error("ai error ({stage}): {message}")]
    Ai {
        stage: &'static str,
        message: String,
    },

    #[error("ai json decode error ({stage}): {message}")]
    AiDecode {
        stage: &'static str,
        message: String,
    },

    #[error("ai rate limit exceeded after {retries} retries")]
    RateLimit { retries: u32 },

    #[error("invalid config: {0}")]
    InvalidConfig(String),

    #[error("fetcher error ({context}): {message}")]
    Fetcher {
        context: &'static str,
        message: String,
    },
}

impl From<sea_orm::DbErr> for IngestError {
    fn from(source: sea_orm::DbErr) -> Self {
        Self::Database {
            context: "unspecified",
            source,
        }
    }
}
