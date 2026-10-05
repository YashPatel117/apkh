"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { profile } from "@/services/authService";
import { getErrorMessage } from "@/services/axios";
import { AiSearchResponse, aiSearchNotesStream } from "@/services/noteService";
import { createChatSession } from "@/services/chatService";
import { useAppDispatch } from "@/store/hook";
import { setUser } from "@/store/slices/authSlice";
import { addSession, setActiveSession } from "@/store/slices/chatSlice";
import { isAiErrorResponse, cleanAiErrorMessage } from "@/lib/aiResponse";
import { fromAiReference } from "@/components/sources";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n";

/**
 * Asking AI: the answer streams in as the model writes it. `answer` holds
 * what has arrived so far (sources first, then text); `isSearching` stays
 * true until it is complete.
 */
export function useAiSearch() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [answer, setAnswer] = useState<AiSearchResponse | null>(null);
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const failed = !isSearching && isAiErrorResponse(answer);
  const errorMessage = failed && answer?.answer ? cleanAiErrorMessage(answer.answer) : null;

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const clear = useCallback(() => {
    cancel();
    setAnswer(null);
    setIsSearching(false);
    setAnswerOpen(false);
  }, [cancel]);

  const ask = useCallback(
    async (question: string, noteIds: string[]) => {
      cancel();
      const abort = new AbortController();
      controller.current = abort;
      setQuery(question);
      setAnswer(null);
      setIsSearching(true);
      setAnswerOpen(true);

      let text = "";
      const fail = (message: string) =>
        setAnswer({ query: question, answer: message, confidence: "not_found", isError: true, references: [] });
      try {
        await aiSearchNotesStream(
          question,
          noteIds.length ? noteIds : undefined,
          (event) => {
            if (abort.signal.aborted) return;
            if (event.type === "sources") {
              setAnswer({
                query: question,
                answer: "",
                confidence: "medium",
                isError: false,
                references: event.references,
                pendingNotes: event.pendingNotes,
                searchedFor: event.searchedFor,
              });
            } else if (event.type === "token") {
              text += event.text;
              setAnswer((prev) => (prev ? { ...prev, answer: text } : prev));
            } else if (event.type === "done") {
              setAnswer(event.result);
              if (!isAiErrorResponse(event.result)) {
                profile()
                  .then((user) => dispatch(setUser(user)))
                  .catch(() => {});
              }
            } else if (event.type === "error") {
              fail(event.message);
            }
          },
          abort.signal,
        );
      } catch (error) {
        if (!abort.signal.aborted) fail(getErrorMessage(error, t("ai.failed")));
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setIsSearching(false);
        }
      }
    },
    [cancel, dispatch, t],
  );

  /** Carries the answer (and its sources) into a new chat. */
  const continueConversation = useCallback(async () => {
    if (!answer) return false;
    setContinuing(true);
    try {
      const session = await createChatSession(answer.query || query, answer.answer, answer.references.map(fromAiReference));
      dispatch(addSession(session));
      dispatch(setActiveSession(session.id));
      setAnswerOpen(false);
      router.push(`/chat?session=${session.id}`);
      return true;
    } catch (error) {
      toast(getErrorMessage(error, t("ai.continueFailed")), "error");
      return false;
    } finally {
      setContinuing(false);
    }
  }, [answer, query, dispatch, router, toast, t]);

  return {
    answer,
    query,
    isSearching,
    failed,
    errorMessage,
    answerOpen,
    setAnswerOpen,
    continuing,
    ask,
    clear,
    /** Drops a finished answer when a new question is typed (not while one streams). */
    resetAnswer: useCallback(() => setAnswer((prev) => (prev && !controller.current ? null : prev)), []),
    continueConversation,
  };
}
