import { SourceRef } from "@/components/sources";
import { webApi } from "@/services/axios";
import { streamPost } from "@/services/sse";

export interface IChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface IChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Assistant messages: the note passages the answer drew on, cited as [n] */
  sources?: SourceRef[];
}

export interface ChatMessageResponse {
  answer: string;
  tokens_used: number;
  sources?: SourceRef[];
  /** The chat's title (set from the first question of a new chat) */
  title?: string;
}

/** An empty conversation, titled after its first question. */
export async function createEmptyChat() {
  const res = await webApi.post("/chat/session", {});
  return res.data.data as IChatSession;
}

/** Starts a conversation from an AI search answer (and the sources it cites). */
export async function createChatSession(firstMessage: string, aiResponse: string, sources: SourceRef[] = []) {
  const res = await webApi.post("/chat/session", {
    firstMessage,
    aiResponse,
    sources: sources.map(({ noteId, noteTitle, sourceType, sourceName, sourcePage, excerpt, cited }) => ({
      noteId,
      noteTitle,
      sourceType,
      sourceName,
      sourcePage,
      excerpt,
      cited: Boolean(cited),
    })),
  });
  return res.data.data as IChatSession;
}

// In-flight requests are shared so simultaneous callers (home + chat layouts,
// React Strict Mode's double-run effects in dev) trigger a single API call.
let sessionsRequest: Promise<IChatSession[]> | null = null;
const messagesRequests = new Map<string, Promise<IChatMessage[]>>();

export function getChatSessions() {
  sessionsRequest ??= webApi
    .get("/chat/sessions")
    .then((res) => res.data.data as IChatSession[])
    .finally(() => (sessionsRequest = null));
  return sessionsRequest;
}

export function getChatMessages(sessionId: string) {
  let request = messagesRequests.get(sessionId);
  if (!request) {
    request = webApi
      .get(`/chat/session/${sessionId}`)
      .then((res) => res.data.data as IChatMessage[])
      .finally(() => messagesRequests.delete(sessionId));
    messagesRequests.set(sessionId, request);
  }
  return request;
}

export async function deleteChatSession(sessionId: string) {
  const res = await webApi.delete(`/chat/session/${sessionId}`);
  return res.data.data;
}

export async function sendChatMessage(sessionId: string, message: string) {
  const res = await webApi.post(`/chat/session/${sessionId}/message`, { message });
  return res.data.data as ChatMessageResponse;
}

/** Streamed reply: the passages found, the answer as it is written, then the saved reply. */
export type ChatStreamEvent =
  | { type: "sources"; sources: SourceRef[] }
  | { type: "token"; text: string }
  | ({ type: "done" } & ChatMessageResponse)
  | { type: "error"; message: string };

export function sendChatMessageStream(
  sessionId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
) {
  return streamPost<ChatStreamEvent>(`/chat/session/${sessionId}/message/stream`, { message }, onEvent, signal);
}
