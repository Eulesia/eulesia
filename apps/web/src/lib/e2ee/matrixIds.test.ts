import { describe, expect, it } from "vitest";
import {
  fromMatrixDeviceId,
  fromMatrixUserId,
  getMatrixStoreName,
  toMatrixDeviceId,
  toMatrixEventId,
  toMatrixRoomId,
  toMatrixUserId,
} from "./matrixIds.ts";

describe("matrixIds", () => {
  it("maps user ids to local Matrix-style ids", () => {
    expect(toMatrixUserId("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "@550e8400-e29b-41d4-a716-446655440000:eulesia.invalid",
    );
    expect(
      fromMatrixUserId("@550e8400-e29b-41d4-a716-446655440000:eulesia.invalid"),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("maps device ids to opaque Matrix device ids", () => {
    expect(toMatrixDeviceId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550E8400E29B41D4A716446655440000",
    );
    expect(fromMatrixDeviceId("550E8400E29B41D4A716446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("maps conversation ids to room ids and stable store names", () => {
    expect(toMatrixRoomId("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "!550e8400-e29b-41d4-a716-446655440000:eulesia.invalid",
    );
    expect(toMatrixEventId("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "$550e8400-e29b-41d4-a716-446655440000:eulesia.invalid",
    );
    expect(
      getMatrixStoreName(
        "550E8400-E29B-41D4-A716-446655440000",
        "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11",
      ),
    ).toBe(
      "eulesia-matrix-crypto:550e8400-e29b-41d4-a716-446655440000:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    );
  });
});
