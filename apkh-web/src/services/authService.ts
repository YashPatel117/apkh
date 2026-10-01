import axios from "axios"; // use plain axios for login (no interceptor)
import { API_URL, webApi } from "@/services/axios";
import { ILlmModel, IUser, LlmProvider } from "@/models/user";

// Login (no interceptor)
export async function login(email: string, password: string) {
  const res = await axios.post(`${API_URL}/auth/login`, {
    email,
    password,
  });
  localStorage.setItem("token", res.data.data);
  return res.data;
}

/** Signs in (or up) with a Firebase ID token from Google's popup (no interceptor). */
export async function loginWithGoogle(idToken: string) {
  const res = await axios.post(`${API_URL}/auth/google`, { idToken });
  localStorage.setItem("token", res.data.data);
  return res.data;
}

// Profile (uses interceptor → token auto-attached)
export async function profile() {
  const res = await webApi.get("/users/profile");
  return res.data;
}

/** Registers and signs the user in (the API returns a token on success). */
export async function register(data: { name: string; email: string; password: string }) {
  const res = await axios.post(`${API_URL}/auth/register`, data);
  const token = res.data?.data;
  if (typeof token !== "string") {
    throw new Error(res.data?.message || "Registration failed. Please check your details.");
  }
  localStorage.setItem("token", token);
  return res.data;
}

export async function resetPassword(data: {
  email: string;
  currentPassword: string;
  password: string;
}) {
  const res = await axios.post(`${API_URL}/auth/reset-password`, data);
  return res.data;
}

/**
 * Where the API key comes from: a key typed in the form, or the saved key of
 * an existing config (by keyName) when only its model is being changed.
 */
type LlmKeySource = { apiKey?: string; keyName?: string };

/** Test an API key + model without saving */
export async function testLlmSettings(data: LlmKeySource & { model: string }) {
  const res = await webApi.post("/users/llm-settings/test", data);
  return res.data as { ok: boolean; error: string | null; provider?: string };
}

/** List the chat models the key can use, fetched live from the provider */
export async function listLlmModels(data: LlmKeySource & { provider: LlmProvider }) {
  const res = await webApi.post("/users/llm-settings/models", data);
  return res.data as { ok: boolean; error: string | null; models: ILlmModel[] };
}

/** Add (or update) a named LLM config. Leave apiKey out to keep a saved config's key. */
export async function addLlmConfig(data: {
  keyName: string;
  apiKey?: string;
  model: string;
  setActive?: boolean;
}) {
  const res = await webApi.post("/users/llm-configs", data);
  return res.data as IUser;
}

/** Set an existing config as active */
export async function activateLlmConfig(keyName: string) {
  const res = await webApi.patch(`/users/llm-configs/${encodeURIComponent(keyName)}/activate`);
  return res.data as IUser;
}

/** Redeem a one-time "XXXX-XXXX" code for the Pro plan */
export async function redeemVoucher(code: string) {
  const res = await webApi.post("/users/plan/redeem", { code });
  return res.data as IUser;
}

/** Use the built-in AI instead of a saved config */
export async function switchToBuiltinAi() {
  const res = await webApi.post("/users/llm-configs/use-builtin");
  return res.data as IUser;
}

/** Delete a named config */
export async function deleteLlmConfig(keyName: string) {
  const res = await webApi.delete(`/users/llm-configs/${encodeURIComponent(keyName)}`);
  return res.data as IUser;
}
