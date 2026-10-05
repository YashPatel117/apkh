"use client";

import { Modal } from "@/components/ui/Modal";
import { MessageKey, useT } from "@/i18n";

/** Ctrl on Windows/Linux, ⌘ on Apple devices. */
export const modKey = () => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl");

function Keys({ combos }: { combos: string[][] }) {
  const t = useT();
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-fg-subtle">
      {combos.map((keys, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="px-0.5">{t("shortcuts.or")}</span>}
          {keys.map((key) => (
            <kbd key={key} className="min-w-6 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[0.7rem] text-fg">
              {key}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const mod = modKey();
  const alt = mod === "⌘" ? "⌥" : "Alt";
  const rows: [MessageKey, string[][]][] = [
    ["shortcuts.palette", [[mod, "K"]]],
    ["shortcuts.search", [["/"], [mod, "Shift", "F"]]],
    ["shortcuts.newNote", [[alt, "N"]]],
    ["shortcuts.ask", [["Enter"]]],
    ["shortcuts.save", [[mod, "Enter"], [mod, "S"]]],
    ["shortcuts.slash", [["/"]]],
    ["shortcuts.move", [["↑", "↓", "←", "→"], ["J", "K"]]],
    ["shortcuts.open", [["Enter"]]],
    ["shortcuts.select", [["X"]]],
    ["shortcuts.help", [["?"]]],
    ["shortcuts.close", [["Esc"]]],
  ];
  return (
    <Modal open={open} onClose={onClose} title={t("shortcuts.title")} size="sm">
      <ul className="divide-y divide-line px-5 pb-5 sm:px-6">
        {rows.map(([label, combos]) => (
          <li key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm text-fg">
            <span>{t(label)}</span>
            <Keys combos={combos} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
