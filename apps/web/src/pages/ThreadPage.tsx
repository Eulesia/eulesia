import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronDown, Pencil, Trash2, History } from "lucide-react";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import {
  ActorBadge,
  ScopeBadge,
  TagList,
  ContentEndMarker,
  ReportButton,
  ConfirmDeleteDialog,
  EditedIndicator,
  ContentWithPreviews,
  ShareButtons,
  PageSkeleton,
} from "../components/common";
import { InstitutionalContextBox } from "../components/agora/InstitutionalContextBox";
import { CommentThread } from "../components/agora/CommentThread";
import { ThreadVoteButtons } from "../components/agora/ThreadVoteButtons";
import { EditHistoryModal } from "../components/agora/EditHistoryModal";
import {
  useThread,
  useAddComment,
  useVoteComment,
  useVoteThread,
  useEditThread,
  useDeleteThread,
  useEditComment,
  useDeleteComment,
  type CommentSort,
} from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import { formatRelativeTime } from "../lib/formatTime";
import { transformAuthor, transformComment } from "../utils/transforms";
import { api } from "../lib/api";

export function ThreadPage() {
  const { t } = useTranslation(["agora", "common"]);
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [sort, setSort] = useState<CommentSort>("best");
  const [showSortMenu, setShowSortMenu] = useState(false);

  const sortOptions: { value: CommentSort; label: string }[] = [
    { value: "best", label: t("commentSort.best") },
    { value: "new", label: t("commentSort.new") },
    { value: "old", label: t("commentSort.old") },
    { value: "controversial", label: t("commentSort.controversial") },
  ];

  const { data: thread, isLoading, error } = useThread(threadId || "", sort);
  const addCommentMutation = useAddComment(threadId || "", sort);
  const voteCommentMutation = useVoteComment(threadId || "", sort);
  const voteThreadMutation = useVoteThread();
  const editThreadMutation = useEditThread(threadId || "", sort);
  const deleteThreadMutation = useDeleteThread();
  const editCommentMutation = useEditComment(threadId || "", sort);
  const deleteCommentMutation = useDeleteComment(threadId || "", sort);

  // Record view once per session
  useEffect(() => {
    if (!threadId) return;
    const viewedKey = `viewed:${threadId}`;
    if (sessionStorage.getItem(viewedKey)) return;
    sessionStorage.setItem(viewedKey, "1");
    api.recordView(threadId).catch(() => {});
  }, [threadId]);

  const [commentContent, setCommentContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll textarea into view when focused (for mobile keyboard)
  const handleCommentFocus = useCallback(() => {
    setTimeout(() => {
      commentInputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 300);
  }, []);

  // Edit/delete state
  const [isEditingThread, setIsEditingThread] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const threadContentRef = useRef<HTMLDivElement>(null);

  // Must be called before any early returns to maintain consistent hook call order
  const contentHtml = useMemo(
    () => thread?.contentHtml ?? null,
    [thread?.contentHtml],
  );

  const handleThreadVote = (value: number) => {
    if (!currentUser || !threadId) return;
    voteThreadMutation.mutate({ threadId, value });
  };

  const handleSubmitComment = async () => {
    if (!commentContent.trim() || !threadId) return;

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
    try {
      await voteCommentMutation.mutateAsync({ commentId, value });
    } catch (err) {
      console.error("Failed to vote:", err);
    }
  };

  // Thread edit/delete
  const isBotThread =
    thread?.source === "minutes_import" || thread?.aiGenerated;
  const isThreadAuthor =
    currentUser?.id === (thread?.authorId ?? thread?.author?.id);
  const isModerator = currentUser?.role === "moderator";
  const canEditThread = isThreadAuthor || isBotThread;
  const canDeleteThread = isThreadAuthor || isModerator;

  const handleStartEditThread = () => {
    if (!thread) return;
    setEditTitle(thread.title);
    setEditContent(thread.content);
    setIsEditingThread(true);
  };

  const handleSaveEditThread = async () => {
    if (!threadId || !editContent.trim()) return;
    try {
      await editThreadMutation.mutateAsync({
        title: editTitle,
        content: editContent,
      });
      setIsEditingThread(false);
      // Auto-scroll to the edited content after closing the edit form
      setTimeout(() => {
        threadContentRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (err) {
      console.error("Failed to edit thread:", err);
    }
  };

  const handleDeleteThread = async () => {
    if (!threadId) return;
    try {
      await deleteThreadMutation.mutateAsync(threadId);
      navigate("/agora");
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  };

  // Comment edit/delete handlers
  const handleEditComment = async (commentId: string, content: string) => {
    try {
      await editCommentMutation.mutateAsync({ commentId, content });
    } catch (err) {
      console.error("Failed to edit comment:", err);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteCommentMutation.mutateAsync(commentId);
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const handleReply = async (parentId: string, content: string) => {
    try {
      await addCommentMutation.mutateAsync({ content, parentId });
    } catch (err) {
      console.error("Failed to reply:", err);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <PageSkeleton />
      </Layout>
    );
  }

  if (error || !thread) {
    return (
      <Layout>
        <div className="p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {t("thread.notFound")}
          </p>
          <Link
            to="/agora"
            className="text-blue-600 hover:underline mt-2 inline-block"
          >
            {t("thread.returnToAgora")}
          </Link>
        </div>
      </Layout>
    );
  }

  const author = transformAuthor(thread.author);
  const isInstitutional = thread.author.role === "institution";
  const comments = thread.comments?.map(transformComment) || [];

  const threadJsonLd = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: thread.title,
    text: thread.content.substring(0, 200),
    author: { "@type": "Person", name: author.name },
    datePublished: thread.createdAt,
    ...(thread.editedAt && { dateModified: thread.editedAt }),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/CommentAction",
      userInteractionCount: comments.length,
    },
    url: `https://eulesia.org/agora/thread/${threadId}`,
  };

  return (
    <Layout>
      <SEOHead
        title={thread.title}
        description={thread.content
          .substring(0, 160)
          .replace(/[#*_~`>\n]+/g, " ")
          .trim()}
        path={`/agora/thread/${threadId}`}
        type="article"
        jsonLd={threadJsonLd}
      />
      {/* Back navigation */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("thread.backToAgora")}
        </button>
      </div>

      {/* Institutional context box - above the card if applicable */}
      {thread.institutionalContext && (
        <div className="px-4 pt-3">
          <InstitutionalContextBox
            context={thread.institutionalContext}
            isAiGenerated={thread.aiGenerated}
            sourceInstitutionName={thread.sourceInstitutionName}
            sourceInstitutionId={thread.sourceInstitutionId}
            sourceUrl={thread.sourceUrl}
          />
        </div>
      )}

      {/* Thread post — unified card with votes on left */}
      <div className="px-4 pt-3">
        <div
          ref={threadContentRef}
          className={`bg-white dark:bg-gray-900 rounded-t-xl border border-gray-200 dark:border-gray-800 overflow-hidden ${isInstitutional ? "border-l-4 border-l-violet-500" : ""}`}
        >
          <div className="flex">
            {/* Left: vote column */}
            <div className="flex-shrink-0 py-3 pl-2 flex items-start justify-center">
              <ThreadVoteButtons
                threadId={thread.id}
                score={thread.score ?? 0}
                userVote={thread.userVote ?? 0}
                onVote={handleThreadVote}
                isLoading={voteThreadMutation.isPending}
                size="sm"
              />
            </div>

            {/* Right: content */}
            <div className="flex-1 min-w-0 py-3 pr-4 pl-1">
              {/* Header row: author + scope + time + actions */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <ActorBadge user={author} size="sm" />
                  <ScopeBadge
                    scope={thread.scope}
                    municipalityId={thread.municipality?.id}
                    municipalityName={thread.municipality?.name}
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatRelativeTime(thread.createdAt)}
                  </span>
                  {thread.editedAt && (
                    <EditedIndicator
                      editedAt={thread.editedAt}
                      editorName={thread.editorName}
                    />
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {currentUser && canEditThread && (
                    <button
                      onClick={handleStartEditThread}
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title={t("thread.editThread")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {currentUser && canDeleteThread && (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                      title={t("thread.deleteThread")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isBotThread && (
                    <button
                      onClick={() => setShowEditHistory(true)}
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title={t("thread.editHistory")}
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ShareButtons
                    url={`/agora/thread/${threadId}`}
                    title={thread.title}
                    compact
                  />
                  {threadId && (
                    <ReportButton contentType="thread" contentId={threadId} />
                  )}
                </div>
              </div>

              {/* Title */}
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1.5">
                {thread.title}
              </h1>

              {/* Tags */}
              {(thread.tags?.length ?? 0) > 0 && (
                <div className="mb-2">
                  <TagList tags={thread.tags || []} size="md" />
                </div>
              )}

              {/* Content or edit form */}
              <div className="mb-1">
                {isEditingThread ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t("threadForm.title")}
                      </label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t("threadForm.content")}
                      </label>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={10}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setIsEditingThread(false)}
                        className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                      >
                        {t("common:actions.cancel")}
                      </button>
                      <button
                        onClick={handleSaveEditThread}
                        disabled={
                          editThreadMutation.isPending || !editContent.trim()
                        }
                        className="px-4 py-2 text-sm bg-blue-800 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        {editThreadMutation.isPending
                          ? t("common:actions.saving")
                          : t("common:actions.save")}
                      </button>
                    </div>
                  </div>
                ) : contentHtml ? (
                  <ContentWithPreviews
                    html={contentHtml}
                    className="prose prose-sm prose-gray dark:prose-invert max-w-none"
                  />
                ) : (
                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {thread.content}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Discussion — connected to post card */}
      <div className="px-4 pb-6">
        {/* Comment input */}
        <div className="bg-white dark:bg-gray-900 border-x border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          {currentUser ? (
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
                placeholder={t("thread.shareThoughts")}
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100 transition-all"
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
                  className="flex-shrink-0 bg-blue-800 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "..." : t("thread.postReply")}
                </button>
              )}
            </div>
          ) : (
            <div className="text-center py-1">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <a
                  href="/"
                  className="font-medium text-blue-600 hover:text-blue-700 underline"
                >
                  {t("common:actions.loginToVote")}
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Comments header + sort */}
        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 border-x border-b border-gray-200 dark:border-gray-800 px-4 py-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("replies", { count: comments.length })}
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
                          ? "text-blue-600 font-medium"
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
              <div className="px-4 py-3 bg-white dark:bg-gray-900">
                <CommentThread
                  comments={comments}
                  onVote={handleVote}
                  onReply={handleReply}
                  onEdit={handleEditComment}
                  onDelete={handleDeleteComment}
                  currentUserId={currentUser?.id}
                  currentUserRole={currentUser?.role}
                />
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400 text-sm">
              <p>{t("thread.noReplies")}</p>
            </div>
          )}
        </div>

        <ContentEndMarker message={t("thread.endOfDiscussion")} />
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDeleteDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteThread}
        isPending={deleteThreadMutation.isPending}
        type="thread"
      />

      {/* Edit history modal */}
      {threadId && (
        <EditHistoryModal
          threadId={threadId}
          open={showEditHistory}
          onClose={() => setShowEditHistory(false)}
        />
      )}
    </Layout>
  );
}
