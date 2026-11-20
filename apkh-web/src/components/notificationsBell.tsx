"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import {
  answerInvite,
  AppNotification,
  FolderInvite,
  getInvites,
  getNotifications,
  markNotificationsRead,
} from "@/services/collabService";
import { getErrorMessage } from "@/services/axios";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { NOTIFICATIONS_CHANGED_EVENT, SHARES_CHANGED_EVENT } from "@/hooks/useRealtime";
import { refreshLibraryMeta } from "@/hooks/useAuth";
import { useAppDispatch } from "@/store/hook";
import { cn } from "@/lib/cn";
import { MessageKey, useI18n } from "@/i18n";

const TEXT: Record<AppNotification["kind"], MessageKey> = {
  "folder-invite": "notify.invite",
  "invite-accepted": "notify.inviteAccepted",
  "invite-declined": "notify.inviteDeclined",
  "role-changed": "notify.roleChanged",
  "member-removed": "notify.removed",
  "member-left": "notify.left",
  "folder-deleted": "notify.folderDeleted",
};

/**
 * The bell in the sidebar: invites to shared folders (accept or decline right
 * here) and what happened to folders you share. Opening it marks everything read.
 */
export function NotificationsBell() {
  const { t, language } = useI18n();
  const toast = useToast();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [invites, setInvites] = useState<FolderInvite[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, pending] = await Promise.all([getNotifications(), getInvites()]);
      setItems(list.notifications);
      setUnread(list.unread);
      setInvites(pending);
    } catch {
      setItems((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
    window.addEventListener(SHARES_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
      window.removeEventListener(SHARES_CHANGED_EVENT, reload);
    };
  }, [load]);

  const show = () => {
    setOpen(true);
    if (unread) {
      setUnread(0);
      markNotificationsRead().catch(() => {});
    }
  };

  const answer = async (invite: FolderInvite, accept: boolean) => {
    setAnswering(invite.folderId);
    try {
      await answerInvite(invite.folderId, accept);
      setInvites((list) => list.filter((i) => i.folderId !== invite.folderId));
      toast(accept ? t("notify.accepted", { name: invite.folderName }) : t("notify.declined"), "success");
      if (accept) await refreshLibraryMeta(dispatch);
    } catch (error) {
      toast(getErrorMessage(error, t("notify.answerFailed")), "error");
      void load();
    } finally {
      setAnswering(null);
    }
  };

  const pendingFor = (folderId: string | null) => (folderId ? invites.find((i) => i.folderId === folderId) : undefined);
  const roleText = (role: string | null) => (role === "editor" ? t("notify.roleEditor") : t("notify.roleViewer"));
  const when = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  const badge = unread + invites.filter((i) => !items?.some((n) => n.kind === "folder-invite" && n.folderId === i.folderId && !n.read)).length;

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={t("notify.open", { count: badge })}
        title={t("notify.title")}
        className="relative ml-auto flex size-9 cursor-pointer items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Bell className="size-[1.1rem]" />
        {badge > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.6rem] leading-4 font-bold text-white tabular-nums">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} size="sm" title={t("notify.title")}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
          {items === null ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5 text-accent" />
            </div>
          ) : items.length === 0 && invites.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">{t("notify.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {/* Invites whose notification is gone (older than the list) still get answered. */}
              {invites
                .filter((invite) => !items.some((n) => n.kind === "folder-invite" && n.folderId === invite.folderId))
                .map((invite) => (
                  <InviteRow
                    key={`invite-${invite.folderId}`}
                    text={t("notify.invite", { actor: invite.ownerName, folder: invite.folderName, role: roleText(invite.role) })}
                    date={when.format(new Date(invite.invitedAt))}
                    busy={answering === invite.folderId}
                    onAnswer={(accept) => void answer(invite, accept)}
                    acceptLabel={t("notify.accept")}
                    declineLabel={t("notify.decline")}
                  />
                ))}
              {items.map((n) => {
                const text = t(TEXT[n.kind], { actor: n.actorName, folder: n.folderName, role: roleText(n.role) });
                const invite = n.kind === "folder-invite" ? pendingFor(n.folderId) : undefined;
                return invite ? (
                  <InviteRow
                    key={n.id}
                    text={text}
                    date={when.format(new Date(n.createdAt))}
                    busy={answering === invite.folderId}
                    onAnswer={(accept) => void answer(invite, accept)}
                    acceptLabel={t("notify.accept")}
                    declineLabel={t("notify.decline")}
                  />
                ) : (
                  <li key={n.id} className={cn("rounded-2xl px-3.5 py-3 text-sm", n.read ? "text-fg-muted" : "bg-accent-soft/60 text-fg")}>
                    <p>{text}</p>
                    <p className="mt-1 text-xs text-fg-subtle">{when.format(new Date(n.createdAt))}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}

function InviteRow({
  text,
  date,
  busy,
  onAnswer,
  acceptLabel,
  declineLabel,
}: {
  text: string;
  date: string;
  busy: boolean;
  onAnswer: (accept: boolean) => void;
  acceptLabel: string;
  declineLabel: string;
}) {
  return (
    <li className="rounded-2xl border border-indigo-200 bg-accent-soft/60 px-3.5 py-3 text-sm text-fg dark:border-indigo-400/30">
      <p>{text}</p>
      <p className="mt-1 text-xs text-fg-subtle">{date}</p>
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" onClick={() => onAnswer(true)} loading={busy} icon={<Check className="size-3.5" />}>
          {acceptLabel}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onAnswer(false)} disabled={busy} icon={<X className="size-3.5" />}>
          {declineLabel}
        </Button>
      </div>
    </li>
  );
}
