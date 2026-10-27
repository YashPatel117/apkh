import { webApi } from "@/services/axios";

export interface AnswerFeedbackInput {
  kind: "search" | "chat";
  /** A chat message id, or answerKeyOf() for an AI search answer */
  answerKey: string;
  helpful: boolean;
  query: string;
  answer: string;
  comment?: string;
  sourceCount: number;
  sessionId?: string;
}

/** Records (or changes) a vote on an AI answer. */
export async function sendAnswerFeedback(input: AnswerFeedbackInput) {
  await webApi.post("/feedback", input);
}

/** A stable key for an answer that has no id of its own (AI search). */
export function answerKeyOf(query: string, answer: string) {
  let hash = 5381;
  for (const char of `${query}\u0000${answer}`) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return `search:${hash.toString(36)}:${answer.length}`;
}
