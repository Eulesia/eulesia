/**
 * @module store
 *
 * IndexedDB-backed local device storage.
 *
 * browser's native IndexedDB. This module now stores only non-secret device
 * metadata outside the Matrix crypto store.
 *
 * Uses only the native IndexedDB API with no third-party wrappers.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name. */
const DB_NAME = "eulesia-e2ee-keystore";

/** Current schema version. */
const DB_VERSION = 4;

/** Object store names. */
const STORE_DEVICE_KEYS = "deviceKeys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Device-scoped metadata retained outside the Matrix crypto store. */
export interface DeviceKeys {
  /** The authenticated user that owns this local device identity. */
  userId?: string;
  /** Unique identifier for this device (UUID). */
  deviceId: string;
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

/**
 * Open (or create) the IndexedDB key store.
 *
 * On first use the object stores are created. On subsequent calls the
 * existing database is opened.
 */
export async function openKeyStore(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Device keys — single record keyed by deviceId
      if (!db.objectStoreNames.contains(STORE_DEVICE_KEYS)) {
        db.createObjectStore(STORE_DEVICE_KEYS, { keyPath: "deviceId" });
      }

      // Clean out retired stores from the bespoke protocol implementation.
      if (db.objectStoreNames.contains("sessions")) {
        db.deleteObjectStore("sessions");
      }
      if (db.objectStoreNames.contains("senderKeys")) {
        db.deleteObjectStore("senderKeys");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a single IndexedDB transaction that writes or reads a value.
 * Wraps the callback-based API in a Promise.
 */
function tx<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const req = operation(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

// ---------------------------------------------------------------------------
// Device keys
// ---------------------------------------------------------------------------

/**
 * Persist device key material to IndexedDB.
 *
 * Clears any stale device key records first so that exactly one record
 * exists after the write. This prevents `loadDeviceKeys` from
 * non-deterministically picking an arbitrary device when multiple
 * records have accumulated.
 */
export async function saveDeviceKeys(keys: DeviceKeys): Promise<void> {
  const db = await openKeyStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_DEVICE_KEYS, "readwrite");
      const store = transaction.objectStore(STORE_DEVICE_KEYS);
      store.clear();
      store.put(keys);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Load device key material from IndexedDB.
 *
 * Returns the first (and typically only) device key record, or `null` if
 * none exists.
 */
export async function loadDeviceKeys(): Promise<DeviceKeys | null> {
  const db = await openKeyStore();
  try {
    const result = await tx(
      db,
      STORE_DEVICE_KEYS,
      "readonly",
      (store) => store.getAll() as IDBRequest<DeviceKeys[]>,
    );
    return result.length > 0 ? result[0]! : null;
  } finally {
    db.close();
  }
}

/**
 * Load device key material for a specific device ID.
 */
export async function loadDeviceKeysById(
  deviceId: string,
): Promise<DeviceKeys | null> {
  const db = await openKeyStore();
  try {
    const result = await tx(
      db,
      STORE_DEVICE_KEYS,
      "readonly",
      (store) => store.get(deviceId) as IDBRequest<DeviceKeys | undefined>,
    );
    return result ?? null;
  } finally {
    db.close();
  }
}

/**
 * Delete the entire key store database.
 *
 * This is a destructive operation intended for account reset or device
 * revocation. All locally persisted device keys will be permanently lost.
 */
export async function clearKeyStore(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
