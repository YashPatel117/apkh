import axios from "axios"; // use plain axios for login (no interceptor)
import { webApi } from "./axios/axios";
import { IUser } from "@/app/common/models/user";

// Login (no interceptor)
export async function login(email: string, password: string) {
  const res = await axios.post("http://localhost:3000/auth/login", {
    email,
    password,
  });
  localStorage.setItem("token", res.data.data);
  return res.data;
}

// Profile (uses interceptor → token auto-attached)
export async function profile() {
  const res = await webApi.get("/users/profile");
  return res.data;
}

export async function register(data: { name: string; email: string; password: string }) {
  const res = await axios.post("http://localhost:3000/auth/register", data);
  return res.data;
}

export async function resetPassword(data: { email: string; password: string }) {
  const res = await axios.post("http://localhost:3000/auth/reset-password", data);
  return res.data;
}

/** Test an API key + model without saving */
export async function testLlmSettings(data: { apiKey: string; model: string }) {
  const res = await webApi.post("/users/llm-settings/test", data);
  return res.data as { ok: boolean; error: string | null; provider?: string };
}

/** Add (or update) a named LLM config */
export async function addLlmConfig(data: {
  keyName: string;
  apiKey: string;
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

/** Delete a named config */
export async function deleteLlmConfig(keyName: string) {
  const res = await webApi.delete(`/users/llm-configs/${encodeURIComponent(keyName)}`);
  return res.data as IUser;
}
