import { webApi } from "./axios/axios";

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
}

export interface ChatMessageResponse {
  answer: string;
  tokens_used: number;
}

export async function createChatSession(firstMessage: string, aiResponse: string) {
  const res = await webApi.post("/chat/session", { firstMessage, aiResponse });
  return res.data.data as IChatSession;
}

export async function getChatSessions() {
  const res = await webApi.get("/chat/sessions");
  return res.data.data as IChatSession[];
}

export async function getChatMessages(sessionId: string) {
  const res = await webApi.get(`/chat/session/${sessionId}`);
  return res.data.data as IChatMessage[];
}

export async function deleteChatSession(sessionId: string) {
  const res = await webApi.delete(`/chat/session/${sessionId}`);
  return res.data.data;
}

export async function sendChatMessage(sessionId: string, message: string) {
  const res = await webApi.post(`/chat/session/${sessionId}/message`, { message });
  return res.data.data as ChatMessageResponse;
}
