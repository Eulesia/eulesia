/**
 * @module messageEncryptor
 *
 * Matrix-backed E2EE message encryption and decryption.
 *
 * DMs use Olm to-device events and group conversations use Megolm room
 * encryption with Matrix to-device room-key distribution.
 */

import type { ApiClient } from "./apiTypes.ts";
import {
  decryptConversationWithMatrix,
  encryptConversationWithMatrix,
} from "./matrixDm.ts";
import {
  decryptGroupMessageWithMatrix,
  encryptGroupMessageWithMatrix,
} from "./matrixGroup.ts";

export interface EncryptedPayload {
  deviceCiphertexts: Record<string, string>;
}

export async function encryptForConversation(
  conversationId: string,
  targetDevices: Array<{ deviceId: string; userId: string }>,
  plaintext: string,
  api: ApiClient,
): Promise<EncryptedPayload> {
  return encryptConversationWithMatrix(
    conversationId,
    targetDevices,
    plaintext,
    api,
  );
}

export async function decryptConversationMessage(
  conversationId: string,
  _senderDeviceId: string,
  ciphertextB64: string,
  messageId?: string,
): Promise<string> {
  return decryptConversationWithMatrix(
    conversationId,
    ciphertextB64,
    messageId,
  );
}

export async function encryptForGroup(
  conversationId: string,
  plaintext: string,
  currentEpoch: number,
  memberUserIds: string[],
  api: ApiClient,
): Promise<string> {
  return encryptGroupMessageWithMatrix(
    conversationId,
    plaintext,
    currentEpoch,
    memberUserIds,
    api,
  );
}

export async function decryptGroupMessage(
  conversationId: string,
  ciphertextB64: string,
  messageId: string,
  senderUserId: string,
  createdAt: string,
): Promise<string> {
  return decryptGroupMessageWithMatrix({
    conversationId,
    ciphertext: ciphertextB64,
    messageId,
    senderUserId,
    createdAt,
  });
}
