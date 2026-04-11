import { fromBase64url, loadDeviceKeys, toBase64url } from "../crypto/index.ts";
import type { ApiClient } from "./apiTypes.ts";
import { ensureMatrixSessions } from "./matrixApiAdapter.ts";
import {
  asMatrixRoomId,
  asMatrixUserId,
  getMatrixCryptoMachine,
  getMatrixCryptoModule,
  serializeCryptoOp,
} from "./matrixCrypto.ts";
import {
  fromMatrixDeviceId,
  toMatrixEventId,
  toMatrixRoomId,
} from "./matrixIds.ts";

type MatrixEncryptedRoomEventContent = Record<string, unknown>;
type MatrixToDeviceEnvelope = {
  sender: string;
  type: string;
  content: Record<string, unknown>;
};
type MatrixToDeviceRequestBody = {
  messages?: Record<string, Record<string, Record<string, unknown>>>;
};

const roomEpochs = new Map<string, number>();

async function requireMatrixMachine() {
  const machine = await getMatrixCryptoMachine();
  if (!machine) {
    throw new Error("Matrix crypto machine is not initialized");
  }

  return machine;
}

async function getMatrixRoomId(conversationId: string) {
  const matrix = await getMatrixCryptoModule();
  return new matrix.RoomId(asMatrixRoomId(conversationId));
}

function getMessageTimestamp(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) {
    throw new Error("Invalid message timestamp");
  }

  return parsed;
}

async function ensureRoomKeysShared(
  conversationId: string,
  currentEpoch: number,
  memberUserIds: string[],
  api: ApiClient,
): Promise<void> {
  const deviceKeys = await loadDeviceKeys();
  if (!deviceKeys?.userId) {
    throw new Error("Local device identity is not available");
  }

  const matrix = await getMatrixCryptoModule();
  const machine = await requireMatrixMachine();
  const roomId = await getMatrixRoomId(conversationId);
  const memberIds = [...new Set(memberUserIds)];

  const roomSettings = new matrix.RoomSettings();
  roomSettings.onlyAllowTrustedDevices = false;
  await machine.setRoomSettings(roomId, roomSettings);

  const previousEpoch = roomEpochs.get(conversationId);
  if (previousEpoch !== currentEpoch) {
    await machine.invalidateGroupSession(roomId);
    roomEpochs.set(conversationId, currentEpoch);
  }

  await ensureMatrixSessions(api, deviceKeys.deviceId, memberIds);

  const encryptionSettings = new matrix.EncryptionSettings();
  encryptionSettings.sharingStrategy = matrix.CollectStrategy.allDevices();

  const requests = await machine.shareRoomKey(
    roomId,
    memberIds.map((userId) => new matrix.UserId(asMatrixUserId(userId))),
    encryptionSettings,
  );

  for (const request of requests) {
    const payload = JSON.parse(request.body) as MatrixToDeviceRequestBody;
    const messages = payload.messages ?? {};
    const deviceCiphertexts: Record<string, string> = {};

    for (const byDevice of Object.values(messages)) {
      for (const [matrixDeviceId, content] of Object.entries(byDevice)) {
        const event: MatrixToDeviceEnvelope = {
          sender: asMatrixUserId(deviceKeys.userId),
          type: request.event_type,
          content,
        };
        deviceCiphertexts[fromMatrixDeviceId(matrixDeviceId)] = toBase64url(
          new TextEncoder().encode(JSON.stringify(event)),
        );
      }
    }

    if (Object.keys(deviceCiphertexts).length === 0) {
      continue;
    }

    await api.sendGroupToDevice(conversationId, {
      deviceCiphertexts,
      senderDeviceId: deviceKeys.deviceId,
    });
  }
}

export function processMatrixGroupToDeviceMessages(
  ciphertexts: string[],
): Promise<void> {
  if (ciphertexts.length === 0) {
    return Promise.resolve();
  }

  return serializeCryptoOp(async () => {
    const matrix = await getMatrixCryptoModule();
    const machine = await requireMatrixMachine();
    const events = ciphertexts.map((ciphertext) => {
      const eventBytes = fromBase64url(ciphertext);
      const eventJson = new TextDecoder().decode(eventBytes);
      return JSON.parse(eventJson);
    });

    await machine.receiveSyncChanges(
      JSON.stringify(events),
      new matrix.DeviceLists(),
      new Map<string, number>(),
    );
  });
}

export async function encryptGroupMessageWithMatrix(
  conversationId: string,
  plaintext: string,
  currentEpoch: number,
  memberUserIds: string[],
  api: ApiClient,
): Promise<string> {
  await ensureRoomKeysShared(conversationId, currentEpoch, memberUserIds, api);

  const machine = await requireMatrixMachine();
  const roomId = await getMatrixRoomId(conversationId);
  const encryptedContent = await machine.encryptRoomEvent(
    roomId,
    "m.room.message",
    JSON.stringify({
      body: plaintext,
      msgtype: "m.text",
    }),
  );

  return toBase64url(new TextEncoder().encode(encryptedContent));
}

export function decryptGroupMessageWithMatrix(data: {
  conversationId: string;
  ciphertext: string;
  messageId: string;
  senderUserId: string;
  createdAt: string;
}): Promise<string> {
  return serializeCryptoOp(async () => {
    const matrix = await getMatrixCryptoModule();
    const machine = await requireMatrixMachine();
    const roomId = await getMatrixRoomId(data.conversationId);
    const encryptedContentJson = new TextDecoder().decode(
      fromBase64url(data.ciphertext),
    );
    const encryptedContent = JSON.parse(
      encryptedContentJson,
    ) as MatrixEncryptedRoomEventContent;
    const eventJson = JSON.stringify({
      content: encryptedContent,
      event_id: toMatrixEventId(data.messageId),
      origin_server_ts: getMessageTimestamp(data.createdAt),
      room_id: toMatrixRoomId(data.conversationId),
      sender: asMatrixUserId(data.senderUserId),
      type: "m.room.encrypted",
    });

    const decryptedEvent = await machine.decryptRoomEvent(
      eventJson,
      roomId,
      new matrix.DecryptionSettings(matrix.TrustRequirement.Untrusted),
    );
    const payload = JSON.parse(decryptedEvent.event) as {
      content?: { body?: string };
    };
    const body = payload.content?.body;

    if (typeof body !== "string") {
      throw new Error(
        "Matrix group message payload is missing the message body",
      );
    }

    return body;
  });
}
