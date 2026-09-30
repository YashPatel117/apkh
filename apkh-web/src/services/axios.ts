import axios, { AxiosInstance } from "axios";
import { clearToken } from "@/services/session";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
export const STORAGE_URL = process.env.NEXT_PUBLIC_STORAGE_URL ?? "http://localhost:3001";

const webApi = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

const storageApi = axios.create({
  baseURL: STORAGE_URL,
  withCredentials: true,
});

const AUTH_PAGES = ["/login", "/register", "/reset-password"];

function requestInterceptor(apiInstance: AxiosInstance) {
  apiInstance.interceptors.request.use(
    (config) => {
      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null;
      if (token && config.url !== "/auth/login") {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );
}

function responseInterceptor(apiInstance: AxiosInstance) {
  apiInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401 && typeof window !== "undefined") {
        // Drop the rejected token first — otherwise /login sees a "valid"
        // token and bounces straight back, looping forever.
        clearToken();
        if (!AUTH_PAGES.includes(window.location.pathname)) {
          window.location.href = "/login?expired=1";
        }
      }
      return Promise.reject(error);
    }
  );
}

requestInterceptor(webApi);
responseInterceptor(webApi);

requestInterceptor(storageApi);
responseInterceptor(storageApi);

/** Best-effort human message from an API / network error. */
export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (axios.isAxiosError(error)) {
    if (!error.response) return "Can't reach the server. Check that the API is running.";
    const data = error.response.data as { message?: unknown; detail?: unknown } | undefined;
    const message = data?.message ?? data?.detail;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export { webApi, storageApi };
