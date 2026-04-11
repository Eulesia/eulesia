/**
 * @module e2ee
 *
 * Eulesia end-to-end encryption device management and message encryption.
 *
 * Re-exports all public APIs from the individual modules:
 *
 * - **deviceManager** — Device registration, key generation, and lifecycle.
 * - **messageEncryptor** — Per-device message encryption and decryption.
 * - **apiTypes** — Minimal API client interface for E2EE operations.
 */

// deviceManager — Device registration and lifecycle
export { initializeDevice, inspectDeviceSetup } from "./deviceManager.ts";

export type {
  DeviceRegistration,
  DeviceSetupRequirement,
} from "./deviceManager.ts";

// messageEncryptor — Message encryption and decryption
export {
  encryptForConversation,
  decryptConversationMessage,
  encryptForGroup,
  decryptGroupMessage,
} from "./messageEncryptor.ts";

export type { EncryptedPayload } from "./messageEncryptor.ts";

// apiTypes — Minimal API client interface
export type { ApiClient } from "./apiTypes.ts";

export {
  asMatrixDeviceId,
  asMatrixRoomId,
  asMatrixUserId,
  closeMatrixCryptoMachine,
  getMatrixCryptoModule,
  getMatrixCryptoMachine,
  initializeMatrixCryptoMachine,
} from "./matrixCrypto.ts";

export {
  decryptMatrixToDeviceEvent,
  ensureMatrixSessions,
  ensureUserKeysKnown,
  getMatrixDevice,
  syncMatrixMachine,
} from "./matrixApiAdapter.ts";

export { processMatrixGroupToDeviceMessages } from "./matrixGroup.ts";
