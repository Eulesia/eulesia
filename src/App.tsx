import { useEffect, lazy, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
  useNavigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AdminAuthProvider, useAdminAuth } from "./hooks/useAdminAuth";
import { SocketProvider } from "./hooks/useSocket";
import { GuideProvider } from "./components/guide";
import { CookieConsent } from "./components/common/CookieConsent";
import { ScrollToTop } from "./components/common/ScrollToTop";
import { DeepLinkHandler } from "./hooks/useDeepLinks";
import { BackButtonHandler } from "./hooks/useBackButton";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { PageErrorBoundary } from "./components/common/PageErrorBoundary";
import {
  PWAUpdatePrompt,
  PWAInstallBanner,
} from "./components/common/PWAPrompt";
import { PWAProvider } from "./hooks/usePWA";
import { useNativePush } from "./hooks/useNativePush";
import { NotFoundPage } from "./pages/NotFoundPage";
import { buildApiUrl } from "./lib/runtimeConfig";

// Lazy-loaded pages — route-based code splitting
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const AgoraPage = lazy(() =>
  import("./pages/AgoraPage").then((m) => ({ default: m.AgoraPage })),
);
const ThreadPage = lazy(() =>
  import("./pages/ThreadPage").then((m) => ({ default: m.ThreadPage })),
);
const ClubsPage = lazy(() =>
  import("./pages/ClubsPage").then((m) => ({ default: m.ClubsPage })),
);
const ClubViewPage = lazy(() =>
  import("./pages/ClubViewPage").then((m) => ({ default: m.ClubViewPage })),
);
const ClubThreadPage = lazy(() =>
  import("./pages/ClubThreadPage").then((m) => ({ default: m.ClubThreadPage })),
);
const HomePage = lazy(() =>
  import("./pages/HomePage").then((m) => ({ default: m.HomePage })),
);
const RoomPage = lazy(() =>
  import("./pages/RoomPage").then((m) => ({ default: m.RoomPage })),
);
const RoomThreadPage = lazy(() =>
  import("./pages/RoomThreadPage").then((m) => ({
    default: m.RoomThreadPage,
  })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const ServicesPage = lazy(() =>
  import("./pages/ServicesPage").then((m) => ({ default: m.ServicesPage })),
);
const AboutPage = lazy(() =>
  import("./pages/AboutPage").then((m) => ({ default: m.AboutPage })),
);
const MunicipalitiesPage = lazy(() =>
  import("./pages/MunicipalitiesPage").then((m) => ({
    default: m.MunicipalitiesPage,
  })),
);
const MunicipalityPage = lazy(() =>
  import("./pages/MunicipalityPage").then((m) => ({
    default: m.MunicipalityPage,
  })),
);
const UserProfilePage = lazy(() =>
  import("./pages/UserProfilePage").then((m) => ({
    default: m.UserProfilePage,
  })),
);
const TagPage = lazy(() =>
  import("./pages/TagPage").then((m) => ({ default: m.TagPage })),
);
const TopicsPage = lazy(() =>
  import("./pages/TopicsPage").then((m) => ({ default: m.TopicsPage })),
);
const MessagesPage = lazy(() =>
  import("./pages/MessagesPage").then((m) => ({ default: m.MessagesPage })),
);
const DMConversationPage = lazy(() =>
  import("./pages/DMConversationPage").then((m) => ({
    default: m.DMConversationPage,
  })),
);
const UserHomePage = lazy(() =>
  import("./pages/UserHomePage").then((m) => ({ default: m.UserHomePage })),
);
const TermsPage = lazy(() =>
  import("./pages/TermsPage").then((m) => ({ default: m.TermsPage })),
);
const PrivacyPage = lazy(() =>
  import("./pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
const PersonalDataPage = lazy(() =>
  import("./pages/PersonalDataPage").then((m) => ({
    default: m.PersonalDataPage,
  })),
);
const MapPage = lazy(() =>
  import("./pages/MapPage").then((m) => ({ default: m.MapPage })),
);
const AdminDashboardPage = lazy(() =>
  import("./pages/admin/AdminDashboardPage").then((m) => ({
    default: m.AdminDashboardPage,
  })),
);
const AdminUsersPage = lazy(() =>
  import("./pages/admin/AdminUsersPage").then((m) => ({
    default: m.AdminUsersPage,
  })),
);
const AdminUserDetailPage = lazy(() =>
  import("./pages/admin/AdminUserDetailPage").then((m) => ({
    default: m.AdminUserDetailPage,
  })),
);
const AdminReportsPage = lazy(() =>
  import("./pages/admin/AdminReportsPage").then((m) => ({
    default: m.AdminReportsPage,
  })),
);
const AdminReportDetailPage = lazy(() =>
  import("./pages/admin/AdminReportDetailPage").then((m) => ({
    default: m.AdminReportDetailPage,
  })),
);
const AdminModLogPage = lazy(() =>
  import("./pages/admin/AdminModLogPage").then((m) => ({
    default: m.AdminModLogPage,
  })),
);
const AdminContentPage = lazy(() =>
  import("./pages/admin/AdminContentPage").then((m) => ({
    default: m.AdminContentPage,
  })),
);
const AdminTransparencyPage = lazy(() =>
  import("./pages/admin/AdminTransparencyPage").then((m) => ({
    default: m.AdminTransparencyPage,
  })),
);
const AdminAppealsPage = lazy(() =>
  import("./pages/admin/AdminAppealsPage").then((m) => ({
    default: m.AdminAppealsPage,
  })),
);
const AdminSettingsPage = lazy(() =>
  import("./pages/admin/AdminSettingsPage").then((m) => ({
    default: m.AdminSettingsPage,
  })),
);
const AdminInstitutionsPage = lazy(() =>
  import("./pages/admin/AdminInstitutionsPage").then((m) => ({
    default: m.AdminInstitutionsPage,
  })),
);
const AdminWaitlistPage = lazy(() =>
  import("./pages/admin/AdminWaitlistPage").then((m) => ({
    default: m.AdminWaitlistPage,
  })),
);
const AdminLoginPage = lazy(() =>
  import("./pages/admin/AdminLoginPage").then((m) => ({
    default: m.AdminLoginPage,
  })),
);

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-blue-800 font-bold text-3xl">E</span>
        </div>
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-800 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAdminAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

function NativePushHandler() {
  useNativePush();
  return null;
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route
          path="/"
          element={
            isAuthenticated ? <Navigate to="/agora" replace /> : <LoginPage />
          }
        />
        <Route
          path="/login"
          element={
            isAuthenticated ? <Navigate to="/agora" replace /> : <LoginPage />
          }
        />
        <Route
          path="/register"
          element={
            isAuthenticated ? <Navigate to="/agora" replace /> : <LoginPage />
          }
        />
        <Route path="/auth/verify/:token" element={<MagicLinkVerify />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Public content routes (readable without login) */}
        <Route
          path="/agora"
          element={
            <PageErrorBoundary>
              <AgoraPage />
            </PageErrorBoundary>
          }
        />
        <Route
          path="/agora/thread/:threadId"
          element={
            <PageErrorBoundary>
              <ThreadPage />
            </PageErrorBoundary>
          }
        />
        <Route
          path="/agora/tag/:tagName"
          element={
            <PageErrorBoundary>
              <TagPage />
            </PageErrorBoundary>
          }
        />
        <Route
          path="/kunnat"
          element={
            <PageErrorBoundary>
              <MunicipalitiesPage />
            </PageErrorBoundary>
          }
        />
        <Route
          path="/kunnat/:municipalityId"
          element={
            <PageErrorBoundary>
              <MunicipalityPage />
            </PageErrorBoundary>
          }
        />

        <Route
          path="/clubs"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <ClubsPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/clubs/:clubId"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <ClubViewPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/clubs/:clubId/thread/:threadId"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <ClubThreadPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />

        <Route
          path="/map"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <MapPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />

        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <HomePage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/home/room/:roomId"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <RoomPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/home/room/:roomId/thread/:threadId"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <RoomThreadPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/home/:userId"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <UserHomePage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />

        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <MessagesPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/messages/:conversationId"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <DMConversationPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />

        <Route
          path="/services"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <ServicesPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile/data"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <PersonalDataPage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <PageErrorBoundary>
                <ProfilePage />
              </PageErrorBoundary>
            </ProtectedRoute>
          }
        />

        <Route path="/about" element={<AboutPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />

        <Route
          path="/aiheet"
          element={
            <PageErrorBoundary>
              <TopicsPage />
            </PageErrorBoundary>
          }
        />
        <Route
          path="/user/:userId"
          element={
            <PageErrorBoundary>
              <UserProfilePage />
            </PageErrorBoundary>
          }
        />

        {/* Admin routes */}
        <Route
          path="/admin/login"
          element={
            <Suspense fallback={<PageLoader />}>
              <AdminLoginPage />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminDashboardPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminUsersPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminUserDetailPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminReportsPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/reports/:id"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminReportDetailPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/modlog"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminModLogPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/content"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminContentPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/transparency"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminTransparencyPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/appeals"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminAppealsPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/institutions"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminInstitutionsPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/waitlist"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminWaitlistPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <AdminRoute>
              <PageErrorBoundary>
                <AdminSettingsPage />
              </PageErrorBoundary>
            </AdminRoute>
          }
        />

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

// Auth callback - handles redirect from API after successful magic link verification
function AuthCallback() {
  const { checkAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("success") === "true") {
        await checkAuth();
        navigate("/agora");
      } else {
        navigate("/?error=auth_failed");
      }
    }
    handleCallback();
  }, [checkAuth, navigate]);

  return <LoadingScreen />;
}

// Magic link verification component (for direct frontend verification)
function MagicLinkVerify() {
  const { checkAuth } = useAuth();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    async function verify() {
      if (!token) {
        navigate("/");
        return;
      }

      try {
        // The backend will set the session cookie when we visit this URL
        const response = await fetch(
          buildApiUrl(`/api/v1/auth/verify/${token}`),
          {
            credentials: "include",
          },
        );

        if (response.ok) {
          await checkAuth();
          navigate("/agora");
        } else {
          navigate("/?error=invalid_link");
        }
      } catch {
        navigate("/?error=verification_failed");
      }
    }

    verify();
  }, [token, checkAuth, navigate]);

  return <LoadingScreen />;
}

function App() {
  return (
    <ErrorBoundary>
      <PWAProvider>
        <BrowserRouter>
          <ScrollToTop />
          <DeepLinkHandler />
          <BackButtonHandler />
          <AuthProvider>
            <AdminAuthProvider>
              <SocketProvider>
                <NativePushHandler />
                <GuideProvider>
                  <AppRoutes />
                  <CookieConsent />
                  <PWAUpdatePrompt />
                  <PWAInstallBanner />
                </GuideProvider>
              </SocketProvider>
            </AdminAuthProvider>
          </AuthProvider>
        </BrowserRouter>
      </PWAProvider>
    </ErrorBoundary>
  );
}

export default App;
