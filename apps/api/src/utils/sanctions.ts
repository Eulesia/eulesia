import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, userSanctions } from "../db/index.js";

type BlockingSanction = {
  sanctionType: "warning" | "suspension" | "ban";
  reason: string | null;
  expiresAt: Date | null;
};

export async function getActiveBlockingSanction(
  userId: string,
): Promise<BlockingSanction | null> {
  const [sanction] = await db
    .select({
      sanctionType: userSanctions.sanctionType,
      reason: userSanctions.reason,
      expiresAt: userSanctions.expiresAt,
    })
    .from(userSanctions)
    .where(
      and(
        eq(userSanctions.userId, userId),
        inArray(userSanctions.sanctionType, ["suspension", "ban"]),
        isNull(userSanctions.revokedAt),
        or(
          isNull(userSanctions.expiresAt),
          gt(userSanctions.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);

  return sanction ?? null;
}

export function formatBlockingSanctionResponse(sanction: BlockingSanction): {
  success: false;
  error: string;
  sanctionType: "suspension" | "ban";
  reason: string | null;
  expiresAt: string | null;
} {
  const sanctionType = sanction.sanctionType === "ban" ? "ban" : "suspension";

  return {
    success: false,
    error: sanctionType === "ban" ? "Account banned" : "Account suspended",
    sanctionType,
    reason: sanction.reason,
    expiresAt: sanction.expiresAt?.toISOString() || null,
  };
}
