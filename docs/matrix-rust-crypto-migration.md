# Matrix Rust Crypto Migration

This branch replaced Eulesia's bespoke browser E2EE state with the
Matrix Rust crypto stack exposed through
`@matrix-org/matrix-sdk-crypto-wasm`.

## Why

The removed client-side E2EE implementation owned too much protocol logic:

- custom X3DH/session establishment in `apps/web/src/lib/crypto/session.ts`
- custom pairwise message envelopes in
  `apps/web/src/lib/e2ee/messageEncryptor.ts`
- custom sender-key state and ratcheting in
  `apps/web/src/lib/crypto/senderKeys.ts`
- raw IndexedDB persistence for long-term secrets in
  `apps/web/src/lib/crypto/store.ts`

That is too much unaudited protocol surface area to keep extending.

## Chosen stack

We are standardizing on:

- Rust state machine: `matrix-sdk-crypto`
- Browser binding: `@matrix-org/matrix-sdk-crypto-wasm`
- Underlying Olm/Megolm implementation: `vodozemac`

The important property for Eulesia is that `OlmMachine` is a no-network-IO
state machine. It owns crypto state and produces explicit outgoing requests
which the application must transport and acknowledge.

## What this PR changes

- adds the Matrix WASM dependency to the web client
- initializes an `OlmMachine` for the authenticated local device
- introduces stable ID mapping from Eulesia UUIDs to Matrix-style IDs
- routes DM Olm, hidden to-device protocol traffic, and group Megolm payloads
  through the Matrix Rust state machine
- removes the bespoke browser message/session/sender-key implementation from
  the active frontend crypto surface

Device registration is now metadata-only. Matrix device keys and one-time keys
flow through dedicated Matrix-shaped endpoints after registration.

## Current status on this branch

Implemented now:

- metadata-only `POST /devices` registration for pairing, revocation, and
  stable browser/device identity
- Matrix-shaped `/devices/{id}/matrix/keys/upload`,
  `/devices/matrix/keys/query`, and `/devices/matrix/keys/claim`
  endpoints backed by the existing `devices` table plus Matrix-specific key
  columns
- a browser-side adapter that drains `OlmMachine.outgoingRequests()` through
  those endpoints and acknowledges responses with `markRequestAsSent(...)`
- DM payloads encrypted through Matrix Olm to-device events and carried over
  the existing `device_ciphertexts` transport
- group room-key distribution carried through hidden Matrix to-device payloads
  over the existing per-device queue
- group message bodies encrypted as Megolm room events instead of the bespoke
  sender-key protocol
- removal of the legacy browser pre-key enrollment path and the old
  `device_signed_pre_keys` runtime surface

## ID mapping

The Matrix crypto engine requires Matrix-shaped identifiers even when used
outside a Matrix homeserver.

- user: `@<uuid>:eulesia.invalid`
- device: `<uuid-without-dashes-uppercase>`
- room: `!<conversation-uuid>:eulesia.invalid`

The mapping lives in `apps/web/src/lib/e2ee/matrixIds.ts`.

## Remaining follow-ups

1. Document the Matrix-shaped device key APIs as the canonical E2EE surface in
   the public API docs.
2. Decide whether to promote hidden `to_device` payload delivery into a
   first-class endpoint instead of reusing the existing per-device queue.
3. Remove or archive outdated design docs that still describe the retired
   X3DH/sender-key implementation as active architecture.
