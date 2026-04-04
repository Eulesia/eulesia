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
            let Some(device_id) = session.device_id else {
                return (axum::http::StatusCode::BAD_REQUEST, "device_id required").into_response();
            };

            ws.on_upgrade(move |socket| handle_socket(socket, device_id, registry))
        }
        Err(_) => (axum::http::StatusCode::UNAUTHORIZED, "invalid session").into_response(),
    }
}

async fn handle_socket(socket: WebSocket, device_id: Uuid, registry: ConnectionRegistry) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    // Register connection
    registry.register(device_id, tx);
    info!(device_id = %device_id, "WebSocket connected");

    // Spawn task to forward server messages to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Ok(text) = serde_json::to_string(&msg) {
                if ws_sender.send(Message::Text(text.into())).await.is_err() {
                    break;
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
                            info!(device_id = %device_id, conversation_id = %conversation_id, "typing start");
                        }
                        ClientMessage::TypingStop { conversation_id } => {
                            info!(device_id = %device_id, conversation_id = %conversation_id, "typing stop");
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup
    registry.unregister(&device_id);
    send_task.abort();
    info!(device_id = %device_id, "WebSocket disconnected");
}
