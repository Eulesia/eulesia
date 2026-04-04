use std::sync::Arc;

use axum::{
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::info;
use uuid::Uuid;

use eulesia_auth::service::AuthService;

use crate::messages::{ClientMessage, ServerMessage};
use crate::registry::ConnectionRegistry;

#[derive(Deserialize)]
pub struct WsQuery {
    token: String,
}

pub type WsState = (Arc<sea_orm::DatabaseConnection>, ConnectionRegistry);

pub async fn ws_upgrade(
    State((db, registry)): State<WsState>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    // Validate session token before upgrading
    let session_result = AuthService::validate_session(&db, &query.token).await;

    match session_result {
        Ok((session, _user)) => {
            // Use device_id if bound, otherwise use session.id as the
            // connection key. This allows device-less sessions (from
            // /auth/register, /auth/login) to connect.
            let connection_id = session.device_id.unwrap_or(session.id);

            ws.on_upgrade(move |socket| handle_socket(socket, connection_id, registry))
        }
        Err(_) => (axum::http::StatusCode::UNAUTHORIZED, "invalid session").into_response(),
    }
}

async fn handle_socket(socket: WebSocket, connection_id: Uuid, registry: ConnectionRegistry) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(crate::registry::CHANNEL_CAPACITY);

    // Generate a unique ID for this specific connection instance so we
    // only unregister ourselves, not a newer replacement connection.
    let instance_id = uuid::Uuid::now_v7();

    // Register connection
    registry.register(connection_id, tx, instance_id);
    info!(connection_id = %connection_id, "WebSocket connected");

    // Spawn task to forward server messages to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match serde_json::to_string(&msg) {
                Ok(text) => {
                    if ws_sender.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to serialize WS message");
                }
            }
        }
    });

    // Read client messages
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                    match client_msg {
                        ClientMessage::Ping => {
                            // Keepalive -- no action needed
                        }
                        ClientMessage::TypingStart { conversation_id } => {
                            // TODO: broadcast typing indicator to conversation members
                            info!(connection_id = %connection_id, conversation_id = %conversation_id, "typing start");
                        }
                        ClientMessage::TypingStop { conversation_id } => {
                            info!(connection_id = %connection_id, conversation_id = %conversation_id, "typing stop");
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup — only unregister if our instance is still the active one.
    // This prevents a closing old socket from removing a newer reconnection.
    registry.unregister_if_match(&connection_id, instance_id);
    send_task.abort();
    info!(connection_id = %connection_id, "WebSocket disconnected");
}
