const en = {
  "notes.missing": "That note no longer exists.",
  "editor.updated": "Note updated.",
  "editor.created": "Note created. Indexing for AI search…",
  "offline.attachmentsNeedConnection": "Attachments need a connection. Try again when you're back online.",
  "offline.savedForLater": "You're offline. The note is saved and will sync when you reconnect.",
  "ai.failed": "AI search failed. Please try again.",
  "ai.continueFailed": "Couldn't start the conversation.",
};
export type MessageKey = keyof typeof en;
export default en;
