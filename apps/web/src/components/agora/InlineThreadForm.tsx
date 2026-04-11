import { useState, useRef, useEffect } from "react";
import {
  MapPin,
  Building2,
  Globe,
  User,
  Hash,
  Plus,
  X,
  Loader2,
  ChevronUp,
  Image as ImageIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCreateThread } from "../../hooks/useApi";
import { LocationSearch } from "../common/LocationSearch";
import { api } from "../../lib/api";
// Public thread scopes (excludes "club" which is internal to club endpoints)
type Scope = "local" | "national" | "european" | "personal";
import type { LocationResult } from "../../lib/api";

interface InlineThreadFormProps {
  // For municipality pages - prefilled municipality
  municipalityId?: string;
  municipalityName?: string;
  // Default scope from current feed tab
  defaultScope?: Scope;
  // Callback when thread is created
  onSuccess: (threadId: string) => void;
}

// Common tags for quick selection
const suggestedTags = [
  "liikenne",
  "koulutus",
  "terveys",
  "ympäristö",
  "asuminen",
  "kulttuuri",
  "talous",
  "turvallisuus",
  "sosiaalipalvelut",
  "infrastruktuuri",
];

interface UploadedImage {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

export function InlineThreadForm({
  municipalityId,
  municipalityName,
  defaultScope,
  onSuccess,
}: InlineThreadFormProps) {
  const { t } = useTranslation("agora");
  const createThreadMutation = useCreateThread();
  const formRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const scopeOptions: {
    value: Scope;
    icon: React.ElementType;
    label: string;
  }[] = [
    { value: "personal", icon: User, label: t("threadForm.scopePersonal") },
    { value: "local", icon: MapPin, label: t("threadForm.scopeLocal") },
    {
      value: "national",
      icon: Building2,
      label: t("threadForm.scopeNational"),
    },
    { value: "european", icon: Globe, label: t("threadForm.scopeEuropean") },
  ];

  // Is this a prefilled municipality context (municipality page)?
  const isPrefilled = !!(municipalityId && municipalityName);

  // Form state
  const [isExpanded, setIsExpanded] = useState(false);
  const initialScope: Scope = isPrefilled
    ? "local"
    : (defaultScope ?? "national");
  const [scope, setScope] = useState<Scope>(initialScope);
  const [selectedLocation, setSelectedLocation] =
    useState<LocationResult | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Image upload state
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(
    null,
  );
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Sync scope when feed tab changes
  useEffect(() => {
    if (defaultScope && !isPrefilled) {
      setScope(defaultScope);
    }
  }, [defaultScope, isPrefilled]);

  // Focus title input when expanded
  useEffect(() => {
    if (isExpanded && titleInputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isExpanded]);

  // Clear location when switching away from local scope
  useEffect(() => {
    if (scope !== "local") {
      setSelectedLocation(null);
    }
  }, [scope]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleAddCustomTag = () => {
    const tag = customTag.trim().toLowerCase();
    if (tag && !selectedTags.includes(tag)) {
      setSelectedTags((prev) => [...prev, tag]);
      setCustomTag("");
    }
  };

  const handleImageClick = () => {
    imageInputRef.current?.click();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setError(t("threadForm.imageError"));
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError(t("threadForm.imageError"));
      return;
    }

    setIsUploadingImage(true);
    setError(null);

    try {
      const result = await api.uploadImage(file);
      setUploadedImage({
        url: result.url,
        thumbnailUrl: result.thumbnailUrl,
        width: result.width,
        height: result.height,
      });
    } catch (err) {
      setError(t("threadForm.imageError"));
      console.error("Image upload failed:", err);
    } finally {
      setIsUploadingImage(false);
      // Reset file input
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = () => {
    setUploadedImage(null);
  };

  const handleSubmit = async () => {
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      setError(t("threadForm.validationRequired"));
      return;
    }

    if (scope === "local" && !isPrefilled && !selectedLocation) {
      setError(t("threadForm.validationLocation"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Build location data
      let locationData = {};
      if (isPrefilled && municipalityId) {
        // From municipality page - use municipalityId
        locationData = { municipalityId };
      } else if (scope === "local" && selectedLocation) {
        // From location search - use locationId or activate new location
        locationData =
          selectedLocation.status === "active" && selectedLocation.id
            ? { locationId: selectedLocation.id }
            : {
                locationOsmId: selectedLocation.osmId,
                locationOsmType: selectedLocation.osmType,
              };
      }

      // Build content with image if uploaded
      let finalContent = content.trim();
      if (uploadedImage) {
        finalContent += `\n\n![Kuva](${uploadedImage.url})`;
      }

      const result = await createThreadMutation.mutateAsync({
        title: title.trim() || undefined,
        content: finalContent,
        scope,
        country: "FI",
        ...locationData,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });

      // Reset form
      setTitle("");
      setContent("");
      setSelectedTags([]);
      setSelectedLocation(null);
      setUploadedImage(null);
      setScope(isPrefilled ? "local" : (defaultScope ?? "national"));
      setIsExpanded(false);

      onSuccess(result.id);
    } catch (err) {
      setError(t("threadForm.createError"));
      console.error("Failed to create thread:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setTitle("");
    setContent("");
    setSelectedTags([]);
    setSelectedLocation(null);
    setUploadedImage(null);
    setScope(isPrefilled ? "local" : (defaultScope ?? "national"));
    setError(null);
    setIsExpanded(false);
  };

  return (
    <div
      ref={formRef}
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden transition-all"
    >
      {/* Collapsed state */}
      {!isExpanded ? (
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-blue-50/50 transition-colors group"
        >
          <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center group-hover:bg-blue-200 transition-colors">
            <Plus className="w-4 h-4 text-blue-600" />
          </div>
          <span className="flex-1 text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
            {t("threadForm.collapsed")}
          </span>
        </button>
      ) : (
        /* Expanded state */
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            {isPrefilled ? (
              // Show municipality badge when prefilled
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-full">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">
                  {municipalityName}
                </span>
              </div>
            ) : (
              // Show scope tabs when not prefilled
              <div className="flex items-center gap-2">
                {scopeOptions.map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    onClick={() => setScope(value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      scope === value
                        ? "bg-blue-800 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={handleCancel}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            >
              <ChevronUp className="w-5 h-5 text-gray-400 dark:text-gray-500" />
            </button>
          </div>

          {/* Location search for local scope (when not prefilled). Accepts
              any location type so users can post to a neighborhood, a former
              municipality (e.g. Lohtaja), a named place, or a region — the
              server derives the hierarchical ancestor chain on write. */}
          {!isPrefilled && scope === "local" && (
            <LocationSearch
              value={selectedLocation}
              onChange={setSelectedLocation}
              country="FI"
              placeholder={t("threadForm.locationPlaceholder")}
            />
          )}

          {/* National/EU indicator - subtle, informational */}
          {!isPrefilled && scope === "national" && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span>🇫🇮</span>
              <span>{t("threadForm.nationalInfo")}</span>
            </div>
          )}
          {!isPrefilled && scope === "european" && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span>🇪🇺</span>
              <span>{t("threadForm.europeanInfo")}</span>
            </div>
          )}

          {/* WordPress-style composer: optional title + content */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-800/50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent focus-within:bg-white dark:focus-within:bg-gray-900 transition-colors">
            {/* Optional title */}
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("threadForm.titleOptional", {
                defaultValue: "Otsikko (valinnainen)",
              })}
              className="w-full px-3 py-2 bg-transparent border-0 border-b border-gray-200 dark:border-gray-800 text-base font-medium placeholder-gray-400 dark:placeholder-gray-500 dark:text-gray-100 focus:ring-0 focus:outline-none"
              maxLength={500}
            />
            {/* Content */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("threadForm.contentPlaceholder")}
              rows={4}
              className="w-full px-3 py-2.5 bg-transparent border-0 text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-0 focus:outline-none resize-none"
            />
          </div>

          {/* Image upload */}
          <div className="space-y-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleImageUpload}
              className="hidden"
            />

            {/* Upload button or preview */}
            {uploadedImage ? (
              <div className="relative inline-block">
                <img
                  src={uploadedImage.thumbnailUrl}
                  alt={t("threadForm.preview")}
                  className="h-24 rounded-lg border border-gray-200 dark:border-gray-800 object-cover"
                />
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors shadow-sm"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleImageClick}
                disabled={isUploadingImage}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
              >
                {isUploadingImage ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImageIcon className="w-4 h-4" />
                )}
                {isUploadingImage
                  ? t("threadForm.loading")
                  : t("threadForm.imageUpload")}
              </button>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {suggestedTags.slice(0, 6).map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleTagToggle(tag)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                    selectedTags.includes(tag)
                      ? "bg-teal-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  <Hash className="w-3 h-3" />
                  {tag}
                </button>
              ))}
              {/* Custom tag input inline */}
              <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-50 dark:bg-gray-800/50 rounded-full">
                <Hash className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                <input
                  type="text"
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    (e.preventDefault(), handleAddCustomTag())
                  }
                  placeholder={t("threadForm.customTag")}
                  className="w-16 bg-transparent border-0 p-0 text-xs focus:ring-0 focus:outline-none"
                />
              </div>
            </div>
            {/* Selected custom tags */}
            {selectedTags.filter((t) => !suggestedTags.includes(t)).length >
              0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedTags
                  .filter((t) => !suggestedTags.includes(t))
                  .map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-600 text-white rounded-full text-xs"
                    >
                      <Hash className="w-3 h-3" />
                      {tag}
                      <button
                        onClick={() => handleTagToggle(tag)}
                        className="hover:bg-teal-700 rounded-full"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors"
            >
              {t("threadForm.cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-full text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting
                ? t("threadForm.publishing")
                : t("threadForm.publish")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
