# Group E2EE: Sender Keys Protocol

> Historical design note: this document describes the retired bespoke
> sender-key implementation. The active runtime now uses Matrix Megolm with
> hidden `to_device` room-key distribution.
>
> Architecture document for end-to-end encrypted group messaging in Eulesia.
> Private group chats are capped at 50 members. For larger groups (clubs),
> a separate MLS-based protocol will be designed later.

## Problem

The initial group encryption derived AES keys from `conversationId + epoch`,
both of which are known to the server. This means the server can reconstruct
every group message key and decrypt all traffic. This is **not** end-to-end
encryption.

## Solution: Sender Keys

We adopt Signal's Sender Keys approach, adapted for Eulesia's existing
infrastructure.

### Core Idea

Each group member maintains their own **sender key** — a symmetric key used
to encrypt messages they send. The sender key is distributed to all other
members' devices via the existing X3DH pairwise sessions (the same mechanism
used for DM encryption). The server never sees sender keys in plaintext.

### Key Properties

| Property                 | Guarantee                                                                      |
| ------------------------ | ------------------------------------------------------------------------------ |
| Confidentiality          | Server cannot decrypt group messages                                           |
| Forward secrecy          | HMAC-SHA256 chain ratchet derives per-message keys; old chain keys are deleted |
| Post-compromise recovery | Sender keys rotate on every membership change (epoch bump)                     |
| Sender authentication    | Each sender key includes an HMAC signing key; recipients verify message origin |

## Protocol Details

### Sender Key State

Each member holds, per group conversation:

```
SenderKeyState {
  conversationId: string
  userId: string           // owner of this sender key
  epoch: number            // epoch when this key was created
  chainKey: bytes[32]      // HMAC-SHA256 chain key — ratchets forward
  messageIndex: number     // monotonic counter
}
```

Stored in IndexedDB object store `senderKeys` with compound key
`[conversationId, userId]`.

### Sender Key Generation

When a member needs a new sender key (first message, or epoch rotation):

```
chainKey = crypto.getRandomValues(32)   // 256-bit random
messageIndex = 0
```

### Chain Ratchet (per-message key derivation)

For each message sent:

```
messageKey  = HMAC-SHA256(chainKey, 0x01)   // derive message encryption key
nextChain   = HMAC-SHA256(chainKey, 0x02)   // ratchet chain forward
chainKey    = nextChain                      // old chainKey is discarded
messageIndex += 1
```

The message key is used as AES-256-GCM input keying material via HKDF:

```
aesKey = HKDF-SHA256(
  ikm:  messageKey,
  salt: "eulesia-group-msg",
  info: empty
)
```

Each message gets a unique key because the chain ratchet produces a fresh
`messageKey` for every index. The HKDF step converts HMAC output into
an AES-256-GCM `CryptoKey`; domain separation comes from the salt and the
per-message chain derivation, not from the info parameter.

### Sender Key Distribution (SKD)

When a member generates a new sender key, they must distribute it to every
active group device, including their own devices. This keeps the sender's
history readable on the current device and synchronizes sender-key state
across the sender's other devices. This uses the existing per-device encryption
infrastructure:

1. Member generates new `SenderKeyState`
2. Serializes it as JSON: `{ chainKey, epoch, messageIndex }`
3. For each target device, encrypts via existing X3DH pairwise session
   (same as DM encryption — `ensureSession` + `deriveMessageKey` + AES-GCM)
4. Sends as a message with `message_type: "skd"` and `device_ciphertexts`
5. Server routes through `message_device_queue` like a DM

Recipients decrypt the SKD message using their pairwise session, then store
the sender key in their local `senderKeys` store.

### Message Encryption (Group Send)

```
1. Load local SenderKeyState for (conversationId, myUserId)
2. If none exists or epoch is stale → generate + distribute new sender key
3. Derive messageKey from chain ratchet
4. Encrypt plaintext with AES-256-GCM using derived AES key
5. Build envelope: { ct, nonce, epoch, messageIndex, senderId }
6. Base64url-encode envelope → single ciphertext string
7. Send via POST /conversations/{id}/messages with message_type: "text"
   and ciphertext field (single blob, not per-device)
8. Save ratcheted chainKey + incremented messageIndex
```

### Message Decryption (Group Receive)

```
1. Parse envelope → extract senderId, epoch, messageIndex
2. Load SenderKeyState for (conversationId, senderId)
3. If no key found → buffer message, request SKD from sender (or wait)
4. Fast-forward chain: ratchet from stored messageIndex to received messageIndex
5. Derive messageKey at the target index
6. Decrypt with AES-256-GCM
7. Save ratcheted state
```

### Epoch Rotation (Membership Change)

When a member is added or removed, the server bumps the epoch. All remaining
members must rotate their sender keys:

```
1. Server bumps epoch (already implemented)
2. Server broadcasts epoch change via WebSocket
3. Each remaining member:
   a. Generates new SenderKeyState with new epoch
   b. Distributes to all other members' devices via SKD
   c. Discards old sender key
4. Messages with the old epoch are accepted during a grace window
   (epoch - 1) to handle in-flight messages
```

**Member removal:** The removed member's sender key is discarded by all
remaining members. Since they don't receive the new sender keys, they
cannot decrypt future messages.

**Member addition:** The new member receives sender keys from all existing
members via SKD. They can only decrypt messages from their `joined_epoch`
onwards.

## Wire Format

### SKD Message (via device_ciphertexts)

Each per-device ciphertext decrypts to:

```json
{
  "type": "skd",
  "conversationId": "uuid",
  "senderId": "uuid",
  "epoch": 3,
  "chainKey": "base64url-encoded-32-bytes",
  "messageIndex": 0
}
```

### Group Message Envelope (via ciphertext)

```json
{
  "ct": "base64url-aes-gcm-ciphertext",
  "nonce": "base64url-12-bytes",
  "epoch": 3,
  "messageIndex": 42,
  "senderId": "uuid"
}
```

## Backend Changes

1. **New `MessageType` variant:** `SenderKeyDistribution` (serialized as `"skd"`)
2. **Send handler:** When `message_type == "skd"` in a group conversation,
   accept `device_ciphertexts` (per-device delivery) instead of single
   `ciphertext`. This is the only case where a group message uses per-device
   delivery.
3. **No new endpoints** — SKD messages flow through existing
   `POST /conversations/{id}/messages`

## Frontend Changes

1. **New crypto module:** `senderKeys.ts` — generation, ratchet, derivation
2. **IndexedDB:** New `senderKeys` object store (DB_VERSION bump 1 → 2)
3. **E2EE module:** Replace metadata-derived group key with sender-key-based
   encrypt/decrypt
4. **Hooks:** `useSendGroupMessage` distributes sender key before first
   message and on epoch rotation
5. **UI:** SKD messages are hidden from chat; decryption failure shows
   "waiting for sender key" instead of generic error

## Security Considerations

- **50-member cap** limits the SKD fanout to at most 50 × N_devices messages
- **Chain ratchet** provides forward secrecy within an epoch
- **Epoch rotation** provides post-compromise security on membership changes
- **Pairwise session encryption** for SKD ensures the server never sees
  sender key material
- **Future:** MLS (RFC 9420) for large groups (clubs) where O(n) SKD
  fanout becomes expensive

## Limitations

- **No backward secrecy within an epoch:** If a sender key is compromised
  mid-epoch, all messages in that epoch from that sender can be decrypted.
  Mitigation: epoch rotation on any security-relevant event.
- **Late joiners** cannot decrypt messages from before their `joined_epoch`.
  This is by design.
- **Offline members** receive SKD messages when they come back online via
  the message device queue. Until then, they cannot decrypt new-epoch messages.
