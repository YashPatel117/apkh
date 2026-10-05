import type { IFolder } from "@/models/note";

export interface FolderNode extends IFolder {
  children: FolderNode[];
  depth: number;
}

const byName = (a: IFolder, b: IFolder) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** The folders as a tree (top-level folders first), each level sorted by name. */
export function folderTree(folders: IFolder[]): FolderNode[] {
  const ids = new Set(folders.map((f) => f.id));
  const childrenOf = new Map<string | null, IFolder[]>();
  for (const folder of folders) {
    // A parent that isn't in the list (shouldn't happen) puts the folder at the top.
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), folder]);
  }
  const build = (parent: string | null, depth: number, seen: Set<string>): FolderNode[] =>
    (childrenOf.get(parent) ?? [])
      .filter((f) => !seen.has(f.id))
      .sort(byName)
      .map((f) => ({ ...f, depth, children: build(f.id, depth + 1, new Set(seen).add(f.id)) }));
  return build(null, 0, new Set());
}

/** The tree flattened in display order. */
export function flattenTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** A folder and its ancestors, outermost first. */
export function folderPath(folders: IFolder[], id: string | null): IFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: IFolder[] = [];
  for (let current = id ? byId.get(id) : undefined; current && !path.includes(current); current = current.parentId ? byId.get(current.parentId) : undefined) {
    path.unshift(current);
  }
  return path;
}

/** A folder's id and every folder inside it (it can't be moved into any of them). */
export function folderAndDescendants(folders: IFolder[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }
  return result;
}

/** Drag-and-drop payload types (notes onto folders, folders into folders). */
export const DRAG_NOTE = "application/x-kh-note";
export const DRAG_FOLDER = "application/x-kh-folder";
