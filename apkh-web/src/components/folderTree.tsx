"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FolderPlus, FolderX, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useAppSelector } from "@/store/hook";
import { useFolderActions } from "@/hooks/useFolderActions";
import type { FolderFilter } from "@/hooks/useNotesFilter";
import { DRAG_FOLDER, DRAG_NOTE, FolderNode, folderAndDescendants, folderPath, folderTree } from "@/lib/folders";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

const EXPANDED_KEY = "folders-expanded";

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

type Editing = { kind: "create"; parentId: string | null } | { kind: "rename"; id: string } | null;

interface FolderTreeProps {
  activeFolder: FolderFilter;
  onFolder: (folder: FolderFilter) => void;
}

/**
 * The sidebar's folders. Click one to see its notes; drop a note card on a
 * folder to file it there, or a folder onto another to nest it (onto the
 * Folders heading for the top level).
 */
export function FolderTree({ activeFolder, onFolder }: FolderTreeProps) {
  const folders = useAppSelector((state) => state.note.folders);
  const tree = useMemo(() => folderTree(folders), [folders]);
  const actions = useFolderActions();
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Editing>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FolderNode | null>(null);
  const dragFolder = useRef<string | null>(null);

  useEffect(() => setExpanded(readExpanded()), []);

  const setOpen = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // not remembered
      }
      return next;
    });

  // The open folder's parents are shown expanded.
  useEffect(() => {
    if (!activeFolder || activeFolder === "root") return;
    const parents = folderPath(folders, activeFolder).slice(0, -1);
    if (parents.some((p) => !expanded.has(p.id))) parents.forEach((p) => setOpen(p.id, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder, folders]);

  // ── Drag and drop ────────────────────────────────────────────────────────
  /** Whether what's being dragged can go into `target` (a folder id, "root" or "top"). */
  const accepts = (e: React.DragEvent, target: string) => {
    const types = e.dataTransfer.types;
    if (types.includes(DRAG_NOTE)) return target !== "top";
    if (!types.includes(DRAG_FOLDER) || target === "root") return false;
    const dragged = dragFolder.current;
    return Boolean(dragged) && (target === "top" || !folderAndDescendants(folders, dragged!).has(target));
  };

  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!accepts(e, target)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget((t) => (t === target ? null : t));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const folderId = target === "root" || target === "top" ? null : target;
      const noteId = e.dataTransfer.getData(DRAG_NOTE);
      if (noteId) {
        void actions.moveNote(noteId, folderId);
      } else {
        const id = e.dataTransfer.getData(DRAG_FOLDER);
        if (id) void actions.moveFolder(id, folderId).then((ok) => ok && folderId && setOpen(folderId, true));
      }
    },
  });

  // ── Editing ──────────────────────────────────────────────────────────────
  const submit = async (name: string) => {
    const current = editing;
    setEditing(null);
    if (!current || !name.trim()) return;
    if (current.kind === "create") {
      if (await actions.create(name, current.parentId)) {
        if (current.parentId) setOpen(current.parentId, true);
      }
    } else {
      const folder = folders.find((f) => f.id === current.id);
      if (folder && folder.name !== name.trim()) await actions.rename(current.id, name);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const ok = await actions.remove(pendingDelete.id);
    if (!ok) throw new Error("not deleted");
    if (activeFolder && activeFolder !== "root" && folderAndDescendants(folders, pendingDelete.id).has(activeFolder)) onFolder(null);
  };

  const rowClass = (active: boolean, target: string) =>
    cn(
      "group/folder flex h-9 w-full items-center gap-1.5 rounded-xl pr-1 text-left text-sm transition-colors",
      active ? "bg-accent-soft font-medium text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      dropTarget === target && "bg-accent-soft ring-2 ring-accent/40",
    );

  const renderNode = (node: FolderNode): React.ReactNode => {
    const active = activeFolder === node.id;
    const open = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    const creatingHere = editing?.kind === "create" && editing.parentId === node.id;
    return (
      <li key={node.id}>
        {editing?.kind === "rename" && editing.id === node.id ? (
          <NameInput depth={node.depth} initial={node.name} onSubmit={submit} onCancel={() => setEditing(null)} />
        ) : (
          <div
            className={rowClass(active, node.id)}
            style={{ paddingLeft: 4 + node.depth * 14 }}
            draggable
            onDragStart={(e) => {
              dragFolder.current = node.id;
              e.dataTransfer.setData(DRAG_FOLDER, node.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              dragFolder.current = null;
              setDropTarget(null);
            }}
            {...dropProps(node.id)}
          >
            <button
              type="button"
              onClick={() => setOpen(node.id, !open)}
              className={cn(
                "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-subtle hover:text-fg",
                !hasChildren && "invisible",
              )}
              aria-label={t(open ? "folders.collapse" : "folders.expand", { name: node.name })}
              aria-expanded={open}
              tabIndex={hasChildren ? 0 : -1}
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
            <button
              type="button"
              onClick={() => onFolder(active ? null : node.id)}
              aria-pressed={active}
              className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
            >
              {active ? <FolderOpen className="size-4 shrink-0 text-accent" /> : <Folder className="size-4 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
              {node.noteCount > 0 && <span className="text-xs text-fg-subtle tabular-nums group-hover/folder:hidden">{node.noteCount}</span>}
            </button>
            <Menu
              trigger={({ toggle, open: menuOpen }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={t("folders.actions", { name: node.name })}
                  aria-expanded={menuOpen}
                  className={cn(
                    "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle hover:bg-surface hover:text-fg focus:flex",
                    menuOpen ? "flex" : "hidden group-hover/folder:flex",
                  )}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<FolderPlus />}
                    onClick={() => {
                      close();
                      setOpen(node.id, true);
                      setEditing({ kind: "create", parentId: node.id });
                    }}
                  >
                    {t("folders.newInside")}
                  </MenuItem>
                  <MenuItem
                    icon={<Pencil />}
                    onClick={() => {
                      close();
                      setEditing({ kind: "rename", id: node.id });
                    }}
                  >
                    {t("folders.rename")}
                  </MenuItem>
                  <MenuItem
                    danger
                    icon={<Trash2 />}
                    onClick={() => {
                      close();
                      setPendingDelete(node);
                    }}
                  >
                    {t("folders.delete")}
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        )}
        {(open || creatingHere) && (hasChildren || creatingHere) && (
          <ul className="space-y-0.5">
            {node.children.map(renderNode)}
            {creatingHere && (
              <li>
                <NameInput depth={node.depth + 1} onSubmit={submit} onCancel={() => setEditing(null)} />
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div>
      <div
        className={cn("flex items-center justify-between rounded-lg pr-1 pl-3", dropTarget === "top" && "bg-accent-soft ring-2 ring-accent/40")}
        {...dropProps("top")}
      >
        <p className="pb-1.5 text-[0.68rem] font-semibold tracking-wider text-fg-subtle uppercase">{t("folders.title")}</p>
        <button
          type="button"
          onClick={() => setEditing({ kind: "create", parentId: null })}
          className="mb-1 flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label={t("folders.new")}
          title={t("folders.new")}
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>
      <ul className="space-y-0.5">
        {tree.map(renderNode)}
        {editing?.kind === "create" && editing.parentId === null && (
          <li>
            <NameInput depth={0} onSubmit={submit} onCancel={() => setEditing(null)} />
          </li>
        )}
        {tree.length > 0 && (
          <li>
            <button
              type="button"
              onClick={() => onFolder(activeFolder === "root" ? null : "root")}
              aria-pressed={activeFolder === "root"}
              className={cn(rowClass(activeFolder === "root", "root"), "cursor-pointer pl-[34px]")}
              {...dropProps("root")}
            >
              <FolderX className={cn("size-4 shrink-0", activeFolder === "root" && "text-accent")} />
              <span className="flex-1 truncate">{t("folders.unfiled")}</span>
            </button>
          </li>
        )}
        {tree.length === 0 && !editing && (
          <li className="px-3 text-xs leading-relaxed text-fg-subtle">{t("folders.emptyHint")}</li>
        )}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("folders.deleteTitle")}
        message={t("folders.deleteMessage", { name: pendingDelete?.name ?? "" })}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** Inline name field for a new or renamed folder: Enter saves, Escape or leaving it cancels/saves. */
function NameInput({ depth, initial = "", onSubmit, onCancel }: { depth: number; initial?: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const t = useT();
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && ref.current?.value.trim()) onSubmit(ref.current.value);
    else onCancel();
  };
  return (
    <div className="flex h-9 items-center gap-2 pr-1" style={{ paddingLeft: 4 + depth * 14 + 24 }}>
      <Folder className="size-4 shrink-0 text-accent" />
      <input
        ref={ref}
        defaultValue={initial}
        maxLength={100}
        placeholder={t("folders.name")}
        aria-label={t("folders.name")}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") {
            e.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
        className="h-7 min-w-0 flex-1 rounded-lg border border-accent bg-surface px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-indigo-500/20"
      />
    </div>
  );
}
