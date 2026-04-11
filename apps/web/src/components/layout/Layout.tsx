import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { Footer } from "./Footer";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { GuideTour } from "../guide";

interface LayoutProps {
  children: ReactNode;
  showFooter?: boolean;
  fullWidth?: boolean;
}

export function Layout({
  children,
  showFooter = true,
  fullWidth = false,
}: LayoutProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-blue-800 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg"
      >
        {t("common:a11y.skipToContent")}
      </a>
      <TopBar />
      <AnnouncementBanner />

      <main
        id="main-content"
        className={`flex-1 ${fullWidth ? "pb-16" : "pb-20"}`}
        style={{ paddingTop: "var(--topbar-total)" }}
      >
        {fullWidth ? (
          children
        ) : (
          <div className="max-w-4xl mx-auto">{children}</div>
        )}
      </main>

      {showFooter && !fullWidth && <Footer />}

      <BottomNav />
      <GuideTour />
    </div>
  );
}
