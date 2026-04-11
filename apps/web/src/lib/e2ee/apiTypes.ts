/**
 * @module apiTypes
 *
 * Minimal interface for the API client methods used by the E2EE module.
 * This avoids a direct dependency on the full ApiClient class and prevents
 * circular imports.
 */

import type { Device } from "../api.ts";

export interface MatrixSignedKeyPayload {
  key: string;
  signatures: Record<string, Record<string, string>>;
}

export interface MatrixDeviceKeysPayload {
  user_id: string;
  device_id: string;
  keys: Record<string, string>;
  signatures: Record<string, Record<string, string>>;
}

export interface MatrixKeysUploadPayload {
  device_keys?: MatrixDeviceKeysPayload;
  one_time_keys?: Record<string, MatrixSignedKeyPayload>;
  fallback_keys?: Record<string, MatrixSignedKeyPayload>;
}

export interface MatrixKeysUploadResponse {
  one_time_key_counts: Record<string, number>;
}

export interface MatrixKeysQueryPayload {
  device_keys: Record<string, string[]>;
  timeout?: number;
  token?: string;
}

export interface MatrixKeysQueryResponse {
  device_keys: Record<string, Record<string, unknown>>;
  master_keys: Record<string, unknown>;
  self_signing_keys: Record<string, unknown>;
  failures: Record<string, unknown>;
}

export interface MatrixKeysClaimPayload {
  one_time_keys: Record<string, Record<string, string>>;
  timeout?: number;
}

export interface MatrixKeysClaimResponse {
  one_time_keys: Record<string, Record<string, Record<string, unknown>>>;
  failures: Record<string, unknown>;
}

export interface ApiClient {
  registerDevice(data: {
    displayName: string;
    platform: string;
    pairingCode?: string;
  }): Promise<Device>;

  listDevices(): Promise<Device[]>;

  bindCurrentSessionToDevice(deviceId: string): Promise<void>;

  revokeDevice(deviceId: string): Promise<void>;

  getUserDevices(userId: string): Promise<Device[]>;

  uploadMatrixKeys(
    deviceId: string,
    data: MatrixKeysUploadPayload,
  ): Promise<MatrixKeysUploadResponse>;

  queryMatrixKeys(
    data: MatrixKeysQueryPayload,
  ): Promise<MatrixKeysQueryResponse>;

  claimMatrixKeys(
    data: MatrixKeysClaimPayload,
  ): Promise<MatrixKeysClaimResponse>;

  sendGroupToDevice(
    conversationId: string,
    data: {
      deviceCiphertexts: Record<string, string>;
      senderDeviceId: string;
    },
  ): Promise<void>;
}
