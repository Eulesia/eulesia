const MATRIX_SERVER_NAME = "eulesia.invalid";

function normalizeOpaqueId(id: string): string {
  return id.trim().toLowerCase();
}

export function toMatrixUserId(userId: string): string {
  return `@${normalizeOpaqueId(userId)}:${MATRIX_SERVER_NAME}`;
}

export function fromMatrixUserId(matrixUserId: string): string {
  const normalized = matrixUserId.trim().toLowerCase();
  const prefix = "@";
  const suffix = `:${MATRIX_SERVER_NAME}`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) {
    throw new Error("Invalid Matrix user ID");
  }

  return normalized.slice(prefix.length, -suffix.length);
}

export function toMatrixDeviceId(deviceId: string): string {
  return normalizeOpaqueId(deviceId).replace(/-/g, "").toUpperCase();
}

export function fromMatrixDeviceId(matrixDeviceId: string): string {
  const normalized = matrixDeviceId.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw new Error("Invalid Matrix device ID");
  }

  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join("-");
}

export function toMatrixRoomId(conversationId: string): string {
  return `!${normalizeOpaqueId(conversationId)}:${MATRIX_SERVER_NAME}`;
}

export function toMatrixEventId(messageId: string): string {
  return `$${normalizeOpaqueId(messageId)}:${MATRIX_SERVER_NAME}`;
}

export function getMatrixStoreName(userId: string, deviceId: string): string {
  return `eulesia-matrix-crypto:${normalizeOpaqueId(userId)}:${normalizeOpaqueId(deviceId)}`;
}
