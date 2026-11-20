"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, LogOut, Sparkles, UserPlus, X } from "lucide-react";
import type { IFolder } from "@/models/note";
import {
  changeMemberRole,
  FolderMember,
  getFolderMembers,
  inviteToFolder,
  leaveFolder,
  MemberRole,
  removeMember,
} from "@/services/collabService";
import { getErrorMessage } from "@/services/axios";
import { Avatar } from "@/components/sidebar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { fieldClass, SelectBox } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { SHARES_CHANGED_EVENT } from "@/hooks/useRealtime";
import { folderRole } from "@/lib/sharing";
import { cn } from "@/lib/cn";
import { useAppSelector } from "@/store/hook";
import { useT } from "@/i18n";

interface ShareFolderModalProps {
  folder: IFolder;
  open: boolean;
  onClose: () => void;
  /** After leaving, e.g. to stop showing the folder's notes */
  onLeft?: () => void;
}

/**
 * Who a folder is shared with. The owner invites people by email (they accept
 * in the app), changes roles and removes people; members see who has access
 * and can leave.
 */
export function ShareFolderModal({ folder, open, onClose, onLeft }: ShareFolderModalProps) {
  const t = useT();
  const toast = useToast();
  const me = useAppSelector((state) => state.auth.user?.id);
  const isOwner = folderRole(folder) === "owner";
  const [members, setMembers] = useState<FolderMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers(await getFolderMembers(folder.id));
    } catch (error) {
      setMembers([]);
      toast(getErrorMessage(error, t("collab.loadFailed")), "error");
    }
  }, [folder.id, toast, t]);

  useEffect(() => {
    if (!open) return;
    setMembers(null);
    void load();
    // Someone accepted, left or was removed elsewhere.
    const onChange = () => void load();
    window.addEventListener(SHARES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SHARES_CHANGED_EVENT, onChange);
  }, [open, load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy("invite");
    try {
      const member = await inviteToFolder(folder.id, { email: email.trim(), role });
      toast(t("collab.invited", { name: member.name || member.email }), "success");
      setEmail("");
      await load();
    } catch (error) {
      toast(getErrorMessage(error, t("collab.inviteFailed")), "error");
    } finally {
      setBusy(null);
    }
  };

  const setMemberRole = async (member: FolderMember, next: MemberRole) => {
    setBusy(member.userId);
    try {
      await changeMemberRole(folder.id, member.userId, next);
      setMembers((list) => list?.map((m) => (m.userId === member.userId ? { ...m, role: next } : m)) ?? list);
    } catch (error) {
      toast(getErrorMessage(error, t("collab.roleFailed")), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (member: FolderMember) => {
    setBusy(member.userId);
    try {
      await removeMember(folder.id, member.userId);
      setMembers((list) => list?.filter((m) => m.userId !== member.userId) ?? list);
    } catch (error) {
      toast(getErrorMessage(error, t("collab.removeFailed")), "error");
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    try {
      await leaveFolder(folder.id);
      toast(t("folders.left"), "success");
      onLeft?.();
      onClose();
    } catch (error) {
      toast(getErrorMessage(error, t("folders.leaveFailed")), "error");
      throw error;
    }
  };

  const roleLabel = (r: FolderMember["role"]) => (r === "owner" ? t("collab.owner") : r === "editor" ? t("collab.editor") : t("collab.viewer"));
  const ownerName = folder.ownerName || members?.find((m) => m.role === "owner")?.name || "";

  return (
    <Modal open={open} onClose={onClose} locked={busy === "invite"} size="md" title={t("collab.title", { name: folder.name })}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 sm:px-6">
        {isOwner ? (
          <>
            <p className="text-sm text-fg-muted">{t("collab.intro")}</p>
            <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
              <label className="min-w-0 flex-1">
                <span className="sr-only">{t("collab.email")}</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("collab.emailPlaceholder")}
                  autoComplete="off"
                  className={cn(fieldClass, "h-11")}
                  disabled={busy === "invite"}
                />
              </label>
              <label>
                <span className="sr-only">{t("collab.role")}</span>
                <SelectBox
                  value={role}
                  onChange={(v) => setRole(v as MemberRole)}
                  className="sm:w-36"
                  disabled={busy === "invite"}
                  aria-label={t("collab.role")}
                  options={[
                    { value: "editor", label: t("collab.editor") },
                    { value: "viewer", label: t("collab.viewer") },
                  ]}
                />
              </label>
              <Button type="submit" size="toolbar" loading={busy === "invite"} icon={<UserPlus className="size-4" />}>
                {t("collab.invite")}
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            {folderRole(folder) === "editor" ? t("collab.memberIntroEditor", { owner: ownerName }) : t("collab.memberIntroViewer", { owner: ownerName })}
          </p>
        )}

        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-fg-subtle uppercase">{t("collab.people")}</h3>
          {members === null ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5 text-accent" />
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {members.map((member) => (
                <li key={member.userId} className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar name={member.name || member.email} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {member.name || member.email}
                      {member.userId === me && <span className="font-normal text-fg-subtle"> ({t("collab.you")})</span>}
                    </p>
                    <p className="truncate text-xs text-fg-muted">
                      {member.email}
                      {member.status === "pending" && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">{t("collab.pending")}</span>}
                    </p>
                  </div>
                  {member.role === "owner" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted">
                      <Crown className="size-3.5" /> {t("collab.owner")}
                    </span>
                  ) : isOwner ? (
                    <div className="flex items-center gap-1">
                      <select
                        value={member.role}
                        onChange={(e) => void setMemberRole(member, e.target.value as MemberRole)}
                        disabled={busy === member.userId}
                        aria-label={t("collab.role")}
                        className="h-8 cursor-pointer rounded-lg border border-line bg-surface px-2 text-xs text-fg"
                      >
                        <option value="editor">{t("collab.editor")}</option>
                        <option value="viewer">{t("collab.viewer")}</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void remove(member)}
                        disabled={busy === member.userId}
                        aria-label={member.status === "pending" ? t("collab.withdraw") : t("collab.remove")}
                        title={member.status === "pending" ? t("collab.withdraw") : t("collab.remove")}
                        className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-subtle hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-500/10"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-fg-muted">{roleLabel(member.role)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="flex items-start gap-2 text-xs text-fg-subtle">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" /> {t("collab.aiNote")}
        </p>

        {!isOwner && (
          <div className="flex justify-end border-t border-line pt-4">
            <Button variant="ghost-danger" onClick={() => setConfirmLeave(true)} icon={<LogOut className="size-4" />}>
              {t("folders.leave")}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title={t("folders.leaveTitle")}
        message={t("folders.leaveMessage", { name: folder.name, owner: ownerName })}
        confirmLabel={t("folders.leave")}
        onConfirm={leave}
        onClose={() => setConfirmLeave(false)}
      />
    </Modal>
  );
}
