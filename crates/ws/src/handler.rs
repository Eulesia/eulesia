use std::sync::Arc;

use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::{IntoResponse, Response},
};
use axum_extra::extract::CookieJar;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::info;
use uuid::Uuid;

use eulesia_auth::service::AuthService;

use eulesia_db::repo::conversations::ConversationRepo;

use crate::messages::{ClientMessage, ServerMessage};
use crate::registry::ConnectionRegistry;

pub type WsState = (Arc<sea_orm::DatabaseConnection>, ConnectionRegistry);

pub async fn ws_upgrade(
    State((db, registry)): State<WsState>,
    jar: CookieJar,
    ws: WebSocketUpgrade,
) -> Response {
    // Authenticate via session cookie only — query-param tokens are a
    // security risk (logged in URLs, referer headers, browser history).
    let token = jar
        .get("session")
        .or_else(|| jar.get("__Host-session"))
        .map(|c| c.value().to_string());

    let token = match token {
        Some(t) => t,
        None => {
            return (
                axum::http::StatusCode::UNAUTHORIZED,
                "missing session token",
            )
                .into_response();
        }
    };

    // Validate session token before upgrading
    let session_result = AuthService::validate_session(&db, &token).await;

    match session_result {
        Ok((session, _user)) => {
            // Use device_id if bound, otherwise use session.id as the
            // connection key. This allows device-less sessions (from
            // /auth/register, /auth/login) to connect.
            let connection_id = session.device_id.unwrap_or(session.id);
            let user_id = session.user_id;

            ws.on_upgrade(move |socket| handle_socket(socket, connection_id, user_id, db, registry))
        }
        Err(_) => (axum::http::StatusCode::UNAUTHORIZED, "invalid session").into_response(),
    }
}

async fn handle_socket(
    socket: WebSocket,
    connection_id: Uuid,
    user_id: Uuid,
    db: Arc<sea_orm::DatabaseConnection>,
    registry: ConnectionRegistry,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(crate::registry::CHANNEL_CAPACITY);

    // Generate a unique ID for this specific connection instance so we
    // only unregister ourselves, not a newer replacement connection.
    let instance_id = uuid::Uuid::now_v7();

    // Register connection
    registry.register(connection_id, tx, instance_id, user_id);
    info!(connection_id = %connection_id, user_id = %user_id, "WebSocket connected");

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
                            broadcast_typing(&db, &registry, conversation_id, user_id, true).await;
                        }
                        ClientMessage::TypingStop { conversation_id } => {
                            broadcast_typing(&db, &registry, conversation_id, user_id, false).await;
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

/// Broadcast a typing indicator to all other members of a conversation.
async fn broadcast_typing(
    db: &sea_orm::DatabaseConnection,
    registry: &ConnectionRegistry,
    conversation_id: Uuid,
    sender_id: Uuid,
    is_typing: bool,
) {
    let members = match ConversationRepo::active_members(db, conversation_id).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "failed to fetch members for typing broadcast");
            return;
        }
    };

    let msg = ServerMessage::Typing {
        conversation_id,
        user_id: sender_id,
        is_typing,
    };

    for member in &members {
        if member.user_id != sender_id {
            registry.send_to_user(&member.user_id, &msg);
        }
    }
}

/// Broadcast a new-message event to all conversation members, excluding the
/// originating connection when it is known.
///
/// Sender fanout is required so the user's other devices stay in sync after a
/// send, but excluding the origin avoids a needless echo to the same socket.
#[allow(clippy::too_many_arguments)]
pub async fn broadcast_new_message(
    db: &sea_orm::DatabaseConnection,
    registry: &ConnectionRegistry,
    conversation_id: Uuid,
    message_id: Uuid,
    sender_id: Uuid,
    sender_connection_id: Option<Uuid>,
    ciphertext: &str,
    epoch: i64,
) {
    let members = match ConversationRepo::active_members(db, conversation_id).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "failed to fetch members for message broadcast");
            return;
        }
    };

    let msg = ServerMessage::NewMessage {
        conversation_id,
        message_id,
        sender_id,
        ciphertext: ciphertext.to_string(),
        epoch,
    };

    for member in &members {
        if member.user_id == sender_id {
            if let Some(connection_id) = sender_connection_id {
                registry.send_to_user_excluding_connection(&member.user_id, &connection_id, &msg);
            } else {
                registry.send_to_user(&member.user_id, &msg);
            }
        } else {
            registry.send_to_user(&member.user_id, &msg);
        }
    }
}
