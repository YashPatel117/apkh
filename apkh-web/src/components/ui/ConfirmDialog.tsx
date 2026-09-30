"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // The caller reports the failure; keep the dialog open so the user can retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} locked={busy} hideClose size="sm">
      <div className="p-6">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
          <TriangleAlert className="size-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-fg">{title}</h2>
        <div className="mt-1.5 text-sm leading-relaxed text-fg-muted">{message}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
