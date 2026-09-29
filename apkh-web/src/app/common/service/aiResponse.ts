import { AiSearchResponse } from "@/service/noteService";

export function cleanAiErrorMessage(message: string) {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (
    lower.includes("api key not found") ||
    lower.includes("api_key_invalid") ||
    lower.includes("invalid api key")
  ) {
    return "Invalid API key for your active AI config. Update it in Profile and test the connection again.";
  }

  const singleQuotedMessage = trimmed.match(/'message':\s*'([^']+)'/);
  if (singleQuotedMessage?.[1]) return singleQuotedMessage[1].trim();

  const doubleQuotedMessage = trimmed.match(/"message"\s*:\s*"([^"]+)"/);
  if (doubleQuotedMessage?.[1]) return doubleQuotedMessage[1].trim();

  return trimmed;
}

function looksLikeAiFailureMessage(message: string) {
  const lower = message.toLowerCase();

  return (
    lower.includes("api key is invalid") ||
    lower.includes("api key not found") ||
    lower.includes("api_key_invalid") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_argument") ||
    lower.includes("embedding request failed") ||
    lower.includes("provider request failed") ||
    lower.includes("cannot be used for semantic search") ||
    lower.includes("add an active api key")
  );
}

export function isAiErrorResponse(response: AiSearchResponse | null | undefined) {
  if (!response) return false;

  // Primary contract: backend explicitly marks guidance/failures as errors.
  if (response.isError) return true;
  if (response.answer && looksLikeAiFailureMessage(response.answer)) return true;

  // Backward-compatible fallback for older backend responses.
  return response.confidence === "not_found" && (response.references?.length ?? 0) === 0;
}

/** Strips HTML to searchable plain text. */
export function htmlToText(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
