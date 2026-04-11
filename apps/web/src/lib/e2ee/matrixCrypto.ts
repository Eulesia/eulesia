import {
  getMatrixStoreName,
  toMatrixDeviceId,
  toMatrixRoomId,
  toMatrixUserId,
} from "./matrixIds.ts";

type MatrixCryptoModule = typeof import("@matrix-org/matrix-sdk-crypto-wasm");
type MatrixOlmMachine = import("@matrix-org/matrix-sdk-crypto-wasm").OlmMachine;

type MatrixMachineContext = {
  machine: MatrixOlmMachine;
  userId: string;
  deviceId: string;
};

let matrixModulePromise: Promise<MatrixCryptoModule> | null = null;
let activeMachinePromise: Promise<MatrixMachineContext> | null = null;

export async function getMatrixCryptoModule(): Promise<MatrixCryptoModule> {
  if (!matrixModulePromise) {
    matrixModulePromise = import("@matrix-org/matrix-sdk-crypto-wasm").then(
      async (module) => {
        await module.initAsync();
        return module;
      },
    );
  }

  return matrixModulePromise;
}

async function buildMatrixMachine(
  userId: string,
  deviceId: string,
): Promise<MatrixMachineContext> {
  const matrix = await getMatrixCryptoModule();
  const machine = await matrix.OlmMachine.initialize(
    new matrix.UserId(toMatrixUserId(userId)),
    new matrix.DeviceId(toMatrixDeviceId(deviceId)),
    getMatrixStoreName(userId, deviceId),
  );

  return { machine, userId, deviceId };
}

export async function initializeMatrixCryptoMachine(
  userId: string,
  deviceId: string,
): Promise<MatrixOlmMachine> {
  const current = activeMachinePromise
    ? await activeMachinePromise.catch(() => null)
    : null;

  if (current && current.userId === userId && current.deviceId === deviceId) {
    return current.machine;
  }

  if (current) {
    current.machine.close();
  }

  activeMachinePromise = buildMatrixMachine(userId, deviceId);
  const next = await activeMachinePromise;
  return next.machine;
}

export async function getMatrixCryptoMachine(): Promise<MatrixOlmMachine | null> {
  if (!activeMachinePromise) {
    return null;
  }

  const current = await activeMachinePromise;
  return current.machine;
}

export async function closeMatrixCryptoMachine(): Promise<void> {
  if (!activeMachinePromise) {
    return;
  }

  const current = await activeMachinePromise.catch(() => null);
  activeMachinePromise = null;

  current?.machine.close();
}

// ---------------------------------------------------------------------------
// Shared serialization queue for OlmMachine operations.
//
// The WASM OlmMachine persists Olm/Megolm session state to IndexedDB.
// Concurrent receiveSyncChanges / decryptRoomEvent calls race on that
// state — e.g. a pre-key message that creates a session must persist
// before the next message can use it.  This queue ensures at most one
// crypto operation runs at a time.
// ---------------------------------------------------------------------------

let cryptoQueue: Promise<void> = Promise.resolve();

export function serializeCryptoOp<T>(fn: () => Promise<T>): Promise<T> {
  const result = cryptoQueue.then(fn, fn);
  cryptoQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

export function asMatrixUserId(userId: string): string {
  return toMatrixUserId(userId);
}

export function asMatrixDeviceId(deviceId: string): string {
  return toMatrixDeviceId(deviceId);
}

export function asMatrixRoomId(conversationId: string): string {
  return toMatrixRoomId(conversationId);
}
