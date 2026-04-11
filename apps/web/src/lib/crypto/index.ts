/**
 * @module crypto
 *
 * Shared encoding helpers and local device metadata storage.
 *
 * Re-exports all public APIs from the individual modules:
 *
 * - **keys** — Base64url helpers for Matrix payload transport.
 * - **store** — IndexedDB-backed device state persistence.
 */

export { toBase64url, fromBase64url } from "./keys.ts";

// store — IndexedDB key and session persistence
export {
  openKeyStore,
  saveDeviceKeys,
  loadDeviceKeys,
  loadDeviceKeysById,
  clearKeyStore,
} from "./store.ts";

export type { DeviceKeys } from "./store.ts";
