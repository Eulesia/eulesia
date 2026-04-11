import { fromBase64url, loadDeviceKeys, toBase64url } from "../crypto/index.ts";
import type { ApiClient } from "./apiTypes.ts";
import {
  decryptMatrixToDeviceEvent,
  ensureMatrixSessions,
  getMatrixDevice,
} from "./matrixApiAdapter.ts";
import { asMatrixUserId } from "./matrixCrypto.ts";

const MATRIX_DM_EVENT_TYPE = "org.eulesia.dm.message";

type MatrixDmPayload = {
  conversation_id: string;
  body: string;
};

type MatrixEncryptedToDeviceEvent = {
  type: "m.room.encrypted";
  sender: string;
  content: Record<string, unknown>;
};

function decodeMatrixEncryptedEvent(
  ciphertextB64: string,
): MatrixEncryptedToDeviceEvent {
  const eventBytes = fromBase64url(ciphertextB64);
  const eventJson = new TextDecoder().decode(eventBytes);
  return JSON.parse(eventJson) as MatrixEncryptedToDeviceEvent;
}

export async function encryptConversationWithMatrix(
  conversationId: string,
  targetDevices: Array<{ deviceId: string; userId: string }>,
  plaintext: string,
  api: ApiClient,
): Promise<{ deviceCiphertexts: Record<string, string> }> {
  const localDeviceKeys = await loadDeviceKeys();
  if (!localDeviceKeys?.userId) {
    throw new Error("Local device identity is not available");
  }

  await ensureMatrixSessions(
    api,
    localDeviceKeys.deviceId,
    targetDevices.map((target) => target.userId),
  );

  const deviceCiphertexts: Record<string, string> = {};
  const payload: MatrixDmPayload = {
    conversation_id: conversationId,
    body: plaintext,
  };

  for (const target of targetDevices) {
    if (
      target.userId === localDeviceKeys.userId &&
      target.deviceId === localDeviceKeys.deviceId
    ) {
      continue;
    }

    const device = await getMatrixDevice(target.userId, target.deviceId);
    if (!device) {
      throw new Error(
        `Missing Matrix device for ${target.userId}/${target.deviceId}`,
      );
    }

    let encryptedContent: string;
    try {
      encryptedContent = await device.encryptToDeviceEvent(
        MATRIX_DM_EVENT_TYPE,
        payload,
      );
    } catch (error) {
      throw new Error(
        `Failed to encrypt DM for ${target.userId}/${target.deviceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const encryptedEvent: MatrixEncryptedToDeviceEvent = {
      type: "m.room.encrypted",
      sender: asMatrixUserId(localDeviceKeys.userId),
      content: JSON.parse(encryptedContent) as Record<string, unknown>,
    };

    deviceCiphertexts[target.deviceId] = toBase64url(
      new TextEncoder().encode(JSON.stringify(encryptedEvent)),
    );
  }

  return { deviceCiphertexts };
}

export async function decryptConversationWithMatrix(
  conversationId: string,
  ciphertextB64: string,
  messageId?: string,
): Promise<string> {
  // Check the IndexedDB plaintext cache first.  Olm decryption via
  // receiveSyncChanges is stateful — the ratchet advances on each call.
  // Re-processing the same event after a page reload fails because the
  // ratchet was already consumed.  The cache lets us skip Olm entirely for
  // messages we've already successfully decrypted.
  if (messageId) {
    const { loadPlaintext } = await import("./dmPlaintextCache.ts");
    const cached = await loadPlaintext(messageId);
    if (cached !== null) return cached;
  }

  const encryptedEvent = decodeMatrixEncryptedEvent(ciphertextB64);
  const decryptedEvent = await decryptMatrixToDeviceEvent(encryptedEvent);

  if (decryptedEvent.type !== MATRIX_DM_EVENT_TYPE) {
    throw new Error("Unexpected Matrix DM event type");
  }

  const content = decryptedEvent.content as MatrixDmPayload | undefined;
  if (!content || content.conversation_id !== conversationId) {
    throw new Error("Matrix DM payload does not match the conversation");
  }

  if (typeof content.body !== "string") {
    throw new Error("Matrix DM payload is missing the message body");
  }

  // Cache the plaintext so subsequent page loads don't hit the Olm ratchet.
  if (messageId) {
    const { cachePlaintext } = await import("./dmPlaintextCache.ts");
    await cachePlaintext(messageId, content.body);
  }

  return content.body;
}
