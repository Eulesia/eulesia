import { useState, useEffect } from "react";
import {
  Shield,
  Fingerprint,
  Clock,
  Lock,
  MapPin,
  MessageSquare,
  UserPlus,
  LogIn,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { useLocation } from "react-router-dom";
import { SEOHead } from "../components/SEOHead";
import { useAuth } from "../hooks/useAuth";
import { api, type AuthConfig } from "../lib/api";
import { buildApiUrl } from "../lib/runtimeConfig";

// Toggle to re-enable login/register UI when ready
const REGISTRATION_OPEN = true;

type LoginStep = "initial" | "login" | "register";

interface FtnReturnParams {
  error: string | null;
  firstName: string | null;
  lastName: string | null;
  token: string | null;
}

function readFtnReturnParams(search: string): FtnReturnParams {
  const params = new URLSearchParams(search);

  return {
    error: params.get("ftn_error"),
    firstName: params.get("firstName"),
    lastName: params.get("lastName"),
    token: params.get("ftn"),
  };
}

export function LoginPage() {
  const { t } = useTranslation(["auth", "common"]);
  const location = useLocation();
  const { login, register } = useAuth();
  const initialFtnReturn = readFtnReturnParams(location.search);
  const hasInitialFtnReturn =
    !!initialFtnReturn.token &&
    !!initialFtnReturn.firstName &&
    !!initialFtnReturn.lastName;

  const [step, setStep] = useState<LoginStep>(() =>
    location.pathname === "/register" || hasInitialFtnReturn
      ? "register"
      : "initial",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);

  // Login form
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register form
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regFirstName, setRegFirstName] = useState(
    initialFtnReturn.firstName ?? "",
  );
  const [regLastName, setRegLastName] = useState(
    initialFtnReturn.lastName ?? "",
  );
  const [termsAccepted, setTermsAccepted] = useState(false);

  // FTN (strong authentication)
  const [ftnToken, setFtnToken] = useState<string | null>(
    hasInitialFtnReturn ? initialFtnReturn.token : null,
  );
  const ftnVerified = !!ftnToken;
  const canRegisterWithFtn =
    !!authConfig?.registrationOpen && !!authConfig?.ftnEnabled;
  const showRegisterStep = step === "register";

  useEffect(() => {
    if (!REGISTRATION_OPEN) return;

    let cancelled = false;

    api
      .getAuthConfig()
      .then((config) => {
        if (cancelled) {
          return;
        }

        setAuthConfig(config);
      })
      .catch((err) => {
        console.error("Failed to load auth config:", err);
        if (!cancelled) {
          setAuthConfig({
            registrationMode: "ftn-open",
            registrationOpen: true,
            ftnEnabled: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Handle FTN callback parameters from URL
  useEffect(() => {
    if (!REGISTRATION_OPEN) return;

    const {
      error: ftnError,
      firstName,
      lastName,
      token,
    } = readFtnReturnParams(location.search);

    if (location.pathname === "/register") {
      setStep("register");
    }

    if (ftnError) {
      if (ftnError === "duplicate_identity") {
        setError(t("ftn.alreadyRegistered"));
      } else if (ftnError === "ftn_registration_limit") {
        setError(t("ftn.registrationLimit"));
      } else {
        setError(t("ftn.authFailed"));
      }
      setStep("register");
      window.history.replaceState({}, "", location.pathname);
      return;
    }

    if (token && firstName && lastName) {
      setFtnToken(token);
      setRegFirstName(firstName);
      setRegLastName(lastName);
      setStep("register");
      window.history.replaceState({}, "", location.pathname);
    }
  }, [location.pathname, location.search, t]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await login(loginUsername, loginPassword);
      // Navigation handled by App.tsx
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await register({
        username: regUsername,
        password: regPassword,
        name: `${regFirstName.trim()} ${regLastName.trim()}`,
        ...(ftnToken ? { ftnToken } : {}),
      });
      // Navigation handled by App.tsx
    } catch (err) {
      setError(err instanceof Error ? err.message : t("registrationFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex flex-col">
      <SEOHead
        title="Eulesia – Eurooppalainen sosiaalinen media"
        description="Eulesia on avoin eurooppalainen sosiaalinen media. Tilaa ajatuksille, tilaa keskusteluille, tilaa ihmisyydelle."
        path="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Eulesia",
          url: "https://eulesia.org",
          description: "Avoin eurooppalainen sosiaalinen media",
        }}
      />
      {/* Header */}
      <header className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
            <span className="text-blue-800 font-bold text-xl">E</span>
          </div>
          <span className="text-white font-semibold text-2xl">Eulesia</span>
          <span className="text-xs font-medium text-blue-200 bg-blue-700/50 px-2 py-0.5 rounded-full">
            beta
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col justify-center px-6 pb-12">
        <div className="max-w-md mx-auto w-full">
          {/* Tagline */}
          <h1 className="text-white text-3xl font-bold mb-3">{t("tagline")}</h1>
          <p className="text-blue-200 text-lg mb-8">{t("taglineBody")}</p>

          {!REGISTRATION_OPEN ? (
            /* Coming soon card */
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                  <Clock className="w-6 h-6 text-blue-800 dark:text-blue-300" />
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                    {t("comingSoon.title")}
                  </h2>
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                {t("comingSoon.description")}
              </p>
            </div>
          ) : (
            /* Login/Register card */
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-xl">
              {!authConfig && (
                <div className="flex items-center justify-center py-10">
                  <div className="w-8 h-8 border-2 border-blue-800 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {authConfig && step === "initial" && (
                <>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                      <Fingerprint className="w-6 h-6 text-blue-800 dark:text-blue-300" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                        {t("welcome")}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("ftnOpenBeta")}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setStep("login")}
                    className="w-full bg-blue-800 text-white py-3 px-4 rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 mb-3"
                  >
                    <LogIn className="w-5 h-5" />
                    {t("signIn")}
                  </button>

                  <button
                    onClick={() => setStep("register")}
                    disabled={!canRegisterWithFtn}
                    className="w-full bg-white dark:bg-gray-800 text-blue-800 dark:text-blue-300 border-2 border-blue-800 dark:border-blue-700 py-3 px-4 rounded-xl font-medium hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Fingerprint className="w-5 h-5" />
                    {t("registerWithBankAuth")}
                  </button>

                  <a
                    href="/agora"
                    className="w-full mt-3 text-gray-500 dark:text-gray-400 text-sm hover:text-gray-700 dark:hover:text-gray-300 flex items-center justify-center gap-1"
                  >
                    {t("browseWithoutAccount")}
                    <ArrowRight className="w-4 h-4" />
                  </a>

                  <p className="mt-3 text-sm text-blue-700 dark:text-blue-300">
                    {t("ftn.availabilityNotice")}
                  </p>

                  {/* Future: EUDI Wallet button */}
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                    <button
                      disabled
                      className="w-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 cursor-not-allowed"
                    >
                      <Shield className="w-5 h-5" />
                      {t("eudiWallet")}
                    </button>
                  </div>
                </>
              )}

              {authConfig && step === "login" && (
                <form onSubmit={handleLogin}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                      <LogIn className="w-6 h-6 text-blue-800 dark:text-blue-300" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                        {t("signIn")}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("enterCredentials")}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-4">
                    <div>
                      <label
                        htmlFor="login-username"
                        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                      >
                        {t("username")}
                      </label>
                      <input
                        type="text"
                        id="login-username"
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        placeholder={t("usernamePlaceholder")}
                        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                        required
                        autoFocus
                        autoComplete="username"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="login-password"
                        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                      >
                        {t("password")}
                      </label>
                      <input
                        type="password"
                        id="login-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                        required
                        autoComplete="current-password"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading || !loginUsername || !loginPassword}
                    className="w-full bg-blue-800 text-white py-3 px-4 rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        {t("signingIn")}
                      </>
                    ) : (
                      <>
                        {t("signIn")}
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStep("initial");
                      setError(null);
                    }}
                    className="w-full mt-3 text-gray-500 dark:text-gray-400 text-sm hover:text-gray-700 dark:hover:text-gray-300 flex items-center justify-center gap-1"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {t("common:actions.back")}
                  </button>
                </form>
              )}

              {authConfig && showRegisterStep && (
                <form onSubmit={handleRegister}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                      <UserPlus className="w-6 h-6 text-green-700" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                        {t("createAccount")}
                      </h2>
                    </div>
                  </div>

                  {/* FTN verification status or button */}
                  {ftnVerified ? (
                    <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                      <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 text-sm">
                        <Fingerprint className="w-4 h-4" />
                        <span className="font-medium">{t("ftn.verified")}</span>
                      </div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        {t("ftn.nameFromBank")}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* FTN required notice */}
                      <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                        <div className="flex items-start gap-2">
                          <Fingerprint className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                          <div className="text-sm text-amber-800 dark:text-amber-200">
                            <p className="font-medium">
                              {t("ftn.requiredTitle")}
                            </p>
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                              {t("ftn.requiredDescription")}
                            </p>
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                              {t("ftn.availabilityNotice")}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* FTN strong authentication button */}
                      <a
                        href={buildApiUrl("/api/v1/auth/ftn/start")}
                        className="w-full mb-4 bg-blue-700 text-white py-3 px-4 rounded-xl font-medium hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 no-underline block"
                      >
                        <Fingerprint className="w-5 h-5" />
                        {t("ftn.authenticateWithBank")}
                      </a>
                    </>
                  )}

                  {error && (
                    <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  {/* Registration form - only shown after FTN verification */}
                  {ftnVerified && (
                    <>
                      <div className="space-y-4 mb-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label
                              htmlFor="reg-firstname"
                              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                            >
                              {t("firstName")}
                            </label>
                            <input
                              type="text"
                              id="reg-firstname"
                              value={regFirstName}
                              onChange={(e) => setRegFirstName(e.target.value)}
                              placeholder={t("firstNamePlaceholder")}
                              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                              required
                              autoComplete="given-name"
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {t("ftn.firstNameHint")}
                            </p>
                          </div>
                          <div>
                            <label
                              htmlFor="reg-lastname"
                              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                            >
                              {t("lastName")}
                            </label>
                            <input
                              type="text"
                              id="reg-lastname"
                              value={regLastName}
                              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-800 rounded-xl bg-gray-50 dark:bg-gray-800/50 cursor-not-allowed dark:text-gray-100"
                              required
                              autoComplete="family-name"
                              readOnly
                            />
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="reg-username"
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                          >
                            {t("username")}
                          </label>
                          <input
                            type="text"
                            id="reg-username"
                            value={regUsername}
                            onChange={(e) =>
                              setRegUsername(
                                e.target.value
                                  .toLowerCase()
                                  .replace(/[^a-z0-9_]/g, ""),
                              )
                            }
                            placeholder={t("usernamePlaceholder")}
                            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                            required
                            autoFocus
                            autoComplete="username"
                            pattern="[a-z0-9_]+"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t("usernameHint")}
                          </p>
                        </div>

                        <div>
                          <label
                            htmlFor="reg-password"
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                          >
                            {t("password")}
                          </label>
                          <input
                            type="password"
                            id="reg-password"
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                            required
                            minLength={6}
                            autoComplete="new-password"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {t("passwordHint")}
                          </p>
                        </div>
                      </div>

                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => setTermsAccepted(e.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                          required
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          <Trans
                            i18nKey="termsAccept"
                            ns="auth"
                            components={{
                              termsLink: (
                                <a
                                  href="/terms"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 dark:text-blue-400 underline hover:no-underline"
                                >
                                  terms of service
                                </a>
                              ),
                              privacyLink: (
                                <a
                                  href="/privacy"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 dark:text-blue-400 underline hover:no-underline"
                                >
                                  privacy policy
                                </a>
                              ),
                            }}
                          />
                        </span>
                      </label>

                      <button
                        type="submit"
                        disabled={
                          isLoading ||
                          !regUsername ||
                          !regPassword ||
                          !regFirstName.trim() ||
                          !regLastName.trim() ||
                          !termsAccepted
                        }
                        className="w-full bg-green-600 text-white py-3 px-4 rounded-xl font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            {t("creatingAccount")}
                          </>
                        ) : (
                          <>
                            {t("createAccount")}
                            <ArrowRight className="w-5 h-5" />
                          </>
                        )}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setStep("initial");
                      setError(null);
                      setFtnToken(null);
                    }}
                    className="w-full mt-3 text-gray-500 dark:text-gray-400 text-sm hover:text-gray-700 dark:hover:text-gray-300 flex items-center justify-center gap-1"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {t("common:actions.back")}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Identity explanation */}
          <div className="mt-6 bg-blue-800/50 rounded-xl p-4 border border-blue-700">
            <h3 className="text-white font-medium flex items-center gap-2 mb-2">
              <Lock className="w-4 h-4" />
              {t("ftnOpenPhase.title")}
            </h3>
            <p className="text-blue-200 text-sm">
              {t("ftnOpenPhase.description")}
            </p>
          </div>
        </div>
      </main>

      {/* Feature highlights */}
      <div className="bg-white dark:bg-gray-900 px-6 py-8">
        <div className="max-w-md mx-auto">
          <h3 className="text-gray-900 dark:text-gray-100 font-semibold mb-4 text-center">
            {t("features.title")}
          </h3>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Fingerprint className="w-4 h-4 text-green-700" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                  {t("features.realPeople.title")}
                </h4>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  {t("features.realPeople.description")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-violet-700" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                  {t("features.proximity.title")}
                </h4>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  {t("features.proximity.description")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-4 h-4 text-teal-700" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                  {t("features.realDiscussion.title")}
                </h4>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  {t("features.realDiscussion.description")}
                </p>
              </div>
            </div>
          </div>

          {/* EU alignment + about link */}
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="text-lg">🇪🇺</span>
              <span>{t("euInfrastructure")}</span>
            </div>
            <div className="text-center">
              <a
                href="/about"
                className="text-sm text-blue-600 hover:underline"
              >
                {t("readMore")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
