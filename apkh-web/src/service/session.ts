import { jwtDecode } from "jwt-decode";

const TOKEN_KEY = "token";

/** Returns the stored JWT if present and unexpired; clears it otherwise. */
export function getValidToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const { exp } = jwtDecode(token);
    if (exp && exp < Date.now() / 1000) {
      clearToken();
      return null;
    }
    return token;
  } catch {
    clearToken();
    return null;
  }
}

export function clearToken() {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY);
}
