//! Mistral chat-completions client with rate limiting and retries.
//!
//! The client enforces:
//! - A configurable minimum interval between API calls (respecting Mistral's
//!   free-tier rate limits by default).
//! - Up to 5 automatic retries on 429 rate-limited responses and 5xx server
//!   errors, with exponential backoff and `Retry-After` respected.
//! - Transport-level retries on DNS/connection failures.
//! - JSON-mode output via `response_format: json_object`.
//!
//! All chat completions are forced into JSON mode so the caller can
//! deserialize the response directly into a typed struct.

use std::time::{Duration, Instant};

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tracing::{debug, warn};

use crate::error::IngestError;

const MISTRAL_API_URL: &str = "https://api.mistral.ai/v1/chat/completions";
const MAX_RETRIES: u32 = 5;
const DEFAULT_MODEL: &str = "mistral-small-latest";
const DEFAULT_RATE_LIMIT: Duration = Duration::from_millis(2000);

pub struct MistralClient {
    http: Client,
    api_key: String,
    model: String,
    min_interval: Duration,
    last_call: Mutex<Option<Instant>>,
}

impl MistralClient {
    /// Construct a new client.
    ///
    /// Pass `None` for `model` to use [`DEFAULT_MODEL`], and `None` for
    /// `rate_limit_ms` to use [`DEFAULT_RATE_LIMIT`].
    pub fn new(
        api_key: String,
        model: Option<String>,
        rate_limit_ms: Option<u64>,
    ) -> Result<Self, IngestError> {
        if api_key.trim().is_empty() {
            return Err(IngestError::InvalidConfig(
                "MISTRAL_API_KEY must be set when minutes import is enabled".into(),
            ));
        }
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|source| IngestError::Http {
                context: "build mistral client",
                source,
            })?;
        Ok(Self {
            http,
            api_key,
            model: model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            min_interval: rate_limit_ms
                .map(Duration::from_millis)
                .unwrap_or(DEFAULT_RATE_LIMIT),
            last_call: Mutex::new(None),
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Call the chat completion endpoint and deserialize the JSON-mode
    /// response content into `T`.
    pub async fn call_json<T: DeserializeOwned>(
        &self,
        stage: &'static str,
        system: &str,
        user: &str,
        temperature: f32,
        max_tokens: u32,
    ) -> Result<T, IngestError> {
        let raw = self
            .call_raw(stage, system, user, temperature, max_tokens)
            .await?;

        serde_json::from_str::<T>(&raw).map_err(|e| IngestError::AiDecode {
            stage,
            message: format!("{e}; raw response: {raw}"),
        })
    }

    async fn call_raw(
        &self,
        stage: &'static str,
        system: &str,
        user: &str,
        temperature: f32,
        max_tokens: u32,
    ) -> Result<String, IngestError> {
        let body = json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": { "type": "json_object" },
        });

        let mut last_error: Option<IngestError> = None;

        for attempt in 0..=MAX_RETRIES {
            self.wait_for_slot().await;

            let response = match self
                .http
                .post(MISTRAL_API_URL)
                .bearer_auth(&self.api_key)
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(source) => {
                    if attempt < MAX_RETRIES {
                        let wait = network_backoff(attempt);
                        warn!(
                            stage,
                            attempt = attempt + 1,
                            wait_secs = wait.as_secs(),
                            error = %source,
                            "mistral network error — retrying"
                        );
                        tokio::time::sleep(wait).await;
                        last_error = Some(IngestError::Http {
                            context: "mistral send",
                            source,
                        });
                        continue;
                    }
                    return Err(IngestError::Http {
                        context: "mistral send",
                        source,
                    });
                }
            };

            let status = response.status();
            if status.is_success() {
                let parsed: MistralResponse =
                    response.json().await.map_err(|source| IngestError::Http {
                        context: "parse mistral response",
                        source,
                    })?;
                let content = parsed
                    .choices
                    .into_iter()
                    .next()
                    .map(|c| c.message.content)
                    .ok_or_else(|| IngestError::Ai {
                        stage,
                        message: "mistral returned zero choices".into(),
                    })?;
                debug!(stage, chars = content.len(), "mistral ok");
                return Ok(content);
            }

            if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                if attempt < MAX_RETRIES {
                    let retry_after = parse_retry_after(&response);
                    let wait = retry_after.unwrap_or_else(|| http_backoff(attempt));
                    warn!(
                        stage,
                        status = status.as_u16(),
                        attempt = attempt + 1,
                        wait_secs = wait.as_secs(),
                        "mistral transient error — retrying"
                    );
                    // Drain body for connection reuse, ignore errors.
                    let _ = response.text().await;
                    tokio::time::sleep(wait).await;
                    last_error = Some(IngestError::Ai {
                        stage,
                        message: format!("transient {status}"),
                    });
                    continue;
                }
                return Err(IngestError::RateLimit {
                    retries: MAX_RETRIES,
                });
            }

            // Non-retriable error
            let body_text = response.text().await.unwrap_or_default();
            return Err(IngestError::Ai {
                stage,
                message: format!("mistral {status}: {body_text}"),
            });
        }

        Err(last_error.unwrap_or(IngestError::RateLimit {
            retries: MAX_RETRIES,
        }))
    }

    async fn wait_for_slot(&self) {
        let mut guard = self.last_call.lock().await;
        if let Some(last) = *guard {
            let elapsed = last.elapsed();
            if elapsed < self.min_interval {
                let wait = self.min_interval - elapsed;
                tokio::time::sleep(wait).await;
            }
        }
        *guard = Some(Instant::now());
    }
}

fn http_backoff(attempt: u32) -> Duration {
    // 10s, 20s, 40s, 80s, 120s (capped)
    let base = 10u64.saturating_mul(1u64 << attempt.min(7));
    Duration::from_secs(base.min(120))
}

fn network_backoff(attempt: u32) -> Duration {
    // 5s, 10s, 20s, 40s, 60s (capped)
    let base = 5u64.saturating_mul(1u64 << attempt.min(7));
    Duration::from_secs(base.min(60))
}

fn parse_retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get("retry-after")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
}

#[derive(Debug, Serialize, Deserialize)]
struct MistralResponse {
    choices: Vec<MistralChoice>,
    #[serde(default)]
    #[allow(dead_code)]
    usage: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MistralChoice {
    message: MistralMessage,
    #[serde(default)]
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MistralMessage {
    #[allow(dead_code)]
    role: String,
    content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_backoff_grows_but_is_capped() {
        assert_eq!(http_backoff(0), Duration::from_secs(10));
        assert_eq!(http_backoff(1), Duration::from_secs(20));
        assert_eq!(http_backoff(2), Duration::from_secs(40));
        assert_eq!(http_backoff(3), Duration::from_secs(80));
        assert_eq!(http_backoff(4), Duration::from_secs(120));
        assert_eq!(http_backoff(10), Duration::from_secs(120));
    }

    #[test]
    fn network_backoff_is_shorter_than_http() {
        assert_eq!(network_backoff(0), Duration::from_secs(5));
        assert!(network_backoff(4) <= Duration::from_secs(60));
    }

    #[test]
    fn rejects_empty_api_key() {
        assert!(MistralClient::new("  ".into(), None, None).is_err());
    }
}
