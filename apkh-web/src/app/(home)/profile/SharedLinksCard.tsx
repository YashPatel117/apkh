"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Globe, Link2Off } from "lucide-react";
import { getNoteShares, NoteShare, revokeNoteShare, shareUrl } from "@/services/shareService";
import { getErrorMessage } from "@/services/axios";
import { noteHref } from "@/lib/noteLinks";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/i18n";

/** Every note shared by link, to copy a link again or stop one working. */
export default function SharedLinksCard() {
  const { t, language } = useI18n();
  const toast = useToast();
  const [shares, setShares] = useState<NoteShare[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    getNoteShares()
      .then(setShares)
      .catch(() => setShares([]));
  }, []);
  useEffect(load, [load]);

  const revoke = async (noteId: string) => {
    setRevoking(noteId);
    try {
      await revokeNoteShare(noteId);
      setShares((prev) => prev?.filter((s) => s.noteId !== noteId) ?? null);
      toast(t("share.revoked"), "success");
    } catch (error) {
      toast(getErrorMessage(error, t("share.revokeFailed")), "error");
    } finally {
      setRevoking(null);
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast(t("links.copyFailed"), "error");
    }
  };

  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium" });

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Globe className="size-[1.1rem]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">{t("share.cardTitle")}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{t("share.cardText")}</p>
        </div>
      </div>

      {shares === null ? (
        <Spinner className="mt-4 size-4 text-accent" />
      ) : shares.length === 0 ? (
        <p className="mt-4 text-sm text-fg-subtle">{t("share.none")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {shares.map((share) => (
            <li key={share.noteId} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <Link href={noteHref(share.noteId)} className="block truncate text-sm font-medium text-fg hover:text-accent">
                  {share.noteTitle || t("ai.untitled")}
                </Link>
                <p className="truncate text-xs text-fg-subtle">
                  {share.expiresAt ? t("share.expiresOn", { date: dateFormat.format(new Date(share.expiresAt)) }) : t("share.noExpiry")}
                  {" · "}
                  {t("share.views", { count: share.views })}
                </p>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => void copy(share.token)} aria-label={t("share.copy")}>
                {copied === share.token ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost-danger"
                onClick={() => void revoke(share.noteId)}
                disabled={revoking === share.noteId}
                aria-label={t("share.revoke")}
              >
                {revoking === share.noteId ? <Spinner className="size-4" /> : <Link2Off className="size-4" />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
