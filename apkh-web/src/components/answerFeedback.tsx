"use client";

import { useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { AnswerFeedbackInput, sendAnswerFeedback } from "@/services/feedbackService";
import { getErrorMessage } from "@/services/axios";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

/**
 * "Was this helpful?" for one AI answer. A thumbs-down asks what was wrong
 * (optional); the vote is kept with the question and answer for review.
 */
export function AnswerFeedback({ answer, compact = false }: { answer: Omit<AnswerFeedbackInput, "helpful" | "comment">; compact?: boolean }) {
  const t = useT();
  const toast = useToast();
  const [vote, setVote] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [thanked, setThanked] = useState(false);

  const send = async (helpful: boolean, note?: string) => {
    setSending(true);
    try {
      await sendAnswerFeedback({ ...answer, helpful, comment: note });
      setVote(helpful);
      setAsking(!helpful && note === undefined);
      if (helpful || note !== undefined) setThanked(true);
    } catch (error) {
      toast(getErrorMessage(error, t("feedback.failed")), "error");
    } finally {
      setSending(false);
    }
  };

  const thumb = (helpful: boolean) => {
    const Icon = helpful ? ThumbsUp : ThumbsDown;
    const active = vote === helpful;
    return (
      <button
        type="button"
        onClick={() => void send(helpful)}
        disabled={sending}
        aria-pressed={active}
        aria-label={helpful ? t("feedback.helpful") : t("feedback.notHelpful")}
        title={helpful ? t("feedback.helpful") : t("feedback.notHelpful")}
        className={cn(
          "flex cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-wait",
          compact ? "size-7" : "size-8",
          active
            ? helpful
              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
              : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
            : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
        )}
      >
        <Icon className={compact ? "size-3.5" : "size-4"} />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {!compact && <span className="mr-1 text-xs text-fg-subtle">{thanked ? t("feedback.thanks") : t("feedback.question")}</span>}
        {thumb(true)}
        {thumb(false)}
        {compact && thanked && <Check className="ml-1 size-3.5 text-emerald-500" aria-label={t("feedback.thanks")} />}
      </div>
      {asking && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send(false, comment);
          }}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder={t("feedback.whatWrong")}
            aria-label={t("feedback.whatWrong")}
            className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" type="submit" loading={sending}>
              {t("feedback.send")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t("feedback.skip")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
