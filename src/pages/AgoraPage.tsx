import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import {
  ThreadCard,
  FeedFilters,
  FeedOnboarding,
  InlineThreadForm,
  OnboardingWizard,
} from "../components/agora";
import { ContentEndMarker, ThreadListSkeleton } from "../components/common";
import { MapPin, Building2, Globe, Users, HelpCircle } from "lucide-react";
import {
  useThreads,
  useVoteThread,
  useSubscriptions,
  useCompleteOnboarding,
} from "../hooks/useApi";
import { useAuth } from "../hooks/useAuth";
import type {
  Thread as ApiThread,
  FeedScope,
  SortBy,
  TopPeriod,
  ExploreThread,
} from "../lib/api";
import { transformAuthor } from "../utils/transforms";

const DAILY_SUBTITLE_INDEX = Math.floor(Date.now() / 86400000) % 5;

// Transform API thread to component format
function transformThread(thread: ApiThread | ExploreThread) {
  const exploreThread = thread as ExploreThread;
  const bookmarkableThread = thread as ApiThread & { isBookmarked?: boolean };
  return {
    id: thread.id,
    title: thread.title,
    scope: thread.scope,
    municipalityId: thread.municipality?.id,
    municipalityName: thread.municipality?.name,
    tags: thread.tags,
    authorId: thread.authorId ?? thread.author.id ?? "",
    content: thread.content,
    contentHtml: thread.contentHtml,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    replyCount: thread.replyCount,
    score: thread.score,
    userVote: thread.userVote,
    institutionalContext: thread.institutionalContext,
    source: thread.source,
    sourceUrl: thread.sourceUrl,
    aiGenerated: thread.aiGenerated,
    sourceInstitutionId: thread.sourceInstitutionId,
    sourceInstitutionName: thread.sourceInstitutionName,
    // CVS score (only present in explore feed)
    cvsScore: exploreThread.cvsScore,
    scoreBreakdown: exploreThread.scoreBreakdown,
    isBookmarked: bookmarkableThread.isBookmarked,
  };
}

export function AgoraPage() {
  const { t } = useTranslation("agora");
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  // Feed state
  const [feedScope, setFeedScope] = useState<FeedScope>("all");
  const [feedScopeInitialized, setFeedScopeInitialized] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [topPeriod, setTopPeriod] = useState<TopPeriod>("week");
  const [selectedTags] = useState<string[]>([]);
  const [selectedMunicipality] = useState<string | undefined>();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(
    () => localStorage.getItem("eulesia_wizard_dismissed") === "true",
  );
  const onboardingDone = !!currentUser?.onboardingCompletedAt;
  const completeOnboardingMutation = useCompleteOnboarding();

  const { data: subscriptionsData } = useSubscriptions();

  const [page, setPage] = useState(1);
  const [allThreads, setAllThreads] = useState<
    {
      thread: ReturnType<typeof transformThread>;
      author: ReturnType<typeof transformAuthor>;
    }[]
  >([]);

  // Build filters for the API
  const filters = useMemo(
    () => ({
      feedScope,
      sortBy,
      topPeriod: sortBy === "top" ? topPeriod : undefined,
      municipalityId: selectedMunicipality,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      page,
    }),
    [feedScope, sortBy, topPeriod, selectedMunicipality, selectedTags, page],
  );

  const { data: threadsData, isLoading, error } = useThreads(filters);
  const voteThreadMutation = useVoteThread(filters);

  // Reset pagination when filters change
  useEffect(() => {
    // Filter changes intentionally restart pagination from page one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    setAllThreads([]);
  }, [feedScope, sortBy, topPeriod, selectedMunicipality, selectedTags]);

  // Determine if user has subscriptions
  const hasSubscriptions = useMemo(() => {
    if (!subscriptionsData) return false;
    return subscriptionsData.length > 0;
  }, [subscriptionsData]);

  // Set default feed scope based on subscriptions (only once on initial load)
  useEffect(() => {
    if (feedScopeInitialized) return;
    if (!currentUser) {
      // Unauthenticated: always show 'all' feed
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFeedScope("all");
      setFeedScopeInitialized(true);
      return;
    }
    if (subscriptionsData !== undefined) {
      if (hasSubscriptions) {
        setFeedScope("following");
      } else {
        setFeedScope("all");
      }
      setFeedScopeInitialized(true);
    }
  }, [currentUser, subscriptionsData, hasSubscriptions, feedScopeInitialized]);

  // Show wizard automatically for new users without subscriptions
  const showWizard =
    !wizardDismissed &&
    !hasSubscriptions &&
    !onboardingDone &&
    !!currentUser &&
    !isLoading;

  // showOnboarding is only triggered manually via "?" button
  const showInlineSetup =
    !setupDismissed &&
    !hasSubscriptions &&
    !onboardingDone &&
    !!currentUser &&
    !isLoading &&
    wizardDismissed;

  // Accumulate threads across pages
  useEffect(() => {
    if (!threadsData?.items) return;
    const newItems = threadsData.items.map((item) => ({
      thread: transformThread(item),
      author: transformAuthor(item.author),
    }));
    if (page === 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAllThreads(newItems);
    } else {
      setAllThreads((prev) => {
        const existingIds = new Set(prev.map((t) => t.thread.id));
        const unique = newItems.filter((t) => !existingIds.has(t.thread.id));
        return [...prev, ...unique];
      });
    }
  }, [threadsData, page]);

  const threads = allThreads;

  // Infinite scroll with IntersectionObserver
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasMore = threadsData?.hasMore ?? false;

  const loadNextPage = useCallback(() => {
    if (!isLoading && hasMore) {
      setPage((p) => p + 1);
    }
  }, [isLoading, hasMore]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadNextPage]);

  // Is this a personalized scope with no subscriptions?
  // Show as compact banner above content (content is now always shown as fallback)
  const isPersonalizedScope = ["local", "national", "european"].includes(
    feedScope,
  );
  const showScopeHint = isPersonalizedScope && !isLoading && !hasSubscriptions;

  const handleVote = (threadId: string, value: number) => {
    if (!currentUser) return;
    voteThreadMutation.mutate({ threadId, value });
  };

  // --- Scroll position save/restore ---
  const scrollRestored = useRef(false);
  const SCROLL_KEY = "agora_scroll_y";

  // Save scroll position on scroll (debounced)
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
          ticking = false;
        });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Restore scroll position after threads have loaded (only once per visit)
  useLayoutEffect(() => {
    if (scrollRestored.current) return;
    if (threads.length === 0) return;

    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      const y = parseInt(saved, 10);
      if (y > 0) {
        // Small delay to let the DOM render the thread cards first
        requestAnimationFrame(() => {
          window.scrollTo(0, y);
        });
      }
    }
    scrollRestored.current = true;
  }, [threads.length]);

  // Clear saved scroll when filters change (starting fresh)
  useEffect(() => {
    sessionStorage.removeItem(SCROLL_KEY);
    scrollRestored.current = false;
  }, [feedScope, sortBy, topPeriod, selectedMunicipality, selectedTags]);

  const handleThreadCreated = (threadId: string) => {
    navigate(`/agora/thread/${threadId}`);
  };

  const handleOnboardingComplete = () => {
    completeOnboardingMutation.mutate();
    setShowOnboarding(false);
  };

  return (
    <Layout>
      <SEOHead
        title="Agora – Kansalaiskeskustelu"
        description="Osallistu kansalaiskeskusteluun Eulesia-alustalla. Keskustele paikallisista, kansallisista ja eurooppalaisista aiheista."
        path="/agora"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Agora – Kansalaiskeskustelu",
          description: "Osallistu kansalaiskeskusteluun Eulesia-alustalla.",
          isPartOf: {
            "@type": "WebSite",
            name: "Eulesia",
            url: "https://eulesia.org",
          },
        }}
      />

      {/* Onboarding wizard for new users */}
      {showWizard && (
        <OnboardingWizard
          onComplete={() => {
            completeOnboardingMutation.mutate();
            localStorage.setItem("eulesia_wizard_dismissed", "true");
            setWizardDismissed(true);
          }}
        />
      )}

      {/* Page header */}
      <div
        className="bg-white dark:bg-gray-900 px-4 py-4 border-b border-gray-200 dark:border-gray-800"
        data-guide="agora-header"
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("title")}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {t(`subtitle_${DAILY_SUBTITLE_INDEX}`, {
                defaultValue: t("subtitle"),
              })}
            </p>
          </div>
          {currentUser && (
            <button
              onClick={() => setShowOnboarding((v) => !v)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title={t("agora:onboarding.welcome", { defaultValue: "Ohjeet" })}
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Thread list */}
      <div className="px-4 py-4 space-y-4">
        {/* Inline thread creation */}
        {currentUser && (
          <div data-guide="agora-newthread">
            <InlineThreadForm onSuccess={handleThreadCreated} />
          </div>
        )}

        {/* Scope tabs + sort */}
        <FeedFilters
          feedScope={feedScope}
          onFeedScopeChange={setFeedScope}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          topPeriod={topPeriod}
          onTopPeriodChange={setTopPeriod}
        />

        {isLoading && page === 1 && <ThreadListSkeleton count={4} />}

        {error && (
          <div className="text-center py-12 text-red-600">
            <p>{t("loadError")}</p>
            <p className="text-sm mt-1">
              {error instanceof Error
                ? error.message
                : t("common:errors.unknown")}
            </p>
          </div>
        )}

        {/* Manual onboarding via "?" button */}
        {showOnboarding && (
          <div className="py-4">
            <FeedOnboarding
              onComplete={() => {
                handleOnboardingComplete();
                setShowOnboarding(false);
              }}
            />
          </div>
        )}

        {/* Inline first-time setup for new users */}
        {!showOnboarding && showInlineSetup && (
          <div className="bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                  {t("agora:onboarding.welcome", {
                    defaultValue: "Tervetuloa Eulesiaan!",
                  })}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {t("agora:onboarding.setupHint", {
                    defaultValue:
                      "Valitse kotikuntasi saadaksesi paikallisen syötteen.",
                  })}
                </p>
              </div>
              <button
                onClick={() => setSetupDismissed(true)}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
              >
                ✕
              </button>
            </div>
            <FeedOnboarding
              onComplete={() => {
                handleOnboardingComplete();
                setSetupDismissed(true);
              }}
              compact
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 border-t border-blue-100 dark:border-blue-800 pt-3">
              {t("agora:onboarding.followFriendsTip", {
                defaultValue: "Kavereita voi seurata heidän profiilisivultaan.",
              })}
            </p>
          </div>
        )}

        {/* Scope-specific banner when no subscriptions — shown above fallback content */}
        {!isLoading && !error && showScopeHint && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3">
            <div className="flex-shrink-0">
              {feedScope === "local" && (
                <MapPin className="w-5 h-5 text-blue-600" />
              )}
              {feedScope === "national" && (
                <Building2 className="w-5 h-5 text-blue-600" />
              )}
              {feedScope === "european" && (
                <Globe className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <p className="text-sm text-blue-800 flex-1">
              {t("emptyScope.hint")}
            </p>
            <button
              onClick={() => {
                setFeedScope("following");
                setSetupDismissed(false);
              }}
              className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Users className="w-3.5 h-3.5" />
              {t("emptyScope.startFollowing")}
            </button>
          </div>
        )}

        {/* Thread list */}
        {!isLoading && !error && threads.length > 0 && (
          <div className="space-y-3">
            {threads.map((item, index) => (
              <div
                key={item.thread.id}
                {...(index === 0 ? { "data-guide": "agora-threadcard" } : {})}
              >
                <ThreadCard
                  thread={item.thread}
                  author={item.author}
                  onVote={handleVote}
                  isVoting={voteThreadMutation.isPending}
                />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && threads.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p>{t("noThreads")}</p>
            {feedScope === "following" && (
              <button
                onClick={() => setSetupDismissed(false)}
                className="mt-2 text-blue-600 hover:underline text-sm"
              >
                {t("editSubscriptions")}
              </button>
            )}
          </div>
        )}

        {/* Infinite scroll trigger / End marker */}
        {threads.length > 0 &&
          (hasMore ? (
            <>
              <div ref={loadMoreRef} className="py-4" />
              {isLoading && page > 1 && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          ) : (
            !isLoading && <ContentEndMarker />
          ))}
      </div>
    </Layout>
  );
}
