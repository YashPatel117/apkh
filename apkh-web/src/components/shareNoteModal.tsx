"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Globe, Link2Off, RefreshCw } from "lucide-react";
import { createNoteShare, getNoteShare, NoteShare, revokeNoteShare, shareUrl } from "@/services/shareService";
import { getErrorMessage } from "@/services/axios";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n";

const EXPIRY_OPTIONS = [null, 1, 7, 30] as const;

interface ShareNoteModalProps {
  noteId: string;
  noteTitle: string;
  open: boolean;
  onClose: () => void;
}

/** A read-only link to one note: make it, copy it, replace it or stop it working. */
export function ShareNoteModal({ noteId, noteTitle, open, onClose }: ShareNoteModalProps) {
  const { t, language } = useI18n();
  const toast = useToast();
  const [share, setShare] = useState<NoteShare | null | undefined>(undefined);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setShare(undefined);
    getNoteShare(noteId)
      .then((current) => !cancelled && setShare(current))
      .catch((error) => {
        if (cancelled) return;
        setShare(null);
        toast(getErrorMessage(error, t("share.loadFailed")), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, noteId, toast, t]);

  const create = async () => {
    setBusy("create");
    try {
      setShare(await createNoteShare(noteId, expiresInDays));
      setCopied(false);
    } catch (error) {
      toast(getErrorMessage(error, t("share.createFailed")), "error");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    try {
      await revokeNoteShare(noteId);
      setShare(null);
      toast(t("share.revoked"), "success");
    } catch (error) {
      toast(getErrorMessage(error, t("share.revokeFailed")), "error");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t("links.copyFailed"), "error");
    }
  };

  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const expiryLabel = (days: number | null) => (days === null ? t("share.never") : t("share.days", { count: days }));

  const expiryPicker = (
    <label className="block">
      <span className="text-sm font-medium text-fg">{share ? t("share.newLinkExpiry") : t("share.expiry")}</span>
      <select
        className={cn(fieldClass, "mt-1.5 cursor-pointer")}
        value={expiresInDays ?? ""}
        onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : null)}
        disabled={Boolean(busy)}
      >
        {EXPIRY_OPTIONS.map((days) => (
          <option key={days ?? "never"} value={days ?? ""}>
            {expiryLabel(days)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Modal open={open} onClose={onClose} locked={Boolean(busy)} size="sm" title={t("share.title")} description={noteTitle || t("ai.untitled")}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 sm:px-6">
        {share === undefined ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5 text-accent" />
          </div>
        ) : share ? (
          <>
            <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-3.5 text-sm text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200">
              <Globe className="mt-0.5 size-4 shrink-0" />
              <p>{t("share.live")}</p>
            </div>
            <div className="flex gap-2">
              <input readOnly value={shareUrl(share.token)} onFocus={(e) => e.target.select()} className={cn(fieldClass, "min-w-0 flex-1 font-mono text-xs")} aria-label={t("share.link")} />
              <Button variant="secondary" onClick={() => void copy(shareUrl(share.token))} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
                {copied ? t("share.copied") : t("share.copy")}
              </Button>
            </div>
            <p className="text-xs text-fg-muted">
              {share.expiresAt ? t("share.expiresOn", { date: dateFormat.format(new Date(share.expiresAt)) }) : t("share.noExpiry")}
              {" · "}
              {t("share.views", { count: share.views })}
            </p>
            <div className="border-t border-line pt-4">{expiryPicker}</div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost-danger" onClick={() => void revoke()} loading={busy === "revoke"} disabled={Boolean(busy)} icon={<Link2Off className="size-4" />}>
                {t("share.revoke")}
              </Button>
              <Button variant="secondary" onClick={() => void create()} loading={busy === "create"} disabled={Boolean(busy)} icon={<RefreshCw className="size-4" />}>
                {t("share.replace")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-muted">{t("share.intro")}</p>
            {expiryPicker}
            <div className="flex justify-end">
              <Button onClick={() => void create()} loading={busy === "create"} icon={<Globe className="size-4" />}>
                {t("share.create")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
