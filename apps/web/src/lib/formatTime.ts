import i18n from "./i18n";

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const t = i18n.t.bind(i18n);

  if (diffSecs < 60) return t("common:time.justNow");
  if (diffMins < 60) return t("common:time.minutesAgo", { count: diffMins });
  if (diffHours < 24) return t("common:time.hoursAgo", { count: diffHours });
  if (diffDays === 1) return t("common:time.yesterday");
  if (diffDays < 7) return t("common:time.daysAgo", { count: diffDays });

  return new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatRelativeTimeShort(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const t = i18n.t.bind(i18n);

  if (diffSecs < 60) return t("common:time.justNowShort");
  if (diffMins < 60) return t("common:time.minutesShort", { count: diffMins });
  if (diffHours < 24) return t("common:time.hoursShort", { count: diffHours });
  if (diffDays < 30) return t("common:time.daysShort", { count: diffDays });

  return new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatDateLong(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTimeLong(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatMessageDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  const t = i18n.t.bind(i18n);

  if (diffDays === 0) {
    return new Intl.DateTimeFormat(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  if (diffDays === 1) return t("common:time.yesterday");
  if (diffDays < 7) return t("common:time.daysAgo", { count: diffDays });

  return new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
  }).format(date);
}
