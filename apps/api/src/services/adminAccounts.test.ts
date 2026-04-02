import { describe, expect, it } from "vitest";
import {
  parseBootstrapAdminAccounts,
  resolveBootstrapAdminPassword,
  selectExistingBootstrapAdmin,
} from "./adminAccounts.js";

describe("parseBootstrapAdminAccounts", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseBootstrapAdminAccounts("not json")).toThrow(
      "must contain valid JSON data",
    );
  });

  it("throws on schema validation failure", () => {
    expect(() =>
      parseBootstrapAdminAccounts(
        JSON.stringify([
          {
            managedKey: "ok",
            username: "ab", // too short (min 3)
            name: "Test",
            password: "test-password",
          },
        ]),
      ),
    ).toThrow();
  });

  it("normalizes usernames and emails", () => {
    const accounts = parseBootstrapAdminAccounts(
      JSON.stringify([
        {
          managedKey: "Ops_Julius",
          username: "Ops_Julius",
          email: "Ops+Julius@Eulesia.org",
          name: "Julius Ops",
          password: "test-password",
        },
      ]),
    );

    expect(accounts).toEqual([
      {
        managedKey: "ops_julius",
        username: "ops_julius",
        email: "ops+julius@eulesia.org",
        name: "Julius Ops",
        password: "test-password",
        reseedPassword: false,
      },
    ]);
  });

  it("rejects duplicate usernames", () => {
    expect(() =>
      parseBootstrapAdminAccounts(
        JSON.stringify([
          {
            managedKey: "ops_one",
            username: "ops_admin",
            name: "One",
            password: "password-one",
          },
          {
            managedKey: "ops_two",
            username: "OPS_ADMIN",
            name: "Two",
            password: "password-two",
          },
        ]),
      ),
    ).toThrow("Duplicate bootstrap admin username");
  });

  it("rejects duplicate emails", () => {
    expect(() =>
      parseBootstrapAdminAccounts(
        JSON.stringify([
          {
            managedKey: "ops_one",
            username: "ops_one",
            email: "ops@example.org",
            name: "One",
            password: "password-one",
          },
          {
            managedKey: "ops_two",
            username: "ops_two",
            email: "OPS@example.org",
            name: "Two",
            password: "password-two",
          },
        ]),
      ),
    ).toThrow("Duplicate bootstrap admin email");
  });

  it("rejects duplicate managed keys", () => {
    expect(() =>
      parseBootstrapAdminAccounts(
        JSON.stringify([
          {
            managedKey: "ops_julius",
            username: "ops_one",
            name: "One",
            password: "password-one",
          },
          {
            managedKey: "OPS_JULIUS",
            username: "ops_two",
            name: "Two",
            password: "password-two",
          },
        ]),
      ),
    ).toThrow("Duplicate bootstrap admin managed key");
  });
});

describe("resolveBootstrapAdminPassword", () => {
  it("preserves an existing password hash by default", async () => {
    const result = await resolveBootstrapAdminPassword({
      existingPasswordHash: "$argon2id$current",
      seedPassword: "seed-password",
    });
    expect(result.passwordHash).toBe("$argon2id$current");
    expect(result.revokeSessions).toBe(false);
  });

  it("hashes and seeds a missing password", async () => {
    const result = await resolveBootstrapAdminPassword({
      existingPasswordHash: "",
      seedPassword: "seed-password",
    });
    expect(result.passwordHash).toMatch(/^\$argon2/);
    expect(result.revokeSessions).toBe(true);
  });

  it("reseeds when explicitly requested", async () => {
    const result = await resolveBootstrapAdminPassword({
      existingPasswordHash: "$argon2id$current",
      seedPassword: "seed-password",
      reseedPassword: true,
    });
    expect(result.passwordHash).toMatch(/^\$argon2/);
    expect(result.passwordHash).not.toBe("$argon2id$current");
    expect(result.revokeSessions).toBe(true);
  });
});

describe("selectExistingBootstrapAdmin", () => {
  it("matches a managed account by stable managed key after a rename", () => {
    const existing = selectExistingBootstrapAdmin(
      {
        managedKey: "ops_julius",
        username: "juliuskoskela",
        email: "julius.koskela@digimuoto.com",
        name: "Julius Koskela",
        password: "seed-password",
        reseedPassword: false,
      },
      [
        {
          id: "user-1",
          username: "legacy-admin",
          email: "legacy@example.org",
          managedBy: "sops_admin",
          managedKey: "ops_julius",
        },
      ],
    );

    expect(existing?.id).toBe("user-1");
  });

  it("falls back to legacy username or email matching before managed keys are backfilled", () => {
    const existing = selectExistingBootstrapAdmin(
      {
        managedKey: "ops_julius",
        username: "juliuskoskela",
        email: "julius.koskela@digimuoto.com",
        name: "Julius Koskela",
        password: "seed-password",
        reseedPassword: false,
      },
      [
        {
          id: "user-1",
          username: "juliuskoskela",
          email: "julius.koskela@digimuoto.com",
          managedBy: "sops_admin",
          managedKey: null,
        },
      ],
    );

    expect(existing?.id).toBe("user-1");
  });

  it("falls back to email match when username does not match", () => {
    const existing = selectExistingBootstrapAdmin(
      {
        managedKey: "ops_julius",
        username: "juliuskoskela",
        email: "julius.koskela@digimuoto.com",
        name: "Julius Koskela",
        password: "seed-password",
        reseedPassword: false,
      },
      [
        {
          id: "user-1",
          username: "different_name",
          email: "julius.koskela@digimuoto.com",
          managedBy: "sops_admin",
          managedKey: null,
        },
      ],
    );

    expect(existing?.id).toBe("user-1");
  });

  it("returns null when no candidates match", () => {
    const existing = selectExistingBootstrapAdmin(
      {
        managedKey: "ops_julius",
        username: "juliuskoskela",
        email: "julius.koskela@digimuoto.com",
        name: "Julius Koskela",
        password: "seed-password",
        reseedPassword: false,
      },
      [
        {
          id: "user-1",
          username: "unrelated",
          email: "unrelated@example.org",
          managedBy: null,
          managedKey: null,
        },
      ],
    );

    expect(existing).toBeNull();
  });

  it("rejects a renamed managed account if the new username belongs to another row", () => {
    expect(() =>
      selectExistingBootstrapAdmin(
        {
          managedKey: "ops_julius",
          username: "juliuskoskela",
          email: "julius.koskela@digimuoto.com",
          name: "Julius Koskela",
          password: "seed-password",
          reseedPassword: false,
        },
        [
          {
            id: "managed-user",
            username: "legacy-admin",
            email: "legacy@example.org",
            managedBy: "sops_admin",
            managedKey: "ops_julius",
          },
          {
            id: "other-user",
            username: "juliuskoskela",
            email: "other@example.org",
            managedBy: null,
            managedKey: null,
          },
        ],
      ),
    ).toThrow("conflicts with existing username");
  });
});
