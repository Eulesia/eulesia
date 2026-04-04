use thiserror::Error;

#[derive(Debug, Error)]
pub enum NotifyError {
    #[error("database error: {context}")]
    Database {
        context: &'static str,
        #[source]
        source: sea_orm::DbErr,
    },

    #[error("serialization error")]
    Serialization(#[from] serde_json::Error),

    #[error("channel delivery failed: {0}")]
    Delivery(String),
}
