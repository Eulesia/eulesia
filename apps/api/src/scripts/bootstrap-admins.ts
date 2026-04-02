import { readFile } from "fs/promises";
import { and, eq, or } from "drizzle-orm";
import { db, sessions, users } from "../db/index.js";
import {
  parseBootstrapAdminAccounts,
  type BootstrapAdminAccount,
  resolveBootstrapAdminPassword,
  selectExistingBootstrapAdmin,
} from "../services/adminAccounts.js";
import { INDEXES, deleteDocument } from "../services/search/meilisearch.js";
import {
  SOPS_ADMIN_ACCOUNT_MANAGER,
  isSopsManagedOperatorAccount,
} from "../utils/operatorAccounts.js";

async function findExistingAccount(account: BootstrapAdminAccount) {
  const matches = await db
    .select()
    .from(users)
    .where(
      account.email
        ? or(
            and(
              eq(users.managedBy, SOPS_ADMIN_ACCOUNT_MANAGER),
              eq(users.managedKey, account.managedKey),
            ),
            eq(users.email, account.email),
            eq(users.username, account.username),
          )
        : or(
            and(
              eq(users.managedBy, SOPS_ADMIN_ACCOUNT_MANAGER),
              eq(users.managedKey, account.managedKey),
            ),
            eq(users.username, account.username),
          ),
    );

  return selectExistingBootstrapAdmin(account, matches);
}

async function hideFromUserSearch(userId: string): Promise<void> {
  try {
    await deleteDocument(INDEXES.USERS, userId);
  } catch (error) {
    console.warn("Failed to remove managed admin from users index:", error);
  }
}

async function upsertBootstrapAdmin(account: BootstrapAdminAccount) {
  const existing = await findExistingAccount(account);
  const baseValues = {
    email: account.email ?? null,
    username: account.username,
    name: account.name,
    role: "admin" as const,
    managedBy: SOPS_ADMIN_ACCOUNT_MANAGER,
    managedKey: account.managedKey,
    institutionType: null,
    institutionName: null,
    municipalityId: null,
    inviteCodesRemaining: 0,
    identityVerified: false,
    identityProvider: "password",
    identityLevel: "basic" as const,
    verifiedName: null,
    rpSubject: null,
    identityIssuer: null,
    identityVerifiedAt: null,
    deletedAt: null,
    updatedAt: new Date(),
  };

  if (!existing) {
    const passwordDecision = await resolveBootstrapAdminPassword({
      seedPassword: account.password,
    });
    const [created] = await db
      .insert(users)
      .values({
        ...baseValues,
        passwordHash: passwordDecision.passwordHash,
      })
      .returning({
        id: users.id,
      });
    await hideFromUserSearch(created.id);
    return "created" as const;
  }

  if (!isSopsManagedOperatorAccount(existing)) {
    throw new Error(
      `Refusing to adopt existing non-managed account ${existing.username}; create a dedicated operator account instead`,
    );
  }

  const passwordDecision = await resolveBootstrapAdminPassword({
    existingPasswordHash: existing.passwordHash,
    seedPassword: account.password,
    reseedPassword: account.reseedPassword,
  });
  const values = {
    ...baseValues,
    passwordHash: passwordDecision.passwordHash,
  };

  await db.transaction(async (tx) => {
    await tx.update(users).set(values).where(eq(users.id, existing.id));

    if (passwordDecision.revokeSessions) {
      await tx.delete(sessions).where(eq(sessions.userId, existing.id));
    }
  });

  await hideFromUserSearch(existing.id);
  return "updated" as const;
}

async function main() {
  const filePath = process.env.BOOTSTRAP_ADMIN_ACCOUNTS_FILE;

  if (!filePath) {
    console.log("BOOTSTRAP_ADMIN_ACCOUNTS_FILE is not configured; skipping.");
    return;
  }

  const raw = await readFile(filePath, "utf8");
  const accounts = parseBootstrapAdminAccounts(raw);

  if (accounts.length === 0) {
    console.log("No bootstrap admin accounts defined; nothing to do.");
    return;
  }

  let created = 0;
  let updated = 0;

  for (const account of accounts) {
    const result = await upsertBootstrapAdmin(account);
    if (result === "created") {
      created += 1;
    } else {
      updated += 1;
    }
  }

  console.log(
    `Bootstrap admin sync complete: ${created} created, ${updated} updated.`,
  );
}

main()
  .catch((error) => {
    console.error("Bootstrap admin sync failed:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
