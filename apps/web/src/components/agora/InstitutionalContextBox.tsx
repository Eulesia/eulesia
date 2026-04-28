import {
  FileText,
  Calendar,
  HelpCircle,
  Mail,
  ChevronDown,
  ChevronUp,
  Bot,
  Building2,
  ExternalLink,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { InstitutionalContext } from "../../lib/api";
import { formatDateLong } from "../../lib/formatTime";

interface InstitutionalContextBoxProps {
  context: InstitutionalContext;
  isAiGenerated?: boolean;
  sourceInstitutionName?: string;
  sourceInstitutionId?: string;
  sourceUrl?: string;
}

export function InstitutionalContextBox({
  context,
  isAiGenerated,
  sourceInstitutionName,
  sourceInstitutionId,
  sourceUrl,
}: InstitutionalContextBoxProps) {
  const { t } = useTranslation("agora");
  const [expandedSection, setExpandedSection] = useState<string | null>(
    "timeline",
  );

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const docs = context.docs || [];
  const timeline = context.timeline || [];
  const faq = context.faq || [];

  return (
    <div
      className={`rounded-xl overflow-hidden border ${isAiGenerated ? "bg-purple-50 border-purple-200" : "bg-violet-50 border-violet-200"}`}
    >
      <div
        className={`px-4 py-3 border-b ${isAiGenerated ? "bg-purple-100 border-purple-200" : "bg-violet-100 border-violet-200"}`}
      >
        {isAiGenerated ? (
          <>
            <h3 className="font-semibold text-purple-900 flex items-center gap-2">
              <Bot className="w-4 h-4" />
              {t("institutionalBox.aiGenerated")}
            </h3>
            <p className="text-xs text-purple-700 dark:text-purple-400 mt-1">
              {sourceInstitutionName ? (
                <>
                  {t("institutionalBox.source")}:{" "}
                  {sourceInstitutionId ? (
                    <Link
                      to={`/user/${sourceInstitutionId}`}
                      className="underline hover:text-purple-900 dark:hover:text-purple-200"
                    >
                      {sourceInstitutionName}
                    </Link>
                  ) : (
                    sourceInstitutionName
                  )}
                </>
              ) : (
                `${t("institutionalBox.source")}: julkinen lähde`
              )}
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 text-purple-600 dark:text-purple-300 hover:text-purple-800 dark:hover:text-purple-200 underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t("institutionalBox.source")}
                </a>
              )}
            </p>
          </>
        ) : (
          <>
            <h3 className="font-semibold text-violet-900 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              {t("institutionalBox.official")}
              {sourceInstitutionName && (
                <>
                  {" — "}
                  {sourceInstitutionId ? (
                    <Link
                      to={`/user/${sourceInstitutionId}`}
                      className="hover:underline"
                    >
                      {sourceInstitutionName}
                    </Link>
                  ) : (
                    sourceInstitutionName
                  )}
                </>
              )}
            </h3>
          </>
        )}
      </div>

      {/* Sections */}
      <div
        className={`divide-y ${
          isAiGenerated
            ? "divide-purple-200 dark:divide-purple-800/50"
            : "divide-violet-200 dark:divide-violet-800/50"
        }`}
      >
        {/* Documents */}
        {docs.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection("docs")}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-violet-100/50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium text-violet-900">
                <FileText className="w-4 h-4" />
                {t("institutionalBox.documents")} ({docs.length})
              </span>
              {expandedSection === "docs" ? (
                <ChevronUp className="w-4 h-4 text-violet-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-violet-500 dark:text-violet-400" />
              )}
            </button>

            {expandedSection === "docs" && (
              <div className="px-4 pb-3 space-y-2">
                {docs.map((doc, i) => (
                  <a
                    key={i}
                    href={doc.url}
                    className="flex items-center gap-2.5 p-2.5 bg-white dark:bg-gray-800/60 rounded-lg text-sm text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    {doc.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection("timeline")}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-violet-100/50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium text-violet-900">
                <Calendar className="w-4 h-4" />
                {t("institutionalBox.timeline")}
              </span>
              {expandedSection === "timeline" ? (
                <ChevronUp className="w-4 h-4 text-violet-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-violet-500 dark:text-violet-400" />
              )}
            </button>

            {expandedSection === "timeline" && (
              <div className="px-4 pb-3">
                <div className="space-y-3">
                  {timeline.map((item, i) => {
                    const date = new Date(item.date);
                    const isPast = date < new Date();
                    const isNext =
                      !isPast &&
                      (i === 0 || new Date(timeline[i - 1].date) < new Date());

                    return (
                      <div
                        key={i}
                        className={`flex gap-3 ${isPast ? "opacity-60" : ""}`}
                      >
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              isPast
                                ? "bg-gray-400"
                                : isNext
                                  ? "bg-violet-600"
                                  : "bg-violet-300"
                            }`}
                          />
                          {i < timeline.length - 1 && (
                            <div className="w-0.5 h-full bg-violet-200 dark:bg-violet-700 mt-1" />
                          )}
                        </div>
                        <div className="flex-1 pb-2">
                          <p className="text-xs text-violet-600 font-medium">
                            {formatDateLong(item.date)}
                          </p>
                          <p className="text-sm text-violet-900">
                            {item.event}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FAQ */}
        {faq.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection("faq")}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-violet-100/50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium text-violet-900">
                <HelpCircle className="w-4 h-4" />
                {t("institutionalBox.faq")} ({faq.length})
              </span>
              {expandedSection === "faq" ? (
                <ChevronUp className="w-4 h-4 text-violet-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-violet-500 dark:text-violet-400" />
              )}
            </button>

            {expandedSection === "faq" && (
              <div className="px-4 pb-3 space-y-3">
                {faq.map((item, i) => (
                  <div
                    key={i}
                    className="bg-white dark:bg-gray-900 rounded-lg p-3"
                  >
                    <p className="text-sm font-medium text-violet-900 mb-1">
                      {item.q}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {item.a}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Contact */}
        {context.contact && (
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-violet-600" />
              <span className="text-violet-700">
                {t("institutionalBox.contact")}:
              </span>
              <a
                href={`mailto:${context.contact}`}
                className="text-violet-900 hover:underline"
              >
                {context.contact}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
