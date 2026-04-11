import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, UserPlus, X, Search, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/layout";
import { SEOHead } from "../components/SEOHead";
import { useCreateGroupConversation } from "../hooks/useApi";
import { useDevice } from "../hooks/useDevice";
import { api } from "../lib/api";
import type { SearchUserResult } from "../lib/api";

export function CreateGroupPage() {
  const { t } = useTranslation("messages");
  const navigate = useNavigate();
  const { isInitialized: deviceReady } = useDevice();
  const createGroupMutation = useCreateGroupConversation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<
    { id: string; name: string; avatarUrl?: string }[]
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const memberIds = new Set(members.map((m) => m.id));

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.searchUsers(query.trim(), 10);
        setSearchResults(results.filter((u) => !memberIds.has(u.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const addMember = (user: SearchUserResult) => {
    setMembers((prev) => [
      ...prev,
      { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
    ]);
    setSearchQuery("");
    setSearchResults([]);
  };

  const removeMember = (userId: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== userId));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(
        t("groupNameRequired", {
          defaultValue: "Group name is required",
        }),
      );
      return;
    }
    if (members.length === 0) {
      setError(
        t("groupMembersRequired", {
          defaultValue: "Add at least one member",
        }),
      );
      return;
    }

    try {
      setError(null);
      const conv = await createGroupMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        members: members.map((m) => m.id),
      });
      navigate(`/messages/group/${conv.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create group";
      setError(msg);
    }
  };

  if (!deviceReady) {
    return (
      <Layout>
        <SEOHead
          title={t("createGroup", { defaultValue: "New Group" })}
          path="/messages/new-group"
          noIndex
        />
        <div className="px-4 py-12 text-center">
          <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-400">
            {t("deviceRequiredForGroup", {
              defaultValue:
                "You need a registered device to create encrypted group conversations.",
            })}
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <SEOHead
        title={t("createGroup", { defaultValue: "New Group" })}
        path="/messages/new-group"
        noIndex
      />

      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/messages")}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <h1 className="font-semibold text-gray-900 dark:text-gray-100">
            {t("createGroup", { defaultValue: "New Group" })}
          </h1>
        </div>
      </div>

      <form onSubmit={handleCreate} className="px-4 py-4 space-y-4">
        {/* Group name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("groupName", { defaultValue: "Group name" })}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("groupNamePlaceholder", {
              defaultValue: "Enter group name...",
            })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("groupDescription", {
              defaultValue: "Description (optional)",
            })}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("groupDescriptionPlaceholder", {
              defaultValue: "What is this group about?",
            })}
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-none"
          />
        </div>

        {/* E2EE badge */}
        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <Lock className="w-4 h-4" />
          <span>
            {t("groupEncrypted", {
              defaultValue: "End-to-end encrypted. Max 50 members.",
            })}
          </span>
        </div>

        {/* Member search */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("addMembers", { defaultValue: "Add members" })}
          </label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t("searchUsersPlaceholder", {
                defaultValue: "Search by name...",
              })}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          {isSearching && (
            <p className="text-xs text-gray-400 mt-1">
              {t("searching", { defaultValue: "Searching..." })}
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 max-h-40 overflow-y-auto">
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => addMember(user)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {user.name}
                  </span>
                  <UserPlus className="w-4 h-4 text-teal-600 ml-auto" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected members */}
        {members.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <span
                key={member.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-sm"
              >
                {member.name}
                <button
                  type="button"
                  onClick={() => removeMember(member.id)}
                  className="p-0.5 hover:bg-teal-100 dark:hover:bg-teal-800 rounded-full"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Create button */}
        <button
          type="submit"
          disabled={
            !name.trim() ||
            members.length === 0 ||
            createGroupMutation.isPending
          }
          className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {createGroupMutation.isPending
            ? t("creating", { defaultValue: "Creating..." })
            : t("createGroupButton", { defaultValue: "Create Group" })}
        </button>
      </form>
    </Layout>
  );
}
