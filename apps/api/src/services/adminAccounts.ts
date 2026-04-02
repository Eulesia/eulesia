import { z } from "zod";

const SOPS_ADMIN_ACCOUNT_MANAGER = "sops_admin";

export const bootstrapAdminAccountSchema = z.object({
  managedKey: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .transform((value) => value.toLowerCase()),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/)
    .transform((value) => value.toLowerCase()),
  email: z
    .string()
    .email()
    .transform((value) => value.toLowerCase())
    .optional()
    .nullable(),
  name: z.string().min(2).max(255),
  password: z.string().min(1),
  reseedPassword: z.boolean().optional().default(false),
});

export type BootstrapAdminAccount = z.infer<typeof bootstrapAdminAccountSchema>;
export interface BootstrapAdminAccountMatch {
  id: string;
  email: string | null;
  username: string;
  managedBy: string | null;
  managedKey: string | null;
}

import { hashPassword } from "../utils/crypto.js";

interface ResolveBootstrapAdminPasswordInput {
  existingPasswordHash?: string | null;
  seedPassword: string;
  reseedPassword?: boolean;
}

interface BootstrapAdminPasswordDecision {
  passwordHash: string;
  revokeSessions: boolean;
}

export async function resolveBootstrapAdminPassword({
  existingPasswordHash,
  seedPassword,
  reseedPassword = false,
}: ResolveBootstrapAdminPasswordInput): Promise<BootstrapAdminPasswordDecision> {
  if (!existingPasswordHash || reseedPassword) {
    return {
      passwordHash: await hashPassword(seedPassword),
      revokeSessions: true,
    };
  }

  return {
    passwordHash: existingPasswordHash,
    revokeSessions: false,
  };
}

export function selectExistingBootstrapAdmin<
  T extends BootstrapAdminAccountMatch,
>(account: BootstrapAdminAccount, candidates: T[]): T | null {
  const managedKeyMatches = candidates.filter(
    (candidate) =>
      candidate.managedBy === SOPS_ADMIN_ACCOUNT_MANAGER &&
      candidate.managedKey === account.managedKey,
  );
  if (managedKeyMatches.length > 1) {
    throw new Error(
      `Multiple managed bootstrap admins already use key ${account.managedKey}`,
    );
  }

  const managedKeyMatch = managedKeyMatches[0];
  const emailMatch = account.email
    ? candidates.find((candidate) => candidate.email === account.email)
    : undefined;
  const usernameMatch = candidates.find(
    (candidate) => candidate.username === account.username,
  );

  if (managedKeyMatch) {
    if (emailMatch && emailMatch.id !== managedKeyMatch.id) {
      throw new Error(
        `Bootstrap admin ${account.username} managed key ${account.managedKey} conflicts with existing email ${account.email}`,
      );
    }

    if (usernameMatch && usernameMatch.id !== managedKeyMatch.id) {
      throw new Error(
        `Bootstrap admin ${account.username} managed key ${account.managedKey} conflicts with existing username ${account.username}`,
      );
    }

    return managedKeyMatch;
  }

  if (emailMatch && usernameMatch && emailMatch.id !== usernameMatch.id) {
    throw new Error(
      `Bootstrap admin ${account.username} matches different existing users by email and username`,
    );
  }

  return emailMatch ?? usernameMatch ?? null;
}

export function parseBootstrapAdminAccounts(
  raw: string,
): BootstrapAdminAccount[] {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(
      "BOOTSTRAP_ADMIN_ACCOUNTS_FILE must contain valid JSON data",
    );
  }

  const accounts = z.array(bootstrapAdminAccountSchema).parse(parsedJson);
  const managedKeys = new Set<string>();
  const usernames = new Set<string>();
  const emails = new Set<string>();

  for (const account of accounts) {
    if (managedKeys.has(account.managedKey)) {
      throw new Error(
        `Duplicate bootstrap admin managed key: ${account.managedKey}`,
      );
    }
    managedKeys.add(account.managedKey);

    if (usernames.has(account.username)) {
      throw new Error(
        `Duplicate bootstrap admin username: ${account.username}`,
      );
    }
    usernames.add(account.username);

    if (account.email) {
      if (emails.has(account.email)) {
        throw new Error(`Duplicate bootstrap admin email: ${account.email}`);
      }
      emails.add(account.email);
    }
  }

  return accounts;
}
