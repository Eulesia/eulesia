import { useTranslation } from "react-i18next";
import { formatDateTimeLong, formatRelativeTime } from "../../lib/formatTime";

interface EditedIndicatorProps {
  editedAt: string;
  editorName?: string | null;
}

export function EditedIndicator({
  editedAt,
  editorName,
}: EditedIndicatorProps) {
  const { t } = useTranslation("common");

  return (
    <span
      className="text-xs text-gray-400 italic"
      title={formatDateTimeLong(editedAt)}
    >
      (
      {editorName
        ? t("actions.editedBy", { name: editorName })
        : t("actions.edited")}{" "}
      {formatRelativeTime(editedAt)})
    </span>
  );
}
