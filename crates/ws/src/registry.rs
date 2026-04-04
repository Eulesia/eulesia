use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::messages::ServerMessage;

/// Per-connection send buffer. If the client can't keep up, the oldest
/// messages are dropped rather than growing memory without bound.
pub(crate) const CHANNEL_CAPACITY: usize = 256;

pub type WsSender = mpsc::Sender<ServerMessage>;

/// An active WebSocket connection with a unique instance ID to guard
/// against stale cleanup when the same device reconnects.
struct Connection {
    sender: WsSender,
    instance_id: Uuid,
}

#[derive(Clone, Default)]
pub struct ConnectionRegistry {
    connections: Arc<DashMap<Uuid, Connection>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
        }
    }

    /// Register a connection. If the device already has a connection,
    /// the old one is silently replaced (its sender will error on next send).
    pub fn register(&self, connection_id: Uuid, sender: WsSender, instance_id: Uuid) {
        self.connections.insert(
            connection_id,
            Connection {
                sender,
                instance_id,
            },
        );
    }

    /// Unregister only if the stored instance matches. This prevents a
    /// closing old socket from removing a newer reconnection.
    pub fn unregister_if_match(&self, connection_id: &Uuid, instance_id: Uuid) {
        self.connections
            .remove_if(connection_id, |_, conn| conn.instance_id == instance_id);
    }

    pub fn send_to_device(&self, device_id: &Uuid, msg: ServerMessage) -> bool {
        self.connections
            .get(device_id)
            .is_some_and(|conn| conn.sender.try_send(msg).is_ok())
    }

    pub fn send_to_user_devices(&self, user_devices: &[Uuid], msg: &ServerMessage) {
        for did in user_devices {
            if let Some(conn) = self.connections.get(did) {
                let _ = conn.sender.try_send(msg.clone());
            }
        }
    }

    pub fn is_connected(&self, device_id: &Uuid) -> bool {
        self.connections.contains_key(device_id)
    }

    pub fn connected_count(&self) -> usize {
        self.connections.len()
    }
}
