import { useState, useRef, useCallback } from "react";
import { ContentWithPreviews } from "../components/common/ContentWithPreviews";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Lock,
  Unlock,
  Pin,
  PinOff,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { ActorBadge, ContentEndMarker } from "../components/common";
import { CommentThread } from "../components/agora/CommentThread";
import {
  useClubThread,
  useAddClubComment,
  useUpdateClubThread,
  useDeleteClubThread,
  useDeleteClubComment,
  useVoteClubThread,
  useVoteClubComment,
  useCurrentUser,
} from "../hooks/useApi";
import { ThreadVoteButtons } from "../components/agora/ThreadVoteButtons";
import { formatRelativeTime } from "../lib/formatTime";
import { transformAuthor, transformComment } from "../utils/transforms";

type CommentSort = "best" | "new" | "old" | "controversial";

export function ClubThreadPage() {
  const { t } = useTranslation(["clubs", "agora", "common"]);
  const navigate = useNavigate();
  const { clubId, threadId } = useParams<{
    clubId: string;
    threadId: string;
  }>();
  const [sort, setSort] = useState<CommentSort>("best");
  const [showSortMenu, setShowSortMenu] = useState(false);

  const sortOptions: { value: CommentSort; label: string }[] = [
    { value: "best", label: t("agora:commentSort.best") },
    { value: "new", label: t("agora:commentSort.new") },
    { value: "old", label: t("agora:commentSort.old") },
    { value: "controversial", label: t("agora:commentSort.controversial") },
  ];

  const {
    data: thread,
    isLoading,
    error,
  } = useClubThread(clubId || "", threadId || "");
  const { data: currentUser } = useCurrentUser();
  const addCommentMutation = useAddClubComment(clubId || "", threadId || "");
  const updateThreadMutation = useUpdateClubThread(
    clubId || "",
    threadId || "",
  );
  const deleteThreadMutation = useDeleteClubThread(clubId || "");
  const deleteCommentMutation = useDeleteClubComment(
    clubId || "",
    threadId || "",
  );
  const voteThreadMutation = useVoteClubThread(clubId || "");
  const voteCommentMutation = useVoteClubComment(clubId || "", threadId || "");

  const [commentContent, setCommentContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDeleteThread, setConfirmDeleteThread] = useState(false);
  const [confirmDeleteComment, setConfirmDeleteComment] = useState<
    string | null
  >(null);
  const [showModMenu, setShowModMenu] = useState(false);

  // Scroll textarea into view when focused (for mobile keyboard)
  const handleCommentFocus = useCallback(() => {
    setTimeout(() => {
      commentInputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 300);
  }, []);

  const handleSubmitComment = async () => {
    if (!commentContent.trim() || !threadId || !clubId) return;

    setIsSubmitting(true);
    try {
      await addCommentMutation.mutateAsync({ content: commentContent });
      setCommentContent("");
    } catch (err) {
      console.error("Failed to post comment:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (commentId: string, value: number) => {
    if (!clubId || !threadId) return;
    voteCommentMutation.mutate({ commentId, value });
  };

  const handleReply = async (parentId: string, content: string) => {
    try {
      await addCommentMutation.mutateAsync({ content, parentId });
    } catch (err) {
      console.error("Failed to reply:", err);
    }
  };

  const handleToggleLock = async () => {
    if (!thread) return;
    try {
      await updateThreadMutation.mutateAsync({ isLocked: !thread.isLocked });
    } catch (err) {
      console.error("Failed to toggle lock:", err);
    }
  };

  const handleTogglePin = async () => {
    if (!thread) return;
    try {
      await updateThreadMutation.mutateAsync({ isPinned: !thread.isPinned });
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const handleDeleteThread = async () => {
    if (!threadId) return;
    try {
      await deleteThreadMutation.mutateAsync(threadId);
      navigate(`/clubs/${clubId}`);
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteCommentMutation.mutateAsync(commentId);
      setConfirmDeleteComment(null);
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !thread) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {t("clubs:threadNotFound")}
          </p>
          <Link
            to={`/clubs/${clubId}`}
            className="text-blue-600 hover:underline mt-2 inline-block"
          >
            {t("clubs:backToClub")}
          </Link>
        </div>
      </Layout>
    );
  }

  const author = transformAuthor(thread.author);
  const comments = thread.comments?.map(transformComment) || [];
  const memberRole = thread.memberRole;
  const isModOrAdmin = memberRole === "admin" || memberRole === "moderator";
  const isThreadAuthor =
    currentUser?.id === (thread.authorId ?? thread.author.id);

  return (
    <Layout>
      {thread && (
        <SEOHead
          title={thread.title}
          description={thread.content
            .substring(0, 160)
            .replace(/[#*_~`>\n]+/g, " ")
            .trim()}
          path={`/clubs/${clubId}/thread/${threadId}`}
          type="article"
          noIndex
        />
      )}
      {/* Back navigation */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("clubs:backToClub")}
        </button>
      </div>

      {/* Thread post — unified card with votes on left */}
      <div className="px-4 pt-3">
        <div className="bg-white dark:bg-gray-900 rounded-t-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="flex">
            {/* Left: vote column */}
            <div className="flex-shrink-0 py-3 pl-2 flex items-start justify-center">
              <ThreadVoteButtons
                threadId={threadId || ""}
                score={thread.score || 0}
                userVote={thread.userVote || 0}
                onVote={(value) =>
                  threadId && voteThreadMutation.mutate({ threadId, value })
                }
                isLoading={voteThreadMutation.isPending}
                size="sm"
              />
            </div>

            {/* Right: content */}
            <div className="flex-1 min-w-0 py-3 pr-4 pl-1">
              {/* Header row */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <ActorBadge user={author} size="sm" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatRelativeTime(thread.createdAt)}
                  </span>
                  {thread.isPinned && (
                    <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />
                  )}
                  {thread.isLocked && (
                    <span className="inline-flex items-center gap-1 text-xs text-red-500 dark:text-red-400 flex-shrink-0">
                      <Lock className="w-3 h-3" />
                    </span>
                  )}
                </div>

                {/* Moderation menu */}
                {(isModOrAdmin || isThreadAuthor) && (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setShowModMenu(!showModMenu)}
                      className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {showModMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowModMenu(false)}
                        />
                        <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 py-1 z-20">
                          {isModOrAdmin && (
                            <>
                              <button
                                onClick={() => {
                                  handleToggleLock();
                                  setShowModMenu(false);
                                }}
                                disabled={updateThreadMutation.isPending}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                              >
                                {thread.isLocked ? (
                                  <Unlock className="w-4 h-4" />
                                ) : (
                                  <Lock className="w-4 h-4" />
                                )}
                                {thread.isLocked
                                  ? t("clubs:moderation.unlockThread")
                                  : t("clubs:moderation.lockThread")}
                              </button>
                              <button
                                onClick={() => {
                                  handleTogglePin();
                                  setShowModMenu(false);
                                }}
                                disabled={updateThreadMutation.isPending}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                              >
                                {thread.isPinned ? (
                                  <PinOff className="w-4 h-4" />
                                ) : (
                                  <Pin className="w-4 h-4" />
                                )}
                                {thread.isPinned
                                  ? t("clubs:moderation.unpinThread")
                                  : t("clubs:moderation.pinThread")}
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              setConfirmDeleteThread(true);
                              setShowModMenu(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="w-4 h-4" />
                            {t("clubs:moderation.deleteThread")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Title */}
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
                {thread.title}
              </h1>

              {/* Content */}
              <div className="mb-1">
                {thread.contentHtml ? (
                  <ContentWithPreviews
                    html={thread.contentHtml}
                    className="prose prose-sm prose-gray dark:prose-invert max-w-none"
                  />
                ) : (
                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {thread.content}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm delete thread dialog */}
      {confirmDeleteThread && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t("clubs:moderation.confirmDelete")}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {thread.title}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteThread(false)}
                className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {t("common:actions.cancel")}
              </button>
              <button
                onClick={handleDeleteThread}
                disabled={deleteThreadMutation.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteThreadMutation.isPending
                  ? "..."
                  : t("clubs:moderation.deleteThread")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete comment dialog */}
      {confirmDeleteComment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t("clubs:moderation.confirmDelete")}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteComment(null)}
                className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                {t("common:actions.cancel")}
              </button>
              <button
                onClick={() => handleDeleteComment(confirmDeleteComment)}
                disabled={deleteCommentMutation.isPending}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteCommentMutation.isPending
                  ? "..."
                  : t("clubs:moderation.deleteComment")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discussion — connected to post card */}
      <div className="px-4 pb-6">
        {/* Comment input */}
        <div className="bg-white dark:bg-gray-900 border-x border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          {thread.isLocked && !isModOrAdmin ? (
            <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 py-1">
              <Lock className="w-4 h-4" />
              <span className="text-sm">
                {t("clubs:moderation.threadLocked")}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <textarea
                ref={commentInputRef}
                value={commentContent}
                onChange={(e) => setCommentContent(e.target.value)}
                onFocus={handleCommentFocus}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (commentContent.trim() && !isSubmitting)
                      handleSubmitComment();
                  }
                }}
                placeholder={t("clubs:thread.writeComment")}
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100 transition-all"
                rows={1}
                style={{ minHeight: "38px", maxHeight: "120px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "38px";
                  target.style.height =
                    Math.min(target.scrollHeight, 120) + "px";
                }}
              />
              {commentContent.trim() && (
                <button
                  onClick={handleSubmitComment}
                  disabled={!commentContent.trim() || isSubmitting}
                  className="flex-shrink-0 bg-purple-700 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-purple-600 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "..." : t("clubs:submitReply")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Comments header + sort */}
        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 border-x border-b border-gray-200 dark:border-gray-800 px-4 py-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("clubs:discussion", { count: comments.length })}
          </span>
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {sortOptions.find((o) => o.value === sort)?.label}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSortMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowSortMenu(false)}
                />
                <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 py-1 z-20">
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSort(option.value);
                        setShowSortMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        sort === option.value
                          ? "text-purple-600 font-medium"
                          : "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Comments list */}
        <div className="bg-white dark:bg-gray-900 border-x border-b border-gray-200 dark:border-gray-800 rounded-b-xl">
          {comments.length > 0 ? (
            <div className="space-y-[5px] bg-gray-100 dark:bg-gray-800/50 rounded-b-xl overflow-hidden">
              {comments
                .filter((c) => !c.parentId)
                .map((comment) => (
                  <div
                    key={comment.id}
                    className="relative group/comment px-4 py-3 bg-white dark:bg-gray-900"
                  >
                    {(isModOrAdmin || comment.authorId === currentUser?.id) && (
                      <button
                        onClick={() => setConfirmDeleteComment(comment.id)}
                        className="absolute top-2 right-2 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover/comment:opacity-100 transition-opacity z-10"
                        title={t("clubs:moderation.deleteComment")}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
                      </button>
                    )}
                    <CommentThread
                      comments={[
                        comment,
                        ...comments.filter((c) => c.parentId === comment.id),
                      ]}
                      onVote={handleVote}
                      onReply={handleReply}
                    />
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400 text-sm">
              <p>{t("clubs:noReplies")}</p>
            </div>
          )}
        </div>

        <ContentEndMarker message={t("clubs:endOfDiscussion")} />
      </div>
    </Layout>
  );
}
