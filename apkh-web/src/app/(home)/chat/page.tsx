"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { ArrowLeft, ArrowUp, MessagesSquare, Search, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { getChatMessages, sendChatMessage, deleteChatSession, IChatMessage, IChatSession } from "@/service/chatService";
import { getErrorMessage } from "@/service/axios/axios";
import {
  setActiveSession,
  setMessages,
  addMessage,
  removeMessage,
  removeSession,
  updateSessionTime,
} from "@/store/slices/chatSlice";
import { useNotes } from "@/app/common/context/notesContext";
import { Avatar } from "@/app/common/components/sidebar";
import { LogoMark } from "@/app/common/ui/Logo";
import { Button } from "@/app/common/ui/Button";
import { Spinner } from "@/app/common/ui/Spinner";
import { ConfirmDialog } from "@/app/common/ui/ConfirmDialog";
import { useToast } from "@/app/common/ui/Toast";
import { cn } from "@/app/common/ui/cn";

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default function ChatPage() {
  const dispatch = useAppDispatch();
  const { sessions, activeSessionId, messages } = useAppSelector((state) => state.chat);
  const user = useAppSelector((state) => state.auth.user);
  const { focusSearch } = useNotes();
  const toast = useToast();

  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [fetchingMessages, setFetchingMessages] = useState(false);
  const [mobileShowList, setMobileShowList] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<IChatSession | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef(activeSessionId);
  activeRef.current = activeSessionId;

  const currentSession = sessions.find((s) => s.id === activeSessionId);

  // Pick the most recent conversation if none is selected (or the selected one vanished).
  useEffect(() => {
    if (sessions.length && (!activeSessionId || !currentSession)) {
      dispatch(setActiveSession(sessions[0].id));
    }
  }, [sessions, activeSessionId, currentSession, dispatch]);

  // Load messages when the active session changes.
  useEffect(() => {
    let mounted = true;
    if (!activeSessionId) {
      dispatch(setMessages([]));
      return;
    }
    setFetchingMessages(true);
    dispatch(setMessages([]));
    getChatMessages(activeSessionId)
      .then((fetched) => mounted && dispatch(setMessages(fetched)))
      .catch((err) => mounted && toast(getErrorMessage(err, "Couldn't load this conversation."), "error"))
      .finally(() => mounted && setFetchingMessages(false));
    return () => {
      mounted = false;
    };
  }, [activeSessionId, dispatch, toast]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  // Auto-grow the composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [inputValue]);

  const handleSendMessage = async () => {
    const content = inputValue.trim();
    if (!content || !activeSessionId || isSending) return;
    const sessionId = activeSessionId;
    setInputValue("");

    const tempId = `temp-${Date.now()}`;
    dispatch(addMessage({ id: tempId, sessionId, role: "user", content, createdAt: new Date().toISOString() }));

    setIsSending(true);
    try {
      const response = await sendChatMessage(sessionId, content);
      dispatch(updateSessionTime(sessionId));
      // Only append if the user is still looking at this conversation.
      if (activeRef.current === sessionId) {
        dispatch(
          addMessage({ id: `ai-${Date.now()}`, sessionId, role: "assistant", content: response.answer, createdAt: new Date().toISOString() }),
        );
      }
    } catch (err) {
      dispatch(removeMessage(tempId));
      setInputValue((v) => v || content);
      toast(getErrorMessage(err, "Message failed to send."), "error");
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteChatSession(pendingDelete.id);
      dispatch(removeSession(pendingDelete.id));
      toast("Conversation deleted.", "success");
    } catch (err) {
      toast(getErrorMessage(err, "Couldn't delete the conversation."), "error");
      throw err;
    }
  };

  const selectSession = (id: string) => {
    dispatch(setActiveSession(id));
    setMobileShowList(false);
  };

  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm animate-rise text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <MessagesSquare className="size-6" />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-fg">No conversations yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Ask AI a question from the search bar, then choose <span className="font-semibold text-fg">Continue this conversation</span>{" "}
            to keep chatting here with full context.
          </p>
          <Button className="mt-6" onClick={focusSearch} icon={<Search className="size-4" />}>
            Ask a question
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Session list */}
      <aside
        className={cn(
          "min-h-0 w-full shrink-0 flex-col border-r border-line bg-surface/60 md:flex md:w-72",
          mobileShowList ? "flex" : "hidden",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <h2 className="text-sm font-semibold text-fg">Conversations</h2>
          <span className="text-xs text-fg-subtle tabular-nums">{sessions.length}</span>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => selectSession(session.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full cursor-pointer flex-col rounded-xl py-2.5 pr-10 pl-3 text-left transition-colors",
                    active ? "bg-accent-soft" : "hover:bg-surface-2",
                  )}
                >
                  <span className={cn("truncate text-sm font-medium", active ? "text-accent-fg" : "text-fg")}>
                    {session.title || "New chat"}
                  </span>
                  <span className="mt-0.5 text-xs text-fg-subtle">
                    {dayFormat.format(new Date(session.updatedAt))} · {session.messageCount} messages
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(session)}
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-fg-subtle opacity-100 transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                  aria-label={`Delete conversation ${session.title}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Conversation */}
      <section className={cn("min-h-0 min-w-0 flex-1 flex-col", mobileShowList ? "hidden md:flex" : "flex")}>
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/60 px-3 backdrop-blur sm:px-5">
          <button
            type="button"
            onClick={() => setMobileShowList(true)}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 md:hidden"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-fg">{currentSession?.title || "Conversation"}</h1>
            <p className="text-xs text-fg-subtle">{messages.length} messages · grounded in your notes</p>
          </div>
          {currentSession && (
            <Button size="icon-sm" variant="ghost" onClick={() => setPendingDelete(currentSession)} aria-label="Delete conversation">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
            {fetchingMessages ? (
              <div className="flex justify-center py-16 text-fg-subtle">
                <Spinner />
              </div>
            ) : (
              messages.map((msg, idx) => <MessageBubble key={msg.id || idx} message={msg} userName={user?.name ?? ""} />)
            )}
            {isSending && (
              <div className="flex items-start gap-3">
                <LogoMark size={32} className="mt-0.5 rounded-full" />
                <div className="flex gap-1.5 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3.5" aria-label="Assistant is typing">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="size-2 animate-bounce rounded-full bg-fg-subtle" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-surface/60 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendMessage();
            }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-surface p-2 pl-4 shadow-sm transition focus-within:border-accent focus-within:ring-4 focus-within:ring-indigo-500/15"
          >
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendMessage();
                }
              }}
              placeholder="Ask a follow-up question…"
              rows={1}
              aria-label="Message"
              className="max-h-44 min-h-10 flex-1 resize-none bg-transparent py-2 text-[0.95rem] text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none"
            />
            <Button type="submit" size="icon" disabled={!inputValue.trim() || isSending} aria-label="Send message">
              <ArrowUp className="size-5" />
            </Button>
          </form>
          <p className="mt-2 text-center text-[0.7rem] text-fg-subtle">
            Enter to send · Shift + Enter for a new line
          </p>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this conversation?"
        message={
          <>
            <span className="font-semibold text-fg">“{pendingDelete?.title || "New chat"}”</span> and all its messages will be
            permanently removed.
          </>
        }
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function MessageBubble({ message, userName }: { message: IChatMessage; userName: string }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-linear-to-br from-blue-600 via-indigo-600 to-violet-600 px-4 py-3 text-white shadow-md shadow-indigo-500/15 sm:max-w-[75%]">
          <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
        <span className="hidden sm:block">
          <Avatar name={userName || "You"} size="sm" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 hidden sm:block">
        <LogoMark size={32} className="rounded-full" />
      </span>
      <div className="min-w-0 max-w-full flex-1 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 sm:max-w-[85%] sm:flex-none">
        <div className="rich-content text-fg">
          <Markdown>{message.content}</Markdown>
        </div>
      </div>
    </div>
  );
}
