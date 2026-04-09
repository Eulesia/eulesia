import { useState } from "react";
import { useAdminAuth } from "../../hooks/useAdminAuth";
import { useNavigate } from "react-router-dom";
import {
  LogIn,
  Shield,
  Fingerprint,
  KeyRound,
  Smartphone,
  Copy,
  Check,
} from "lucide-react";

/* ---------- PasswordStep ---------- */
function PasswordStep() {
  const { login, loginWithPasskey } = useAdminAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskey = async () => {
    setError(null);
    try {
      await loginWithPasskey();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey login failed");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-xl"
    >
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label
          htmlFor="username"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Username
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-500 focus:border-transparent"
          autoComplete="username"
          required
        />
      </div>

      <div className="mb-6">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-500 focus:border-transparent"
          autoComplete="current-password"
          required
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full bg-gray-800 dark:bg-gray-700 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <LogIn className="w-5 h-5" />
        {isLoading ? "Signing in..." : "Sign in"}
      </button>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={handlePasskey}
          className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center justify-center gap-2 py-2 transition-colors"
        >
          <Fingerprint className="w-4 h-4" />
          Sign in with passkey
        </button>
      </div>
    </form>
  );
}

/* ---------- TotpStep ---------- */
function TotpStep() {
  const { verifyTotp, loginWithRecovery, verifyPasskey } = useAdminAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      if (useRecovery) {
        await loginWithRecovery(code);
      } else {
        await verifyTotp(code);
      }
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskey = async () => {
    setError(null);
    try {
      await verifyPasskey();
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey auth failed");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-xl"
    >
      <div className="text-center mb-4">
        <Smartphone className="w-8 h-8 text-gray-600 dark:text-gray-400 mx-auto mb-2" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {useRecovery ? "Recovery code" : "Two-factor authentication"}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {useRecovery
            ? "Enter one of your recovery codes"
            : "Enter the 6-digit code from your authenticator app"}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={useRecovery ? "XXXX-XXXX-XXXX" : "000000"}
          className="w-full px-3 py-3 text-center text-lg tracking-widest border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-500 focus:border-transparent font-mono"
          autoFocus
          required
        />
      </div>

      <button
        type="submit"
        disabled={isLoading || !code}
        className="w-full bg-gray-800 dark:bg-gray-700 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <KeyRound className="w-5 h-5" />
        {isLoading ? "Verifying..." : "Verify"}
      </button>

      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
        <button
          type="button"
          onClick={handlePasskey}
          className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center justify-center gap-2 py-2 transition-colors"
        >
          <Fingerprint className="w-4 h-4" />
          Use passkey instead
        </button>
        <button
          type="button"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setCode("");
            setError(null);
          }}
          className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1 transition-colors"
        >
          {useRecovery ? "Use authenticator app" : "Use recovery code"}
        </button>
      </div>
    </form>
  );
}

/* ---------- SetupStep ---------- */
type SetupPhase =
  | "choose"
  | "passkey_register"
  | "totp_qr"
  | "totp_verify"
  | "recovery_codes";

function SetupStep() {
  const { beginPasskeyRegistration, beginTotpSetup, confirmTotpSetup } =
    useAdminAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<SetupPhase>("choose");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Passkey
  const [passkeyName, setPasskeyName] = useState("");

  // TOTP
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQrUri, setTotpQrUri] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // Recovery codes
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const handleChoosePasskey = () => {
    setPhase("passkey_register");
    setError(null);
  };

  const handleChooseTotp = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await beginTotpSetup();
      setTotpSecret(result.secret);
      setTotpQrUri(result.qrUri);
      setPhase("totp_qr");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start TOTP setup",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeyRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const result = await beginPasskeyRegistration(
        passkeyName || "Admin passkey",
      );
      if (result.recoveryCodes && result.recoveryCodes.length > 0) {
        setRecoveryCodes(result.recoveryCodes);
        setPhase("recovery_codes");
      } else {
        navigate("/admin", { replace: true });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Passkey registration failed",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleTotpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const result = await confirmTotpSetup(totpCode);
      setRecoveryCodes(result.recoveryCodes);
      setPhase("recovery_codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDone = () => {
    navigate("/admin", { replace: true });
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-xl">
      <div className="text-center mb-4">
        <Shield className="w-8 h-8 text-gray-600 dark:text-gray-400 mx-auto mb-2" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Set up two-factor authentication
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {phase === "choose" && "Choose a method to secure your account"}
          {phase === "passkey_register" && "Register a passkey"}
          {phase === "totp_qr" &&
            "Scan the QR code with your authenticator app"}
          {phase === "totp_verify" &&
            "Enter the code from your authenticator app"}
          {phase === "recovery_codes" &&
            "Save these recovery codes in a safe place"}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Choose method */}
      {phase === "choose" && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleChoosePasskey}
            className="w-full p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left flex items-start gap-3"
          >
            <Fingerprint className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                Passkey
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Use biometrics or a security key
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={handleChooseTotp}
            disabled={isLoading}
            className="w-full p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left flex items-start gap-3 disabled:opacity-50"
          >
            <Smartphone className="w-5 h-5 text-gray-600 dark:text-gray-400 mt-0.5" />
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                Authenticator app
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Use Google Authenticator, Authy, etc.
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Passkey registration */}
      {phase === "passkey_register" && (
        <form onSubmit={handlePasskeyRegister} className="space-y-4">
          <div>
            <label
              htmlFor="passkey-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Passkey name
            </label>
            <input
              id="passkey-name"
              type="text"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              placeholder="e.g. MacBook Touch ID"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-500 focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gray-800 dark:bg-gray-700 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Fingerprint className="w-5 h-5" />
            {isLoading ? "Registering..." : "Register passkey"}
          </button>
          <button
            type="button"
            onClick={() => setPhase("choose")}
            className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1 transition-colors"
          >
            Back
          </button>
        </form>
      )}

      {/* TOTP QR code */}
      {phase === "totp_qr" && (
        <div className="space-y-4">
          <div className="flex justify-center">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpQrUri)}`}
              alt="TOTP QR Code"
              className="w-48 h-48 rounded-lg border border-gray-200 dark:border-gray-700"
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Or enter this secret manually:
            </p>
            <code className="block w-full p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs text-gray-700 dark:text-gray-300 font-mono text-center break-all select-all">
              {totpSecret}
            </code>
          </div>
          <button
            type="button"
            onClick={() => setPhase("totp_verify")}
            className="w-full bg-gray-800 dark:bg-gray-700 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            Next
          </button>
          <button
            type="button"
            onClick={() => setPhase("choose")}
            className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1 transition-colors"
          >
            Back
          </button>
        </div>
      )}

      {/* TOTP verify */}
      {phase === "totp_verify" && (
        <form onSubmit={handleTotpVerify} className="space-y-4">
          <div>
            <input
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="000000"
              className="w-full px-3 py-3 text-center text-lg tracking-widest border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-500 focus:border-transparent font-mono"
              autoFocus
              required
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !totpCode}
            className="w-full bg-gray-800 dark:bg-gray-700 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <KeyRound className="w-5 h-5" />
            {isLoading ? "Verifying..." : "Verify and activate"}
          </button>
          <button
            type="button"
            onClick={() => setPhase("totp_qr")}
            className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1 transition-colors"
          >
            Back
          </button>
        </form>
      )}

      {/* Recovery codes */}
      {phase === "recovery_codes" && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-1">
              Important
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              These codes can be used to access your account if you lose your
              2FA device. Each code can only be used once. Store them somewhere
              safe.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            {recoveryCodes.map((code, i) => (
              <code
                key={i}
                className="text-sm font-mono text-gray-700 dark:text-gray-300"
              >
                {code}
              </code>
            ))}
          </div>
          <button
            type="button"
            onClick={handleCopyCodes}
            className="w-full border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 py-2 px-4 rounded-xl font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {copied ? "Copied" : "Copy codes"}
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="w-full bg-gray-800 dark:bg-gray-700 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- AdminLoginPage ---------- */
export function AdminLoginPage() {
  const { authStep, isAuthenticated } = useAdminAuth();
  const navigate = useNavigate();

  // If already authenticated, redirect
  if (isAuthenticated && authStep === "authenticated") {
    navigate("/admin", { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-gray-800" />
          </div>
          <h1 className="text-xl font-bold text-white">Eulesia Admin</h1>
          <p className="text-sm text-gray-400 mt-1">Operator login</p>
        </div>

        {authStep === "idle" && <PasswordStep />}
        {authStep === "totp_required" && <TotpStep />}
        {authStep === "setup_required" && <SetupStep />}

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Looking for Eulesia?{" "}
            <a
              href="https://eulesia.org"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              Go to eulesia.org
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
