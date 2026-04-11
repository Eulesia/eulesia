// Identity
pub mod devices;
pub mod ftn_oidc_state;
pub mod ftn_pending_registrations;
pub mod magic_links;
pub mod one_time_pre_keys;
pub mod sessions;
pub mod users;

// Conversations & Messaging
pub mod conversation_epochs;
pub mod conversations;
pub mod device_pairing_tokens;
pub mod direct_conversations;
pub mod media;
pub mod membership_events;
pub mod memberships;
pub mod message_device_queue;
pub mod message_redactions;
pub mod messages;

// Social Graph
pub mod blocks;
pub mod follows;
pub mod mutes;

// Public Content
pub mod bookmarks;
pub mod comment_votes;
pub mod comments;
pub mod thread_tags;
pub mod thread_views;
pub mod thread_votes;
pub mod threads;

// Clubs
pub mod club_invitations;
pub mod club_members;
pub mod clubs;

// Institutions
pub mod institution_claims;
pub mod institution_managers;
pub mod institution_topics;

// Moderation
pub mod content_reports;
pub mod edit_history;
pub mod moderation_actions;
pub mod moderation_appeals;
pub mod user_sanctions;

// Location / Geo
pub mod locations;
pub mod municipalities;
pub mod places;

// Notifications
pub mod notifications;
pub mod push_subscriptions;

// Subscriptions
pub mod user_subscriptions;

// Waitlist
pub mod waitlist;

// Admin / Site
pub mod admin_accounts;
pub mod admin_sessions;
pub mod invite_codes;
pub mod site_settings;
pub mod system_announcements;

// Events
pub mod domain_events;
pub mod job_cursors;
pub mod job_runs;
pub mod outbox;

#[cfg(test)]
mod tests;
