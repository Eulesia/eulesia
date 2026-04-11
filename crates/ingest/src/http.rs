//! Shared HTTP client and rate-limited fetcher used by fetchers.
//!
//! The rate limiter is a single global mutex-guarded timestamp per client
//! instance. It enforces a minimum interval between requests to avoid
//! hammering remote systems — many municipal servers are slow and
//! concurrent requests can trigger blocks.

use std::time::{Duration, Instant};

use reqwest::Client;
use tokio::sync::Mutex;
use tracing::trace;

use crate::error::IngestError;

/// Default User-Agent identifying the ingest bot.
pub const USER_AGENT: &str = concat!("eulesia-ingest/", env!("CARGO_PKG_VERSION"));

/// Build a generic `reqwest::Client` with our user agent and a reasonable
/// timeout for the slow municipal servers.
pub fn build_client() -> Result<Client, IngestError> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|source| IngestError::Http {
            context: "build http client",
            source,
        })
}

/// A HTTP client that enforces a minimum interval between requests.
///
/// The last-call timestamp is guarded by a tokio Mutex so multiple concurrent
/// tasks on the same instance cooperate. Concurrent `MinuteFetcher`s should
/// each own their own instance — the limiter is per-instance, not global.
pub struct RateLimitedClient {
    inner: Client,
    last_call: Mutex<Option<Instant>>,
    min_interval: Duration,
}

impl RateLimitedClient {
    /// Create a new rate-limited client.
    pub fn new(client: Client, min_interval: Duration) -> Self {
        Self {
            inner: client,
            last_call: Mutex::new(None),
            min_interval,
        }
    }

    /// Build a new client with default settings and the given minimum interval.
    pub fn with_default_interval(min_interval: Duration) -> Result<Self, IngestError> {
        Ok(Self::new(build_client()?, min_interval))
    }

    /// Perform a GET request, waiting if necessary to honour the rate limit.
    pub async fn get(&self, url: &str) -> Result<reqwest::Response, IngestError> {
        self.wait_for_slot().await;
        self.inner
            .get(url)
            .send()
            .await
            .map_err(|source| IngestError::Http {
                context: "rate-limited GET",
                source,
            })
    }

    async fn wait_for_slot(&self) {
        let mut guard = self.last_call.lock().await;
        if let Some(last) = *guard {
            let elapsed = last.elapsed();
            if elapsed < self.min_interval {
                let wait = self.min_interval - elapsed;
                trace!(?wait, "rate limit sleep");
                tokio::time::sleep(wait).await;
            }
        }
        *guard = Some(Instant::now());
    }
}
