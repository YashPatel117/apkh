import { API_URL } from "@/services/axios";
import { clearToken } from "@/services/session";

/** An HTTP error from a streaming endpoint, shaped like an axios error for getErrorMessage. */
export class StreamHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StreamHttpError";
  }
}

/**
 * POSTs to a server-sent-events endpoint and calls `onEvent` with each JSON
 * event as it arrives. Resolves when the stream ends; abort with `signal`.
 */
export async function streamPost<T>(path: string, body: unknown, onEvent: (event: T) => void, signal?: AbortSignal) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new StreamHttpError("Can't reach the server. Check that the API is running.", 0);
  }

  if (response.status === 401) {
    clearToken();
    window.location.href = "/login?expired=1";
    throw new StreamHttpError("Your session expired.", 401);
  }
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new StreamHttpError(typeof message === "string" && message ? message : "Something went wrong. Please try again.", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = message
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as T);
    }
  }
}
