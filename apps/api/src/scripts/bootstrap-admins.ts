import { readFile } from "fs/promises";
import { and, eq, or } from "drizzle-orm";
import { db, adminAccounts, adminSessions } from "../db/index.js";
import {
  parseBootstrapAdminAccounts,
  type BootstrapAdminAccount,
  resolveBootstrapAdminPassword,
  selectExistingBootstrapAdmin,
} from "../services/adminAccounts.js";

async function findExistingAccount(account: BootstrapAdminAccount) {
  const matches = await db
    .select()
    .from(adminAccounts)
    .where(
      account.email
        ? or(
            and(
              eq(adminAccounts.managedBy, "sops_admin"),
              eq(adminAccounts.managedKey, account.managedKey),
            ),
            eq(adminAccounts.email, account.email),
            eq(adminAccounts.username, account.username),
          )
        : or(
            and(
              eq(adminAccounts.managedBy, "sops_admin"),
              eq(adminAccounts.managedKey, account.managedKey),
            ),
            eq(adminAccounts.username, account.username),
          ),
    );

  return selectExistingBootstrapAdmin(account, matches);
}

async function upsertBootstrapAdmin(account: BootstrapAdminAccount) {
  const existing = await findExistingAccount(account);
  const baseValues = {
    email: account.email ?? null,
    username: account.username,
    name: account.name,
    managedBy: "sops_admin",
    managedKey: account.managedKey,
    updatedAt: new Date(),
  };

  if (!existing) {
    const passwordDecision = await resolveBootstrapAdminPassword({
      seedPassword: account.password,
    });
    await db.insert(adminAccounts).values({
      ...baseValues,
      passwordHash: passwordDecision.passwordHash,
    });
    return "created" as const;
  }

  if (existing.managedBy !== "sops_admin") {
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
    await tx
      .update(adminAccounts)
      .set(values)
      .where(eq(adminAccounts.id, existing.id));

    if (passwordDecision.revokeSessions) {
      await tx
        .delete(adminSessions)
        .where(eq(adminSessions.adminId, existing.id));
    }
  });

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
