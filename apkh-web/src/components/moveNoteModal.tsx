"use client";

import { useMemo, useState } from "react";
import { Check, Folder, FolderX } from "lucide-react";
import { INote } from "@/models/note";
import { useAppSelector } from "@/store/hook";
import { useFolderActions } from "@/hooks/useFolderActions";
import { flattenTree, folderTree } from "@/lib/folders";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

/** Picks the folder a note is filed in. */
export function MoveNoteModal({ note, open, onClose }: { note: INote; open: boolean; onClose: () => void }) {
  const folders = useAppSelector((state) => state.note.folders);
  const rows = useMemo(() => flattenTree(folderTree(folders)), [folders]);
  const { moveNote } = useFolderActions();
  const [moving, setMoving] = useState<string | null>(null);
  const t = useT();
  const current = note.folderId ?? null;

  const pick = async (folderId: string | null) => {
    setMoving(folderId ?? "root");
    const moved = await moveNote(note.id, folderId);
    setMoving(null);
    if (moved) onClose();
  };

  const option = (id: string | null, name: string, depth: number, Icon: typeof Folder) => {
    const selected = current === id;
    const busy = moving === (id ?? "root");
    return (
      <li key={id ?? "root"}>
        <button
          type="button"
          disabled={Boolean(moving)}
          onClick={() => void pick(id)}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl pr-3 text-left text-sm transition-colors disabled:cursor-wait",
            selected ? "bg-accent-soft font-medium text-accent-fg" : "text-fg hover:bg-surface-2",
          )}
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          <Icon className={cn("size-4 shrink-0", selected ? "text-accent" : "text-fg-subtle")} />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {busy ? <Spinner className="size-4" /> : selected && <Check className="size-4 shrink-0 text-accent" />}
        </button>
      </li>
    );
  };

  return (
    <Modal open={open} onClose={onClose} locked={Boolean(moving)} size="sm" title={t("move.title")} description={note.title || t("ai.untitled")}>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {option(null, t("move.none"), 0, FolderX)}
          {rows.map((folder) => option(folder.id, folder.name, folder.depth, Folder))}
        </ul>
        {rows.length === 0 && (
          <p className="px-3 pt-3 text-sm text-fg-muted">{t("move.empty")}</p>
        )}
      </div>
    </Modal>
  );
}
