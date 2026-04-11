use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::routing::{delete, post};
use axum::{Json, Router};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
};
use chrono::Utc;
use sea_orm::ActiveModelTrait;
use sea_orm::ActiveValue::Set;
use sea_orm::IntoActiveModel;
use sea_orm::TransactionTrait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use eulesia_db::entities::device_pairing_tokens;

use crate::AppState;
use eulesia_auth::error::AuthError;
use eulesia_auth::session::AuthUser;
use eulesia_common::error::ApiError;
use eulesia_common::types::{Id, Platform, new_id};
use eulesia_db::entities::{devices, one_time_pre_keys};
use eulesia_db::repo::device_pairing_tokens::DevicePairingTokenRepo;
use eulesia_db::repo::devices::DeviceRepo;
use eulesia_db::repo::pre_keys::PreKeyRepo;
use eulesia_db::repo::sessions::SessionRepo;

const MAX_DEVICES_PER_USER: u64 = 10;
const MATRIX_SERVER_NAME: &str = "eulesia.invalid";
const MATRIX_OTK_ALGORITHM: &str = "signed_curve25519";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDeviceRequest {
    display_name: Option<String>,
    platform: Platform,
    pairing_code: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevicePairingResponse {
    code: String,
    expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceResponse {
    id: Id,
    display_name: Option<String>,
    platform: String,
    created_at: String,
}

impl From<devices::Model> for DeviceResponse {
    fn from(d: devices::Model) -> Self {
        Self {
            id: d.id,
            display_name: d.display_name,
            platform: d.platform,
            created_at: d.created_at.to_rfc3339(),
        }
    }
}

#[derive(Deserialize)]
#[allow(clippy::struct_field_names)]
struct MatrixKeysUploadRequest {
    device_keys: Option<MatrixDeviceKeys>,
    #[serde(default)]
    one_time_keys: HashMap<String, MatrixSignedKey>,
    #[serde(default)]
    fallback_keys: HashMap<String, MatrixSignedKey>,
}

#[derive(Deserialize)]
struct MatrixDeviceKeys {
    user_id: String,
    device_id: String,
    keys: HashMap<String, String>,
    signatures: HashMap<String, HashMap<String, String>>,
}

#[derive(Deserialize, Serialize, Clone)]
struct MatrixSignedKey {
    key: String,
    signatures: HashMap<String, HashMap<String, String>>,
}

#[derive(Serialize)]
struct MatrixKeysUploadResponse {
    one_time_key_counts: HashMap<String, u64>,
}

#[derive(Deserialize)]
struct MatrixKeysQueryRequest {
    device_keys: HashMap<String, Vec<String>>,
}

#[derive(Serialize)]
struct MatrixKeysQueryResponse {
    device_keys: HashMap<String, HashMap<String, serde_json::Value>>,
    master_keys: HashMap<String, serde_json::Value>,
    self_signing_keys: HashMap<String, serde_json::Value>,
    failures: HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct MatrixKeysClaimRequest {
    one_time_keys: HashMap<String, HashMap<String, String>>,
}

#[derive(Serialize)]
struct MatrixKeysClaimResponse {
    one_time_keys: HashMap<String, HashMap<String, HashMap<String, serde_json::Value>>>,
    failures: HashMap<String, serde_json::Value>,
}

fn decode_base64(input: &str, field: &str) -> Result<Vec<u8>, ApiError> {
    URL_SAFE_NO_PAD
        .decode(input)
        .or_else(|_| URL_SAFE.decode(input))
        .or_else(|_| STANDARD_NO_PAD.decode(input))
        .or_else(|_| STANDARD.decode(input))
        .map_err(|_| ApiError::BadRequest(format!("invalid base64 in {field}")))
}

fn encode_matrix_base64(input: &[u8]) -> String {
    STANDARD_NO_PAD.encode(input)
}

fn matrix_user_id_for(user_id: Uuid) -> String {
    format!(
        "@{}:{MATRIX_SERVER_NAME}",
        user_id.to_string().to_lowercase()
    )
}

fn parse_matrix_user_id(matrix_user_id: &str) -> Result<Uuid, ApiError> {
    let Some(rest) = matrix_user_id.strip_prefix('@') else {
        return Err(ApiError::BadRequest("invalid Matrix user id".into()));
    };
    let Some((raw_id, server_name)) = rest.split_once(':') else {
        return Err(ApiError::BadRequest("invalid Matrix user id".into()));
    };
    if server_name != MATRIX_SERVER_NAME {
        return Err(ApiError::BadRequest("unexpected Matrix server name".into()));
    }
    Uuid::parse_str(raw_id).map_err(|_| ApiError::BadRequest("invalid Matrix user UUID".into()))
}

fn matrix_device_id_for(device_id: Uuid) -> String {
    device_id.simple().to_string().to_ascii_uppercase()
}

fn parse_matrix_device_id(matrix_device_id: &str) -> Result<Uuid, ApiError> {
    if matrix_device_id.len() != 32 || !matrix_device_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest("invalid Matrix device id".into()));
    }

    let normalized = matrix_device_id.to_ascii_lowercase();
    let dashed = format!(
        "{}-{}-{}-{}-{}",
        &normalized[0..8],
        &normalized[8..12],
        &normalized[12..16],
        &normalized[16..20],
        &normalized[20..32]
    );
    Uuid::parse_str(&dashed).map_err(|_| ApiError::BadRequest("invalid Matrix device UUID".into()))
}

fn matrix_key_slot(matrix_key_id: &str) -> i64 {
    let mut hasher = Sha256::new();
    hasher.update(matrix_key_id.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    bytes[0] &= 0x7f;
    i64::from_be_bytes(bytes)
}

fn matrix_key_signature(
    signatures: &HashMap<String, HashMap<String, String>>,
    matrix_user_id: &str,
    matrix_device_id: &str,
    field: &str,
) -> Result<Vec<u8>, ApiError> {
    signatures
        .get(matrix_user_id)
        .and_then(|by_key| by_key.get(&format!("ed25519:{matrix_device_id}")))
        .ok_or_else(|| ApiError::BadRequest(format!("missing signature for {field}")))
        .and_then(|sig| decode_base64(sig, field))
}

async fn create_device(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateDeviceRequest>,
) -> Result<Json<DeviceResponse>, ApiError> {
    // Check device limit against all non-revoked device shells so repeated
    // failed registrations cannot create an unbounded number of placeholders.
    let count = DeviceRepo::count_active_for_user(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    if count >= MAX_DEVICES_PER_USER {
        return Err(ApiError::from(AuthError::DeviceLimitExceeded));
    }

    let enrolled = DeviceRepo::count_enrolled_for_user(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Only already-enrolled devices can require pairing. Half-created device
    // shells from failed crypto setup must not block first-device trust.
    let pairing_token_id = if enrolled > 0 {
        let pairing_code = req.pairing_code.as_deref().ok_or_else(|| {
            ApiError::BadRequest("pairing_code is required when pairing additional devices".into())
        })?;
        let pair = DevicePairingTokenRepo::find_valid_by_hash(
            &state.db,
            auth.user_id.0,
            &hash_pairing_code(pairing_code),
        )
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::BadRequest("invalid or expired pairing code".into()))?;

        if let Some(created_by_device_id) = pair.created_by_device_id {
            if let Some(request_device_id) = auth.device_id {
                if request_device_id.0 != created_by_device_id {
                    return Err(ApiError::Forbidden);
                }
            }

            let originating_device = DeviceRepo::find_by_id(&state.db, created_by_device_id)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?;
            if originating_device.and_then(|d| d.revoked_at).is_some() {
                return Err(ApiError::BadRequest(
                    "pairing code was issued by a revoked device".into(),
                ));
            }
        }

        Some(pair.id)
    } else {
        None
    };

    let device_id = new_id();
    let now = Utc::now().fixed_offset();

    // Wrap device + initial SPK creation in a transaction
    let txn = state
        .db
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let device = DeviceRepo::create(
        &txn,
        devices::ActiveModel {
            id: Set(device_id),
            user_id: Set(auth.user_id.0),
            display_name: Set(req.display_name),
            platform: Set(req.platform.to_string()),
            identity_key: Set(None),
            created_at: Set(now),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    if let Some(token_id) = pairing_token_id {
        let consumed = DevicePairingTokenRepo::consume(&txn, auth.user_id.0, token_id, device_id)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        if !consumed {
            return Err(ApiError::BadRequest("pairing code was already used".into()));
        }
    }

    if auth.device_id.is_none() {
        let bound = SessionRepo::bind_device(&txn, auth.session_id.0, auth.user_id.0, device_id)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        if !bound {
            return Err(ApiError::Unauthorized);
        }
    }

    txn.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(DeviceResponse::from(device)))
}

fn hash_pairing_code(code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code.as_bytes());
    hex::encode(hasher.finalize())
}

fn generate_pairing_code() -> String {
    use rand::{Rng, distr::Alphanumeric};
    let mut rng = rand::rng();
    (0..12)
        .map(|_| {
            let c = rng.sample(Alphanumeric) as char;
            c
        })
        .collect()
}

async fn create_device_pairing_code(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<DevicePairingResponse>, ApiError> {
    let Some(device_id) = auth.device_id.map(|id| id.0) else {
        return Err(ApiError::BadRequest(
            "current session must be bound to an active device before pairing another device"
                .into(),
        ));
    };

    // Keep pairing flow scoped to users with at least one registered device.
    let existing = DeviceRepo::count_enrolled_for_user(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    if existing == 0 {
        return Err(ApiError::BadRequest(
            "no active device exists for pairing; register this device normally first".into(),
        ));
    }

    let code = generate_pairing_code();
    let expires_at = Utc::now().fixed_offset() + chrono::Duration::minutes(15);

    let row = DevicePairingTokenRepo::create(
        &state.db,
        device_pairing_tokens::ActiveModel {
            id: Set(new_id()),
            user_id: Set(auth.user_id.0),
            created_by_device_id: Set(Some(device_id)),
            code_hash: Set(hash_pairing_code(&code)),
            used_at: Set(None),
            used_by_device_id: Set(None),
            expires_at: Set(expires_at),
            created_at: Set(Utc::now().fixed_offset()),
        },
    )
    .await
    .map_err(|e| {
        // Should never collide with unique hashes, but keep error surfaced for
        // unexpected DB constraint failures.
        ApiError::Database(e.to_string())
    })?;

    Ok(Json(DevicePairingResponse {
        code,
        expires_at: row.expires_at.to_rfc3339(),
    }))
}

async fn list_devices(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<DeviceResponse>>, ApiError> {
    let devices = DeviceRepo::list_enrolled_for_user(&*state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(
        devices.into_iter().map(DeviceResponse::from).collect(),
    ))
}

async fn bind_device(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(device_id): Path<Id>,
) -> Result<(), ApiError> {
    let device = DeviceRepo::find_by_id_and_user(&state.db, device_id, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("device not found".into()))?;

    if device.revoked_at.is_some() {
        return Err(ApiError::BadRequest("device is revoked".into()));
    }

    if device.matrix_curve25519_key.is_none()
        || device.matrix_ed25519_key.is_none()
        || device.matrix_device_signature.is_none()
    {
        return Err(ApiError::BadRequest("device is not enrolled".into()));
    }

    if auth.device_id == Some(eulesia_common::types::DeviceId(device_id)) {
        return Ok(());
    }

    if auth.device_id.is_some() {
        return Err(ApiError::BadRequest(
            "current session is already bound to a different device".into(),
        ));
    }

    let bound = SessionRepo::bind_device(&*state.db, auth.session_id.0, auth.user_id.0, device_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    if !bound {
        return Err(ApiError::Unauthorized);
    }

    Ok(())
}

async fn revoke_device(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(device_id): Path<Id>,
) -> Result<(), ApiError> {
    // Verify ownership
    DeviceRepo::find_by_id_and_user(&state.db, device_id, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound("device not found".into()))?;

    DeviceRepo::revoke(&state.db, device_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Revoke all sessions bound to this device
    SessionRepo::revoke_device_sessions(&state.db, device_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Sessions without a device binding can still act on behalf of any active
    // device they name explicitly, so revoke those too when a device is
    // removed.
    SessionRepo::revoke_unbound_sessions_for_user(&state.db, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(())
}

async fn upload_matrix_keys(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(device_id): Path<Id>,
    Json(req): Json<MatrixKeysUploadRequest>,
) -> Result<Json<MatrixKeysUploadResponse>, ApiError> {
    let device = DeviceRepo::find_by_id_and_user(&state.db, device_id, auth.user_id.0)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .ok_or(ApiError::Forbidden)?;

    if device.revoked_at.is_some() {
        return Err(ApiError::BadRequest("device is revoked".into()));
    }

    let matrix_user_id = matrix_user_id_for(auth.user_id.0);
    let matrix_device_id = matrix_device_id_for(device_id);

    if let Some(device_keys) = req.device_keys {
        if device_keys.user_id != matrix_user_id {
            return Err(ApiError::BadRequest(
                "matrix user id does not match session".into(),
            ));
        }
        if device_keys.device_id != matrix_device_id {
            return Err(ApiError::BadRequest(
                "matrix device id does not match path".into(),
            ));
        }

        let curve25519 = device_keys
            .keys
            .get(&format!("curve25519:{matrix_device_id}"))
            .ok_or_else(|| ApiError::BadRequest("missing curve25519 device key".into()))
            .and_then(|key| decode_base64(key, "device_keys.keys[curve25519]"))?;
        let ed25519 = device_keys
            .keys
            .get(&format!("ed25519:{matrix_device_id}"))
            .ok_or_else(|| ApiError::BadRequest("missing ed25519 device key".into()))
            .and_then(|key| decode_base64(key, "device_keys.keys[ed25519]"))?;
        let device_signature = matrix_key_signature(
            &device_keys.signatures,
            &matrix_user_id,
            &matrix_device_id,
            "device_keys.signatures",
        )?;

        let mut device_model = device.into_active_model();
        device_model.matrix_curve25519_key = Set(Some(curve25519));
        device_model.matrix_ed25519_key = Set(Some(ed25519));
        device_model.matrix_device_signature = Set(Some(device_signature));
        device_model
            .update(&*state.db)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
    }

    let now = Utc::now().fixed_offset();
    let mut matrix_keys = Vec::new();
    for (full_key_id, key) in &req.one_time_keys {
        let (algorithm, matrix_key_id) = full_key_id
            .split_once(':')
            .ok_or_else(|| ApiError::BadRequest("invalid Matrix one-time key id".into()))?;
        if algorithm != MATRIX_OTK_ALGORITHM {
            return Err(ApiError::BadRequest(
                "unsupported Matrix one-time key algorithm".into(),
            ));
        }
        matrix_keys.push(one_time_pre_keys::ActiveModel {
            id: Set(new_id()),
            device_id: Set(device_id),
            key_id: Set(matrix_key_slot(matrix_key_id)),
            key_data: Set(decode_base64(&key.key, "one_time_keys.key")?),
            key_signature: Set(Some(matrix_key_signature(
                &key.signatures,
                &matrix_user_id,
                &matrix_device_id,
                "one_time_keys.signatures",
            )?)),
            key_algorithm: Set(Some(MATRIX_OTK_ALGORITHM.to_string())),
            matrix_key_id: Set(Some(matrix_key_id.to_string())),
            is_fallback: Set(false),
            uploaded_at: Set(now),
            ..Default::default()
        });
    }

    for (full_key_id, key) in &req.fallback_keys {
        let (algorithm, matrix_key_id) = full_key_id
            .split_once(':')
            .ok_or_else(|| ApiError::BadRequest("invalid Matrix fallback key id".into()))?;
        matrix_keys.push(one_time_pre_keys::ActiveModel {
            id: Set(new_id()),
            device_id: Set(device_id),
            key_id: Set(matrix_key_slot(matrix_key_id)),
            key_data: Set(decode_base64(&key.key, "fallback_keys.key")?),
            key_signature: Set(Some(matrix_key_signature(
                &key.signatures,
                &matrix_user_id,
                &matrix_device_id,
                "fallback_keys.signatures",
            )?)),
            key_algorithm: Set(Some(algorithm.to_string())),
            matrix_key_id: Set(Some(matrix_key_id.to_string())),
            is_fallback: Set(true),
            uploaded_at: Set(now),
            ..Default::default()
        });
    }

    PreKeyRepo::upload_matrix_one_time_keys(&state.db, matrix_keys)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let available = PreKeyRepo::count_available_matrix_keys(&state.db, device_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(MatrixKeysUploadResponse {
        one_time_key_counts: HashMap::from([(MATRIX_OTK_ALGORITHM.to_string(), available)]),
    }))
}

async fn query_matrix_keys(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(req): Json<MatrixKeysQueryRequest>,
) -> Result<Json<MatrixKeysQueryResponse>, ApiError> {
    let requested_users = req
        .device_keys
        .keys()
        .map(|user_id| parse_matrix_user_id(user_id))
        .collect::<Result<Vec<_>, _>>()?;

    let devices = DeviceRepo::list_enrolled_for_users(&*state.db, &requested_users)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let mut device_keys = HashMap::<String, HashMap<String, serde_json::Value>>::new();
    for device in devices {
        let Some(curve25519) = device.matrix_curve25519_key.as_ref() else {
            continue;
        };
        let Some(ed25519) = device.matrix_ed25519_key.as_ref() else {
            continue;
        };
        let Some(device_signature) = device.matrix_device_signature.as_ref() else {
            continue;
        };

        let matrix_user_id = matrix_user_id_for(device.user_id);
        let matrix_device_id = matrix_device_id_for(device.id);

        if let Some(requested_device_ids) = req.device_keys.get(&matrix_user_id) {
            if !requested_device_ids.is_empty() && !requested_device_ids.contains(&matrix_device_id)
            {
                continue;
            }
        }

        device_keys.entry(matrix_user_id.clone()).or_default().insert(
            matrix_device_id.clone(),
            json!({
                "algorithms": ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
                "device_id": matrix_device_id,
                "keys": {
                    format!("curve25519:{}", matrix_device_id): encode_matrix_base64(curve25519),
                    format!("ed25519:{}", matrix_device_id): encode_matrix_base64(ed25519),
                },
                "signatures": {
                    matrix_user_id.clone(): {
                        format!("ed25519:{}", matrix_device_id): encode_matrix_base64(device_signature),
                    }
                },
                "unsigned": {
                    "device_display_name": device.display_name,
                },
                "user_id": matrix_user_id,
            }),
        );
    }

    Ok(Json(MatrixKeysQueryResponse {
        device_keys,
        master_keys: HashMap::new(),
        self_signing_keys: HashMap::new(),
        failures: HashMap::new(),
    }))
}

async fn claim_matrix_keys(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(req): Json<MatrixKeysClaimRequest>,
) -> Result<Json<MatrixKeysClaimResponse>, ApiError> {
    let mut one_time_keys =
        HashMap::<String, HashMap<String, HashMap<String, serde_json::Value>>>::new();

    for (matrix_user_id, devices) in req.one_time_keys {
        let user_id = parse_matrix_user_id(&matrix_user_id)?;
        for (matrix_device_id, algorithm) in devices {
            let device_id = parse_matrix_device_id(&matrix_device_id)?;
            let device = DeviceRepo::find_by_id_and_user(&state.db, device_id, user_id)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?
                .ok_or_else(|| ApiError::BadRequest("unknown Matrix device".into()))?;

            if device.revoked_at.is_some() {
                continue;
            }

            let Some(key) = PreKeyRepo::claim_matrix_key(&state.db, device_id, &algorithm)
                .await
                .map_err(|e| ApiError::Database(e.to_string()))?
            else {
                continue;
            };

            let Some(matrix_key_id) = key.matrix_key_id else {
                continue;
            };
            let Some(signature) = key.key_signature else {
                continue;
            };

            one_time_keys
                .entry(matrix_user_id.clone())
                .or_default()
                .entry(matrix_device_id.clone())
                .or_default()
                .insert(
                    format!("{algorithm}:{matrix_key_id}"),
                    json!({
                        "key": encode_matrix_base64(&key.key_data),
                        "signatures": {
                            matrix_user_id.clone(): {
                                format!("ed25519:{}", matrix_device_id): encode_matrix_base64(&signature),
                            }
                        }
                    }),
                );
        }
    }

    Ok(Json(MatrixKeysClaimResponse {
        one_time_keys,
        failures: HashMap::new(),
    }))
}

/// List active devices for a user.
///
/// This remains an authenticated endpoint so anonymous callers cannot enumerate
/// devices, but authenticated clients must be able to discover recipient
/// devices for E2EE session setup and Matrix room-key distribution.
pub async fn list_user_devices(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(user_id): Path<Id>,
) -> Result<Json<Vec<DeviceResponse>>, ApiError> {
    let devices = DeviceRepo::list_enrolled_for_user(&*state.db, user_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(
        devices.into_iter().map(DeviceResponse::from).collect(),
    ))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/devices", post(create_device).get(list_devices))
        .route("/devices/{id}/bind", post(bind_device))
        .route("/devices/{id}/matrix/keys/upload", post(upload_matrix_keys))
        .route("/devices/matrix/keys/query", post(query_matrix_keys))
        .route("/devices/matrix/keys/claim", post(claim_matrix_keys))
        .route("/devices/pairing-codes", post(create_device_pairing_code))
        .route("/devices/{id}", delete(revoke_device))
}

#[cfg(test)]
mod tests {
    use super::decode_base64;

    #[test]
    fn decode_base64_accepts_standard_no_pad() {
        let decoded = decode_base64("AQIDBPr7", "device_keys.keys[ed25519]").unwrap();
        assert_eq!(decoded, vec![1, 2, 3, 4, 250, 251]);
    }

    #[test]
    fn decode_base64_accepts_url_safe_no_pad() {
        let decoded = decode_base64("-_8", "device_keys.keys[ed25519]").unwrap();
        assert_eq!(decoded, vec![251, 255]);
    }
}
