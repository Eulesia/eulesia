import { Link } from "react-router-dom";
import {
  X,
  Landmark,
  Users,
  MapPin,
  Building2,
  MessageCircle,
  Clock,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MapPoint } from "../../lib/api";
import { useMapLocationDetails } from "../../hooks/useApi";
import { formatRelativeTime } from "../../lib/formatTime";

interface LocationDetailsProps {
  point: MapPoint;
  onClose: () => void;
}

const typeConfig = {
  municipality: {
    icon: Building2,
    color: "text-blue-600",
    bgColor: "bg-blue-100",
    label: "Municipality",
  },
  thread: {
    icon: Landmark,
    color: "text-purple-600",
    bgColor: "bg-purple-100",
    label: "Discussion",
  },
  club: {
    icon: Users,
    color: "text-green-600",
    bgColor: "bg-green-100",
    label: "Club",
  },
  place: {
    icon: MapPin,
    color: "text-orange-600",
    bgColor: "bg-orange-100",
    label: "Place",
  },
};

export function LocationDetails({ point, onClose }: LocationDetailsProps) {
  const { t } = useTranslation("map");
  const {
    data: details,
    isLoading,
    error,
  } = useMapLocationDetails(point.pointType, point.id);

  const config = typeConfig[point.pointType as keyof typeof typeConfig];
  const Icon = config.icon;

  return (
    <div className="absolute bottom-20 left-4 right-4 z-[1000] max-w-md mx-auto bg-white dark:bg-gray-900 rounded-xl shadow-xl overflow-hidden max-h-[60vh] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-start gap-3">
        <div className={`p-2 rounded-lg ${config.bgColor} shrink-0`}>
          <Icon className={`w-6 h-6 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-lg text-gray-900 dark:text-gray-100 truncate">
            {point.name}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {config.label}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
        >
          <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">{t("loading")}</div>
        ) : details ? (
          <div className="space-y-4">
            {/* Quick actions based on type */}
            {point.pointType === "thread" && (
              <Link
                to={`/agora/thread/${point.id}`}
                className="flex items-center justify-between p-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <span className="font-medium text-purple-700">
                  Open discussion
                </span>
                <ChevronRight className="w-5 h-5 text-purple-600" />
              </Link>
            )}

            {point.pointType === "club" && (
              <Link
                to={`/agora/thread/${point.id}`}
                className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
              >
                <span className="font-medium text-green-700 dark:text-green-400">
                  View club thread
                </span>
                <ChevronRight className="w-5 h-5 text-green-600 dark:text-green-400" />
              </Link>
            )}

            {point.pointType === "municipality" && (
              <Link
                to={`/kunnat/${point.id}`}
                className="flex items-center justify-between p-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <span className="font-medium text-blue-700">
                  View municipality
                </span>
                <ChevronRight className="w-5 h-5 text-blue-600" />
              </Link>
            )}

            {/* Related threads */}
            {details.threads && details.threads.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Recent Discussions
                </h3>
                <div className="space-y-2">
                  {details.threads.slice(0, 5).map((thread) => (
                    <Link
                      key={thread.id}
                      to={`/agora/thread/${thread.id}`}
                      className="block p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
                        {thread.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(thread.createdAt)}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Related clubs */}
            {details.clubs && details.clubs.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Clubs here
                </h3>
                <div className="space-y-2">
                  {details.clubs.slice(0, 5).map((club) => (
                    <Link
                      key={club.id}
                      to={`/clubs/${club.id}`}
                      className="block p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                        {club.name}
                      </p>
                      {club.memberCount && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {club.memberCount} members
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Municipality info */}
            {details.municipality && (
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">Municipality:</span>{" "}
                  {details.municipality.name}
                </p>
              </div>
            )}

            {/* Place info */}
            {details.place && point.pointType !== "place" && (
              <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">Location:</span>{" "}
                  {details.place.name}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            {t("noResults")}
          </div>
        )}
      </div>
    </div>
  );
}
