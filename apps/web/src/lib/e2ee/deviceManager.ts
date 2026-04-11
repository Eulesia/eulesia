/**
 * @module deviceManager
 *
 * Device lifecycle management for the Matrix-backed E2EE runtime.
 *
 * On first use, registers the browser as a device and retains only the
 * metadata needed to reconnect the Matrix crypto machine to that device ID.
 * On subsequent uses, verifies the stored device ID against the server.
 */

import {
  loadDeviceKeys,
  saveDeviceKeys,
  clearKeyStore,
} from "../crypto/index.ts";
import type { ApiClient } from "./apiTypes.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceRegistration {
  deviceId: string;
  didCreateDevice: boolean;
}

export type DeviceSetupRequirement =
  | { status: "existing"; deviceId: string }
  | { status: "needs-trust" }
  | { status: "needs-pairing" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect display name from the user agent string. */
function getDisplayName(): string {
  if (typeof navigator === "undefined") return "Unknown Device";
  const ua = navigator.userAgent;

  // Try to extract a readable browser name
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";

  return "Web Browser";
}

/** Detect platform from user agent. */
function getPlatform(): string {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;

  if (/android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Macintosh|Windows|Linux/.test(ua)) return "desktop";

  return "web";
}

/**
 * Initialize the local browser device registration.
 *
 * 1. Try loading the existing local device metadata from IndexedDB.
 * 2. If none exists, register a new device shell with the server.
 * 3. Persist only the local device metadata needed by the Matrix adapter.
 * 4. Return the device registration info.
 */
export async function initializeDevice(
  api: ApiClient,
  userId: string,
  pairingCode?: string,
): Promise<DeviceRegistration> {
  const reuseExistingDevice = async (
    existingDevice: NonNullable<Awaited<ReturnType<typeof loadDeviceKeys>>>,
  ): Promise<DeviceRegistration> => {
    if (existingDevice.userId !== userId) {
      await saveDeviceKeys({ ...existingDevice, userId });
    }

    await api.bindCurrentSessionToDevice(existingDevice.deviceId);

    return {
      deviceId: existingDevice.deviceId,
      didCreateDevice: false,
    };
  };

  // Step 1: Try loading existing keys — but verify the device still exists
  // on the server (migrations may have truncated the devices table).
  const existing = await loadDeviceKeys();
  if (existing) {
    if (existing.userId && existing.userId !== userId) {
      await clearKeyStore();
    } else {
      try {
        const serverDevices = await api.listDevices();
        const stillExists = serverDevices.some(
          (d) => d.id === existing.deviceId,
        );
        if (stillExists) {
          return reuseExistingDevice(existing);
        }
      } catch {
        // Preserve the local identity until the server authoritatively confirms
        // that the device is missing. Transient startup failures must not force
        // a new device registration once the device has been bound to a user.
        if (existing.userId === userId) {
          return reuseExistingDevice(existing);
        }

        throw new Error("Unable to verify the existing device identity");
      }

      // The server confirmed that this device no longer exists — clear the
      // stale local identity before registering a replacement.
      await clearKeyStore();
    }
  }

  // Step 2: Register device with server
  const device = await api.registerDevice({
    displayName: getDisplayName(),
    platform: getPlatform(),
    pairingCode,
  });

  // Step 3: Persist to IndexedDB
  await saveDeviceKeys({
    userId,
    deviceId: device.id,
  });

  // Step 4: Return registration info
  return {
    deviceId: device.id,
    didCreateDevice: true,
  };
}

export async function inspectDeviceSetup(
  api: ApiClient,
  userId: string,
): Promise<DeviceSetupRequirement> {
  const existing = await loadDeviceKeys();
  if (existing) {
    if (existing.userId && existing.userId !== userId) {
      await clearKeyStore();
    } else {
      try {
        const serverDevices = await api.listDevices();
        const stillExists = serverDevices.some(
          (device) => device.id === existing.deviceId,
        );
        if (stillExists) {
          if (existing.userId !== userId) {
            await saveDeviceKeys({ ...existing, userId });
          }

          return {
            status: "existing",
            deviceId: existing.deviceId,
          };
        }
      } catch {
        if (existing.userId === userId) {
          return {
            status: "existing",
            deviceId: existing.deviceId,
          };
        }

        throw new Error("Unable to verify the existing device identity");
      }

      await clearKeyStore();
    }
  }

  const serverDevices = await api.listDevices();
  if (serverDevices.length === 0) {
    return { status: "needs-trust" };
  }

  return { status: "needs-pairing" };
}
