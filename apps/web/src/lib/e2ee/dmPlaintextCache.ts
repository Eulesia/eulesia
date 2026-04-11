// ---------------------------------------------------------------------------
// IndexedDB-backed plaintext cache for decrypted DM messages.
//
// Olm decryption via receiveSyncChanges is stateful — the ratchet advances
// on each call and the result is persisted to IndexedDB.  Re-processing the
// same event on a subsequent page load fails because the ratchet was already
// consumed.  This cache stores the plaintext after the first successful
// decryption so we never need to call receiveSyncChanges for the same
// message twice.
//
// Security: same threat model as the OlmMachine IndexedDB store (session
// keys are already cleartext at rest in the browser).  The cache is scoped
// to userId:deviceId and cleared on logout/device revocation.
// ---------------------------------------------------------------------------

const DB_VERSION = 1;
const STORE_NAME = "plaintext";

let dbPromise: Promise<IDBDatabase> | null = null;
let currentDbName: string | null = null;

function dbName(userId: string, deviceId: string): string {
  return `eulesia-dm-cache:${userId}:${deviceId}`;
}

function openDb(userId: string, deviceId: string): Promise<IDBDatabase> {
  const name = dbName(userId, deviceId);

  // Reuse existing connection if scope matches.
  if (dbPromise && currentDbName === name) return dbPromise;

  currentDbName = name;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "messageId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let scopeUserId: string | null = null;
let scopeDeviceId: string | null = null;

/** Set the cache scope.  Must be called before any read/write. */
export function initPlaintextCache(userId: string, deviceId: string): void {
  scopeUserId = userId;
  scopeDeviceId = deviceId;
}

/** Cache a successfully-decrypted plaintext. */
export async function cachePlaintext(
  messageId: string,
  plaintext: string,
): Promise<void> {
  if (!scopeUserId || !scopeDeviceId) return;
  try {
    const db = await openDb(scopeUserId, scopeDeviceId);
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ messageId, plaintext });
  } catch {
    // Best-effort — don't break the app if IDB fails.
  }
}

/** Load cached plaintext.  Returns null on miss. */
export async function loadPlaintext(messageId: string): Promise<string | null> {
  if (!scopeUserId || !scopeDeviceId) return null;
  try {
    const db = await openDb(scopeUserId, scopeDeviceId);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(messageId);
      req.onsuccess = () => {
        const row = req.result as { plaintext: string } | undefined;
        resolve(row?.plaintext ?? null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Delete the entire cache database (logout / device revocation). */
export async function clearAllPlaintext(): Promise<void> {
  if (!scopeUserId || !scopeDeviceId) return;
  const name = dbName(scopeUserId, scopeDeviceId);

  // Close existing connection first.
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
    dbPromise = null;
    currentDbName = null;
  }

  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

// ---------------------------------------------------------------------------
// Legacy sessionStorage helpers (kept for backward-compat during migration)
// ---------------------------------------------------------------------------

const SESSION_PREFIX = "eulesia.dm-plaintext.v1";

export function cacheSentDmPlaintext(data: {
  messageId: string;
  content: string;
  deviceId: string;
  senderId: string;
}): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    `${SESSION_PREFIX}:${data.messageId}`,
    JSON.stringify({
      content: data.content,
      deviceId: data.deviceId,
      senderId: data.senderId,
    }),
  );
  // Also write to IDB so it survives page reload.
  cachePlaintext(data.messageId, data.content);
}

export function loadCachedDmPlaintext(data: {
  messageId: string;
  deviceId: string;
  senderId: string;
}): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(
    `${SESSION_PREFIX}:${data.messageId}`,
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      content: string;
      deviceId: string;
      senderId: string;
    };
    if (
      parsed.deviceId !== data.deviceId ||
      parsed.senderId !== data.senderId ||
      typeof parsed.content !== "string"
    ) {
      return null;
    }
    return parsed.content;
  } catch {
    return null;
  }
}

export function clearLegacyDmPlaintextCache(): void {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(SESSION_PREFIX)) keysToRemove.push(key);
  }
  for (const key of keysToRemove) window.localStorage.removeItem(key);
}
