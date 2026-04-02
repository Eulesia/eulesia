/**
 * Permission helpers for content editing and deletion.
 */

interface ContentOwnership {
  authorId: string;
  source?: string | null;
  aiGenerated?: boolean | null;
}

interface UserContext {
  id: string;
  role: "citizen" | "institution" | "admin" | null;
}

/** Check if content was created by the Eulesia bot (minutes import or AI generated) */
export function isBotContent(content: ContentOwnership): boolean {
  return content.source === "minutes_import" || content.aiGenerated === true;
}

/** Check if user can edit this content */
export function canEdit(user: UserContext, content: ContentOwnership): boolean {
  // Authors can edit their own content
  if (content.authorId === user.id) return true;
  // Bot content can be edited by any logged-in user
  if (isBotContent(content)) return true;
  return false;
}

/** Check if user can delete (soft-delete) this content */
export function canDelete(
  user: UserContext,
  content: ContentOwnership,
): boolean {
  // Authors can delete their own content
  if (content.authorId === user.id) return true;
  // Bot content cannot be deleted (only edited)
  return false;
}
