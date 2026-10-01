// "Connect OpenRouter": OpenRouter's OAuth (PKCE) flow. The user signs in on
// openrouter.ai, approves the app, and OpenRouter returns a code that is
// exchanged here for an API key of their own, so nothing has to be copied.
// https://openrouter.ai/docs/use-cases/oauth-pkce

const AUTH_URL = "https://openrouter.ai/auth";
const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
const VERIFIER_KEY = "openrouter_code_verifier";

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Where OpenRouter sends the user back, with ?code=… appended. */
export function openrouterCallbackUrl() {
  return `${window.location.origin}/profile`;
}

/** Sends the user to OpenRouter to sign in and approve a key for this app. */
export async function startOpenrouterConnect() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  // The verifier must survive the round trip through openrouter.ai
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    callback_url: openrouterCallbackUrl(),
    code_challenge: base64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

/**
 * The code OpenRouter returned, if this page load is the end of a connect
 * started in this tab; it is removed from the address bar either way.
 */
export function takeOpenrouterCallback(): { code: string; verifier: string } | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;
  url.searchParams.delete("code");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);

  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem(VERIFIER_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
  } catch {}
  return verifier ? { code, verifier } : null;
}

/** Exchanges the code for the user's OpenRouter API key. */
export async function exchangeOpenrouterCode(code: string, verifier: string): Promise<string> {
  const res = await fetch(KEYS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  const data = (await res.json().catch(() => ({}))) as { key?: string; error?: { message?: string } };
  if (!res.ok || !data.key) throw new Error(data.error?.message || "OpenRouter didn't return a key. Please connect again.");
  return data.key;
}
