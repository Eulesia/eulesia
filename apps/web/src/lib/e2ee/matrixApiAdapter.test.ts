import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetMatrixCryptoMachine,
  mockGetMatrixCryptoModule,
  mockAsMatrixUserId,
  mockAsMatrixDeviceId,
} = vi.hoisted(() => ({
  mockGetMatrixCryptoMachine: vi.fn(),
  mockGetMatrixCryptoModule: vi.fn(),
  mockAsMatrixUserId: vi.fn((userId: string) => `@${userId}:eulesia.invalid`),
  mockAsMatrixDeviceId: vi.fn((deviceId: string) => deviceId.toUpperCase()),
}));

vi.mock("./matrixCrypto.ts", () => ({
  getMatrixCryptoMachine: mockGetMatrixCryptoMachine,
  getMatrixCryptoModule: mockGetMatrixCryptoModule,
  asMatrixUserId: mockAsMatrixUserId,
  asMatrixDeviceId: mockAsMatrixDeviceId,
}));

class MockUserId {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

class MockDeviceId {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

describe("ensureMatrixSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recreates Matrix UserId wrappers after updateTrackedUsers invalidates them", async () => {
    const updateTrackedUsers = vi.fn().mockResolvedValue(undefined);
    const getMissingSessions = vi.fn().mockResolvedValue(null);
    const outgoingRequests = vi.fn().mockResolvedValue([]);

    mockGetMatrixCryptoMachine.mockResolvedValue({
      updateTrackedUsers,
      getMissingSessions,
      outgoingRequests,
    });
    mockGetMatrixCryptoModule.mockResolvedValue({
      UserId: MockUserId,
      DeviceId: MockDeviceId,
      KeysUploadRequest: class {},
      KeysQueryRequest: class {},
      KeysClaimRequest: class {},
    });

    const { ensureMatrixSessions } = await import("./matrixApiAdapter.ts");

    await ensureMatrixSessions(
      {
        uploadMatrixKeys: vi.fn(),
        queryMatrixKeys: vi.fn(),
        claimMatrixKeys: vi.fn(),
      } as never,
      "device-1",
      ["user-a", "user-b", "user-a"],
    );

    const trackedUsers = updateTrackedUsers.mock.calls[0][0] as MockUserId[];
    const claimedUsers = getMissingSessions.mock.calls[0][0] as MockUserId[];

    expect(trackedUsers).toHaveLength(2);
    expect(claimedUsers).toHaveLength(2);
    expect(trackedUsers.map((user) => user.value)).toEqual([
      "@user-a:eulesia.invalid",
      "@user-b:eulesia.invalid",
    ]);
    expect(claimedUsers.map((user) => user.value)).toEqual([
      "@user-a:eulesia.invalid",
      "@user-b:eulesia.invalid",
    ]);
    expect(claimedUsers[0]).not.toBe(trackedUsers[0]);
    expect(claimedUsers[1]).not.toBe(trackedUsers[1]);
  });
});
