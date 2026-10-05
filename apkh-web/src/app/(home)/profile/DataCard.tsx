"use client";

import { useState } from "react";
import { Download, PackageOpen } from "lucide-react";
import { exportAllNotes } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useAppSelector } from "@/store/hook";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n";

/** Download everything: every note as Markdown, its attachments, and a JSON copy, in one ZIP. */
export default function DataCard() {
  const totalNotes = useAppSelector((state) => state.note.totalNotes);
  const toast = useToast();
  const t = useT();
  const [exporting, setExporting] = useState(false);

  const exportAll = async () => {
    setExporting(true);
    try {
      await exportAllNotes();
    } catch (error) {
      toast(getErrorMessage(error, t("data.exportFailed")), "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <PackageOpen className="size-[1.1rem]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">{t("data.title")}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{t("data.text", { count: totalNotes })}</p>
        </div>
      </div>
      <Button
        variant="secondary"
        className="mt-4 w-full"
        onClick={() => void exportAll()}
        loading={exporting}
        disabled={totalNotes === 0}
        icon={<Download className="size-4" />}
      >
        {exporting ? t("data.preparing") : t("palette.exportAll")}
      </Button>
    </section>
  );
}
