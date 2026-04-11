//! Pluggable meeting-minute fetchers.
//!
//! Each implementation of [`MinuteFetcher`] knows how to list meetings for a
//! single publishing system (M-Files, CloudNC, Dynasty, Tweb, ...) and how to
//! extract the raw minutes text for a given meeting.
//!
//! Fetchers return plain text — the Mistral pipeline handles editorial
//! judgment, summarisation, and verification afterwards.

pub mod cloudnc;
pub mod dynasty;
pub mod html;
pub mod mfiles;
pub mod tweb;
pub mod types;

pub use cloudnc::CloudNcFetcher;
pub use dynasty::DynastyFetcher;
pub use mfiles::MFilesFetcher;
pub use tweb::TwebFetcher;
pub use types::{FetcherType, Meeting, MinuteFetcher, MinuteSource};
