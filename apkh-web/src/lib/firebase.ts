import { localized } from "@/lib/localizedError";
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** "Continue with Google" shows only when the Firebase web config is set. */
export const GOOGLE_SIGN_IN_ENABLED = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

/** Errors that mean the user closed or replaced the popup, not that sign-in failed. */
const DISMISSED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

/**
 * Opens Google's sign-in popup and returns the Firebase ID token for the API
 * to verify, or null when the user closes the popup. Firebase loads only here,
 * so it stays out of every other page's bundle.
 */
export async function googleIdToken(): Promise<string | null> {
  const [{ getApps, initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps()[0] ?? initializeApp(config);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const { user } = await signInWithPopup(getAuth(app), provider);
    return await user.getIdToken();
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (DISMISSED.has(code)) return null;
    // The message is English; `messageKey` lets the sign-in button show it in the app's language.
    if (code === "auth/popup-blocked") throw localized("Your browser blocked the Google popup. Allow popups and try again.", "auth.popupBlocked");
    if (code === "auth/unauthorized-domain") {
      const host = window.location.hostname;
      throw localized(`${host} isn't an authorized domain in Firebase Authentication settings.`, "auth.unauthorizedDomain", { host });
    }
    throw localized("Google sign-in failed. Please try again.", "auth.googleFailed");
  }
}
