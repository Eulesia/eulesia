use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::messages::ServerMessage;

pub type WsSender = mpsc::UnboundedSender<ServerMessage>;

#[derive(Clone, Default)]
pub struct ConnectionRegistry {
    connections: Arc<DashMap<Uuid, WsSender>>, // keyed by device_id
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
        }
    }

    pub fn register(&self, device_id: Uuid, sender: WsSender) {
        self.connections.insert(device_id, sender);
    }

    pub fn unregister(&self, device_id: &Uuid) {
        self.connections.remove(device_id);
    }

    pub fn send_to_device(&self, device_id: &Uuid, msg: ServerMessage) -> bool {
        self.connections
            .get(device_id)
            .is_some_and(|sender| sender.send(msg).is_ok())
    }

    pub fn send_to_user_devices(&self, user_devices: &[Uuid], msg: &ServerMessage) {
        for did in user_devices {
            if let Some(sender) = self.connections.get(did) {
                let _ = sender.send(msg.clone());
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
