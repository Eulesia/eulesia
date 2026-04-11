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
    user_id: Uuid,
}

#[derive(Clone, Default)]
pub struct ConnectionRegistry {
    /// connection_id -> Connection
    connections: Arc<DashMap<Uuid, Connection>>,
    /// Reverse index: user_id → set of connection_ids.
    user_connections: Arc<DashMap<Uuid, Vec<Uuid>>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            user_connections: Arc::new(DashMap::new()),
        }
    }

    /// Register a connection. If the device already has a connection,
    /// the old one is silently replaced (its sender will error on next send).
    pub fn register(
        &self,
        connection_id: Uuid,
        sender: WsSender,
        instance_id: Uuid,
        user_id: Uuid,
    ) {
        // If this connection_id already exists (reconnect), remove the old
        // user→connection mapping before inserting the replacement.
        if let Some((_, old)) = self.connections.remove(&connection_id) {
            if let Some(mut ids) = self.user_connections.get_mut(&old.user_id) {
                ids.retain(|id| *id != connection_id);
            }
        }

        self.connections.insert(
            connection_id,
            Connection {
                sender,
                instance_id,
                user_id,
            },
        );
        let mut ids = self.user_connections.entry(user_id).or_default();
        if !ids.contains(&connection_id) {
            ids.push(connection_id);
        }
    }

    /// Unregister only if the stored instance matches. This prevents a
    /// closing old socket from removing a newer reconnection.
    pub fn unregister_if_match(&self, connection_id: &Uuid, instance_id: Uuid) {
        if let Some((_, conn)) = self
            .connections
            .remove_if(connection_id, |_, conn| conn.instance_id == instance_id)
        {
            // Clean up user→connection index; remove entry when empty.
            let user_id = conn.user_id;
            if let Some(mut ids) = self.user_connections.get_mut(&user_id) {
                ids.retain(|id| id != connection_id);
            }
            self.user_connections
                .remove_if(&user_id, |_, ids| ids.is_empty());
        }
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

    /// Send a message to all connected devices of a user (by user_id).
    pub fn send_to_user(&self, user_id: &Uuid, msg: &ServerMessage) {
        if let Some(conn_ids) = self.user_connections.get(user_id) {
            for cid in conn_ids.iter() {
                if let Some(conn) = self.connections.get(cid) {
                    let _ = conn.sender.try_send(msg.clone());
                }
            }
        }
    }

    /// Send a message to all connected devices of a user except one
    /// originating connection.
    pub fn send_to_user_excluding_connection(
        &self,
        user_id: &Uuid,
        excluded_connection_id: &Uuid,
        msg: &ServerMessage,
    ) {
        if let Some(conn_ids) = self.user_connections.get(user_id) {
            for cid in conn_ids.iter() {
                if *cid == *excluded_connection_id {
                    continue;
                }

                if let Some(conn) = self.connections.get(cid) {
                    let _ = conn.sender.try_send(msg.clone());
                }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_registry() -> ConnectionRegistry {
        ConnectionRegistry::new()
    }

    #[test]
    fn register_and_is_connected() {
        let reg = make_registry();
        let conn_id = Uuid::now_v7();
        let user_id = Uuid::now_v7();
        let instance_id = Uuid::now_v7();
        let (tx, _rx) = mpsc::channel(16);

        reg.register(conn_id, tx, instance_id, user_id);

        assert!(reg.is_connected(&conn_id));
        assert_eq!(reg.connected_count(), 1);
    }

    #[test]
    fn unregister_if_match_removes_connection() {
        let reg = make_registry();
        let conn_id = Uuid::now_v7();
        let user_id = Uuid::now_v7();
        let instance_id = Uuid::now_v7();
        let (tx, _rx) = mpsc::channel(16);

        reg.register(conn_id, tx, instance_id, user_id);
        reg.unregister_if_match(&conn_id, instance_id);

        assert!(!reg.is_connected(&conn_id));
        assert_eq!(reg.connected_count(), 0);
    }

    #[test]
    fn unregister_wrong_instance_does_not_remove() {
        let reg = make_registry();
        let conn_id = Uuid::now_v7();
        let user_id = Uuid::now_v7();
        let instance_id = Uuid::now_v7();
        let wrong_instance = Uuid::now_v7();
        let (tx, _rx) = mpsc::channel(16);

        reg.register(conn_id, tx, instance_id, user_id);
        reg.unregister_if_match(&conn_id, wrong_instance);

        // Should still be connected — wrong instance
        assert!(reg.is_connected(&conn_id));
    }

    #[test]
    fn send_to_user_delivers_to_all_connections() {
        let reg = make_registry();
        let user_id = Uuid::now_v7();

        let conn1 = Uuid::now_v7();
        let conn2 = Uuid::now_v7();
        let (tx1, mut rx1) = mpsc::channel(16);
        let (tx2, mut rx2) = mpsc::channel(16);

        reg.register(conn1, tx1, Uuid::now_v7(), user_id);
        reg.register(conn2, tx2, Uuid::now_v7(), user_id);

        let msg = ServerMessage::Presence {
            user_id,
            online: true,
        };
        reg.send_to_user(&user_id, &msg);

        assert!(rx1.try_recv().is_ok());
        assert!(rx2.try_recv().is_ok());
    }

    #[test]
    fn send_to_user_does_not_deliver_to_other_users() {
        let reg = make_registry();
        let user1 = Uuid::now_v7();
        let user2 = Uuid::now_v7();

        let (tx1, mut rx1) = mpsc::channel(16);
        let (tx2, mut rx2) = mpsc::channel(16);

        reg.register(Uuid::now_v7(), tx1, Uuid::now_v7(), user1);
        reg.register(Uuid::now_v7(), tx2, Uuid::now_v7(), user2);

        let msg = ServerMessage::Presence {
            user_id: user1,
            online: true,
        };
        reg.send_to_user(&user1, &msg);

        assert!(rx1.try_recv().is_ok());
        assert!(rx2.try_recv().is_err()); // user2 should NOT receive
    }

    #[test]
    fn send_to_user_excluding_connection_skips_only_origin() {
        let reg = make_registry();
        let user_id = Uuid::now_v7();

        let origin = Uuid::now_v7();
        let other = Uuid::now_v7();
        let (origin_tx, mut origin_rx) = mpsc::channel(16);
        let (other_tx, mut other_rx) = mpsc::channel(16);

        reg.register(origin, origin_tx, Uuid::now_v7(), user_id);
        reg.register(other, other_tx, Uuid::now_v7(), user_id);

        let msg = ServerMessage::Presence {
            user_id,
            online: true,
        };
        reg.send_to_user_excluding_connection(&user_id, &origin, &msg);

        assert!(origin_rx.try_recv().is_err());
        assert!(other_rx.try_recv().is_ok());
    }

    #[test]
    fn unregister_cleans_user_index() {
        let reg = make_registry();
        let user_id = Uuid::now_v7();
        let conn_id = Uuid::now_v7();
        let instance_id = Uuid::now_v7();
        let (tx, mut rx) = mpsc::channel(16);

        reg.register(conn_id, tx, instance_id, user_id);
        reg.unregister_if_match(&conn_id, instance_id);

        let msg = ServerMessage::Presence {
            user_id,
            online: true,
        };
        reg.send_to_user(&user_id, &msg);

        // Should not receive — connection was cleaned up
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn send_to_device_delivers() {
        let reg = make_registry();
        let device_id = Uuid::now_v7();
        let (tx, mut rx) = mpsc::channel(16);

        reg.register(device_id, tx, Uuid::now_v7(), Uuid::now_v7());

        let msg = ServerMessage::Presence {
            user_id: Uuid::nil(),
            online: true,
        };
        assert!(reg.send_to_device(&device_id, msg));
        assert!(rx.try_recv().is_ok());
    }

    #[test]
    fn send_to_nonexistent_device_returns_false() {
        let reg = make_registry();
        let msg = ServerMessage::Presence {
            user_id: Uuid::nil(),
            online: true,
        };
        assert!(!reg.send_to_device(&Uuid::now_v7(), msg));
    }

    #[test]
    fn multiple_users_isolated() {
        let reg = make_registry();

        let user1 = Uuid::now_v7();
        let user2 = Uuid::now_v7();

        let (tx1a, _) = mpsc::channel(16);
        let (tx1b, _) = mpsc::channel(16);
        let (tx2, _) = mpsc::channel(16);

        reg.register(Uuid::now_v7(), tx1a, Uuid::now_v7(), user1);
        reg.register(Uuid::now_v7(), tx1b, Uuid::now_v7(), user1);
        reg.register(Uuid::now_v7(), tx2, Uuid::now_v7(), user2);

        assert_eq!(reg.connected_count(), 3);
    }
}
