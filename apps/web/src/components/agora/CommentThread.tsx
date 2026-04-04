import { useState, useRef } from "react";
import { ContentWithPreviews } from "../common/ContentWithPreviews";
import {
  ChevronUp,
  ChevronDown,
  MessageSquare,
  Minus,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActorBadge } from "../common/ActorBadge";
import { EditedIndicator } from "../common/EditedIndicator";
import { ConfirmDeleteDialog } from "../common/ConfirmDeleteDialog";
import { formatRelativeTime } from "../../lib/formatTime";
import type { UserRole } from "../../types";

interface CommentAuthor {
  id: string | null;
  name: string;
  role: UserRole;
  verified: boolean;
  avatarInitials: string;
  institutionType?: "municipality" | "agency" | "ministry";
  institutionName?: string;
}

interface CommentWithAuthor {
  id: string;
  threadId?: string;
  authorId: string;
  parentId?: string | null;
  content: string;
  contentHtml?: string;
  score?: number;
  depth?: number;
  userVote?: number;
  editedAt?: string | null;
  editedBy?: string | null;
  isHidden?: boolean;
  createdAt: string;
  author: CommentAuthor | null;
}

interface CommentItemProps {
  comment: CommentWithAuthor;
  replies: CommentWithAuthor[];
  allComments: CommentWithAuthor[];
  depth: number;
  onVote: (commentId: string, value: number) => void;
  onReply: (commentId: string) => void;
  replyingTo: string | null;
  onSubmitReply: (parentId: string, content: string) => void;
  onCancelReply: () => void;
  onEdit?: (commentId: string, content: string) => void;
  onDelete?: (commentId: string) => void;
  currentUserId?: string;
  currentUserRole?: string;
}

function CommentItem({
  comment,
  replies: _replies,
  allComments,
  depth,
  onVote,
  onReply,
  replyingTo,
  onSubmitReply,
  onCancelReply,
  onEdit,
  onDelete,
  currentUserId,
  currentUserRole,
}: CommentItemProps) {
  const { t } = useTranslation(["agora", "common"]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const author = comment.author;
  const maxVisualDepth = 6;

  // Get replies to this comment
  const childReplies = allComments.filter((c) => c.parentId === comment.id);

  // Deleted comment placeholder — show stub but keep child replies visible
  if (comment.isHidden || !author) {
    return (
      <div className={depth > 0 ? "relative" : ""}>
        {depth > 0 && depth <= maxVisualDepth && (
          <div
            className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700"
            style={{ marginLeft: -12 }}
          />
        )}
        <div className="py-2 px-3">
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">
            {t("common:messageDeleted")}
          </p>
        </div>
        {childReplies.length > 0 && (
          <div
            className={`mt-2 ${depth < maxVisualDepth ? "ml-6 pl-3" : "ml-2"}`}
          >
            {childReplies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                replies={[]}
                allComments={allComments}
                depth={depth + 1}
                onVote={onVote}
                onReply={onReply}
                replyingTo={replyingTo}
                onSubmitReply={onSubmitReply}
                onCancelReply={onCancelReply}
                onEdit={onEdit}
                onDelete={onDelete}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isInstitution = author.role === "institution";
  const score = comment.score || 0;
  const userVote = comment.userVote || 0;

  // Permission checks
  const isModerator = currentUserRole === "moderator";
  const isAuthor = currentUserId === comment.authorId;
  const canEditComment = isModerator || isAuthor;
  const canDeleteComment = isModerator || isAuthor;

  const handleStartEdit = () => {
    setEditContent(comment.content);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && onEdit) {
      onEdit(comment.id, editContent.trim());
      setIsEditing(false);
    }
  };

  const handleConfirmDelete = () => {
    if (onDelete) {
      onDelete(comment.id);
    }
    setShowDeleteConfirm(false);
  };

  const handleSubmitReply = () => {
    if (replyContent.trim()) {
      onSubmitReply(comment.id, replyContent);
      setReplyContent("");
    }
  };

  return (
    <div className={depth > 0 ? "relative" : ""}>
      {/* Vertical line for nesting */}
      {depth > 0 && depth <= maxVisualDepth && (
        <div
          role="button"
          tabIndex={0}
          aria-label={
            isCollapsed
              ? t("common:actions.expand")
              : t("common:actions.collapse")
          }
          className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 cursor-pointer"
          style={{ marginLeft: -12 }}
          onClick={() => setIsCollapsed(!isCollapsed)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsCollapsed(!isCollapsed);
            }
          }}
        />
      )}

      <div className={`${isCollapsed ? "opacity-60" : ""}`}>
        {/* Vote column + content */}
        <div className="flex gap-2">
          {/* Vote buttons */}
          <div className="flex flex-col items-center gap-0.5 pt-1">
            <button
              onClick={() => onVote(comment.id, userVote === 1 ? 0 : 1)}
              className={`p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                userVote === 1
                  ? "text-orange-500"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
              aria-label={t("common:actions.upvote")}
              aria-pressed={userVote === 1}
            >
              <ChevronUp className="w-5 h-5" />
            </button>
            <span
              className={`text-xs font-medium min-w-[20px] text-center ${
                score > 0
                  ? "text-orange-600"
                  : score < 0
                    ? "text-blue-600"
                    : "text-gray-500 dark:text-gray-400"
              }`}
              aria-label={`${score} ${t("common:actions.points")}`}
            >
              {score}
            </span>
            <button
              onClick={() => onVote(comment.id, userVote === -1 ? 0 : -1)}
              className={`p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                userVote === -1
                  ? "text-blue-500"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
              aria-label={t("common:actions.downvote")}
              aria-pressed={userVote === -1}
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>

          {/* Comment content */}
          <div className="flex-1 min-w-0">
            {/* Collapsed state */}
            {isCollapsed ? (
              <div
                role="button"
                tabIndex={0}
                className="flex items-center gap-2 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                onClick={() => setIsCollapsed(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsCollapsed(false);
                  }
                }}
                aria-label={t("common:actions.expand")}
              >
                <Plus className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {author.name} •{" "}
                  {t("common:comments", { count: childReplies.length + 1 })}
                </span>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setIsCollapsed(true)}
                    className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    title={t("common:actions.collapse")}
                    aria-label={t("common:actions.collapse")}
                  >
                    <Minus className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                  </button>
                  <ActorBadge user={author} size="sm" />
                  <span className="text-gray-400 dark:text-gray-500">•</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                  {comment.editedAt && (
                    <EditedIndicator editedAt={comment.editedAt} />
                  )}
                </div>

                {/* Content */}
                <div
                  className={`mt-1 rounded-lg ${
                    isInstitution
                      ? "bg-violet-50 dark:bg-violet-900/20 p-3 border border-violet-100 dark:border-violet-800"
                      : ""
                  }`}
                >
                  {isEditing ? (
                    <div>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={4}
                        autoFocus
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={!editContent.trim()}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t("common:actions.save")}
                        </button>
                        <button
                          onClick={() => setIsEditing(false)}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                        >
                          {t("common:actions.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : comment.contentHtml ? (
                    <ContentWithPreviews
                      html={comment.contentHtml}
                      className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed prose prose-sm max-w-none"
                    />
                  ) : (
                    <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {comment.content}
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!isEditing && (
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      onClick={() => onReply(comment.id)}
                      className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1 rounded transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {t("common:actions.reply")}
                    </button>
                    {canEditComment && (
                      <button
                        onClick={handleStartEdit}
                        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1 rounded transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        {t("common:actions.edit")}
                      </button>
                    )}
                    {canDeleteComment && (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 py-1 rounded transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        {t("common:actions.delete")}
                      </button>
                    )}
                  </div>
                )}

                {/* Delete confirmation */}
                <ConfirmDeleteDialog
                  open={showDeleteConfirm}
                  type="comment"
                  onConfirm={handleConfirmDelete}
                  onClose={() => setShowDeleteConfirm(false)}
                />

                {/* Reply form */}
                {replyingTo === comment.id && (
                  <div className="mt-3 ml-2 pl-3 border-l-2 border-blue-200">
                    <textarea
                      ref={replyTextareaRef}
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      onFocus={() => {
                        setTimeout(() => {
                          replyTextareaRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }, 300);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (replyContent.trim()) handleSubmitReply();
                        }
                      }}
                      placeholder={t("writeReply")}
                      className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleSubmitReply}
                        disabled={!replyContent.trim()}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t("common:actions.reply")}
                      </button>
                      <button
                        onClick={onCancelReply}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                      >
                        {t("common:actions.cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Nested replies */}
        {!isCollapsed && childReplies.length > 0 && (
          <div
            className={`mt-2 ${depth < maxVisualDepth ? "ml-6 pl-3" : "ml-2"}`}
          >
            {childReplies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                replies={[]}
                allComments={allComments}
                depth={depth + 1}
                onVote={onVote}
                onReply={onReply}
                replyingTo={replyingTo}
                onSubmitReply={onSubmitReply}
                onCancelReply={onCancelReply}
                onEdit={onEdit}
                onDelete={onDelete}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CommentThreadProps {
  comments: CommentWithAuthor[];
  onVote?: (commentId: string, value: number) => void;
  onReply?: (parentId: string, content: string) => void;
  onEdit?: (commentId: string, content: string) => void;
  onDelete?: (commentId: string) => void;
  currentUserId?: string;
  currentUserRole?: string;
}

export function CommentThread({
  comments,
  onVote,
  onReply,
  onEdit,
  onDelete,
  currentUserId,
  currentUserRole,
}: CommentThreadProps) {
  const { t } = useTranslation("agora");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Get top-level comments (no parent)
  const topLevel = comments.filter((c) => !c.parentId);

  const handleVote = (commentId: string, value: number) => {
    if (onVote) {
      onVote(commentId, value);
    }
  };

  const handleReply = (commentId: string) => {
    setReplyingTo(commentId);
  };

  const handleSubmitReply = (parentId: string, content: string) => {
    if (onReply) {
      onReply(parentId, content);
    }
    setReplyingTo(null);
  };

  const handleCancelReply = () => {
    setReplyingTo(null);
  };

  if (comments.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>{t("noComments")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {topLevel.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          replies={[]}
          allComments={comments}
          depth={0}
          onVote={handleVote}
          onReply={handleReply}
          replyingTo={replyingTo}
          onSubmitReply={handleSubmitReply}
          onCancelReply={handleCancelReply}
          onEdit={onEdit}
          onDelete={onDelete}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      ))}
    </div>
  );
}
