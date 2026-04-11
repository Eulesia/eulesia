import type {
  ApiClient,
  MatrixKeysClaimPayload,
  MatrixKeysQueryPayload,
  MatrixKeysUploadPayload,
} from "./apiTypes.ts";
import {
  asMatrixDeviceId,
  asMatrixUserId,
  getMatrixCryptoMachine,
  getMatrixCryptoModule,
  serializeCryptoOp,
} from "./matrixCrypto.ts";

async function requireMatrixMachine() {
  const machine = await getMatrixCryptoMachine();
  if (!machine) {
    throw new Error("Matrix crypto machine is not initialized");
  }
  return machine;
}

async function markRequestAsSent(
  requestId: string,
  requestType: import("@matrix-org/matrix-sdk-crypto-wasm").RequestType,
  response: unknown,
): Promise<void> {
  const machine = await requireMatrixMachine();
  await machine.markRequestAsSent(
    requestId,
    requestType,
    JSON.stringify(response),
  );
}

export async function syncMatrixMachine(
  api: ApiClient,
  deviceId: string,
): Promise<void> {
  const matrix = await getMatrixCryptoModule();
  const machine = await requireMatrixMachine();

  for (;;) {
    const requests = await machine.outgoingRequests();
    let handledRequest = false;

    for (const request of requests) {
      if (request instanceof matrix.KeysUploadRequest) {
        handledRequest = true;
        const response = await api.uploadMatrixKeys(
          deviceId,
          JSON.parse(request.body) as MatrixKeysUploadPayload,
        );
        await markRequestAsSent(request.id, request.type, response);
        continue;
      }

      if (request instanceof matrix.KeysQueryRequest) {
        handledRequest = true;
        const response = await api.queryMatrixKeys(
          JSON.parse(request.body) as MatrixKeysQueryPayload,
        );
        await markRequestAsSent(request.id, request.type, response);
        continue;
      }

      if (request instanceof matrix.KeysClaimRequest) {
        handledRequest = true;
        const response = await api.claimMatrixKeys(
          JSON.parse(request.body) as MatrixKeysClaimPayload,
        );
        await markRequestAsSent(request.id, request.type, response);
      }
    }

    if (!handledRequest) {
      return;
    }
  }
}

export async function ensureMatrixSessions(
  api: ApiClient,
  deviceId: string,
  userIds: string[],
): Promise<void> {
  const matrix = await getMatrixCryptoModule();
  const machine = await requireMatrixMachine();
  const uniqueUserIds = [...new Set(userIds)].map((userId) =>
    asMatrixUserId(userId),
  );

  await machine.updateTrackedUsers(
    uniqueUserIds.map((userId) => new matrix.UserId(userId)),
  );
  await syncMatrixMachine(api, deviceId);

  for (;;) {
    const claimRequest = await machine.getMissingSessions(
      uniqueUserIds.map((userId) => new matrix.UserId(userId)),
    );
    if (!claimRequest) {
      return;
    }

    const response = await api.claimMatrixKeys(
      JSON.parse(claimRequest.body) as MatrixKeysClaimPayload,
    );
    await markRequestAsSent(claimRequest.id, claimRequest.type, response);
    await syncMatrixMachine(api, deviceId);
  }
}

/**
 * Ensure the OlmMachine has queried the given users' device identity keys.
 * This is required on the recipient side before decrypting Olm pre-key
 * messages — without the sender's identity keys the machine can't verify
 * or decrypt the session.
 */
export async function ensureUserKeysKnown(
  api: ApiClient,
  deviceId: string,
  userIds: string[],
): Promise<void> {
  const matrix = await getMatrixCryptoModule();
  const machine = await requireMatrixMachine();
  const uniqueUserIds = [...new Set(userIds)].map((userId) =>
    asMatrixUserId(userId),
  );

  await machine.updateTrackedUsers(
    uniqueUserIds.map((userId) => new matrix.UserId(userId)),
  );
  await syncMatrixMachine(api, deviceId);
}

export async function getMatrixDevice(userId: string, deviceId: string) {
  const matrix = await getMatrixCryptoModule();
  const machine = await requireMatrixMachine();

  return machine.getDevice(
    new matrix.UserId(asMatrixUserId(userId)),
    new matrix.DeviceId(asMatrixDeviceId(deviceId)),
  );
}

type MatrixToDeviceEvent = {
  type: string;
  sender: string;
  content: Record<string, unknown>;
};

export function decryptMatrixToDeviceEvent(
  event: MatrixToDeviceEvent,
): Promise<Record<string, unknown>> {
  return serializeCryptoOp(() => decryptSingle(event));
}

async function decryptSingle(
  event: MatrixToDeviceEvent,
): Promise<Record<string, unknown>> {
  const matrix = await getMatrixCryptoModule();
  const machine = await requireMatrixMachine();
  const processedEvents = await machine.receiveSyncChanges(
    JSON.stringify([event]),
    new matrix.DeviceLists(),
    new Map<string, number>(),
  );

  for (const pe of processedEvents) {
    if (pe instanceof matrix.DecryptedToDeviceEvent) {
      return JSON.parse(pe.rawEvent) as Record<string, unknown>;
    }
    if (pe instanceof matrix.UTDToDeviceEvent) {
      const reason = pe.utdInfo?.reason ?? "unknown";
      console.warn(
        `[e2ee] UTD to-device event from ${event.sender}: reason=${reason}`,
      );
      throw new Error(
        `Unable to decrypt to-device event (UTD reason: ${reason})`,
      );
    }
    if (pe instanceof matrix.InvalidToDeviceEvent) {
      console.warn(
        `[e2ee] Invalid to-device event from ${event.sender}:`,
        pe.rawEvent?.slice(0, 200),
      );
      throw new Error("Invalid to-device event (missing required fields)");
    }
    // PlainTextToDeviceEvent — not expected for m.room.encrypted
    console.warn(
      `[e2ee] Unexpected PlainText to-device event from ${event.sender}`,
    );
  }

  throw new Error("receiveSyncChanges returned no events");
}
