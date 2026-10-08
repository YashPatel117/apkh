import { webApi } from "@/services/axios";

/** notes:write adds notes; notes:read reads and searches them (AI assistants over MCP) */
export type TokenScope = "notes:write" | "notes:read";

export interface IntegrationToken {
  id: string;
  name: string;
  prefix: string;
  scopes: TokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface Inbox {
  /** null until the server has an inbound email domain configured */
  address: string | null;
  webhookUrl: string;
}

export interface Integrations {
  tokens: IntegrationToken[];
  inbox: Inbox | null;
  inboundDomain: string | null;
}

export async function getIntegrations() {
  const res = await webApi.get("/integrations");
  return res.data.data as Integrations;
}

/** The token is in the response this once; it can't be shown again. */
export async function createIntegrationToken(name: string, scopes: TokenScope[] = ["notes:write"]) {
  const res = await webApi.post("/integrations/tokens", { name, scopes });
  return res.data.data as { id: string; name: string; scopes: TokenScope[]; token: string };
}

export async function revokeIntegrationToken(id: string) {
  await webApi.delete(`/integrations/tokens/${id}`);
}

/** Creates the email inbox, or replaces it (the old address stops working). */
export async function rotateInbox() {
  const res = await webApi.post("/integrations/inbox");
  return res.data.data as Inbox;
}

export async function removeInbox() {
  await webApi.delete("/integrations/inbox");
}
