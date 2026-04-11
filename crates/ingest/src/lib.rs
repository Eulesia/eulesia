//! Eulesia ingest crate.
//!
//! Automated content importers that fetch material from external systems,
//! run it through an AI pipeline, and publish it as Agora threads.
//!
//! The first importer lives in [`minutes`] and handles Finnish municipal
//! meeting minutes from M-Files, CloudNC, Dynasty and Tweb systems.

pub mod ai;
pub mod error;
pub mod fetchers;
pub mod http;
pub mod minutes;
pub mod pdf;
pub mod sources;

pub use error::IngestError;
