"use client";

import { useState } from "react";
import { DatabaseZap, RotateCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { setIndexStatus } from "@/store/slices/noteSlice";
import { rebuildIndex, retryFailedIndexing } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n";

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
      <p className={`text-lg font-bold tabular-nums ${tone ?? "text-fg"}`}>{value}</p>
      <p className="text-xs text-fg-muted">{label}</p>
    </div>
  );
}

/** Search-index progress and repair actions (retry failed notes, rebuild everything). */
export default function SearchIndexCard() {
  const status = useAppSelector((state) => state.note.indexStatus);
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);
  const t = useT();
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  if (!status) return null;
  const { counts } = status;
  const indexing = counts.queued + counts.processing;
  const withProblems = status.notes.filter((n) => n.status === "ready" && n.files.length).length;

  const retry = async () => {
    setRetrying(true);
    try {
      dispatch(setIndexStatus(await retryFailedIndexing()));
      toast(t("indexCard.retrying"), "info");
    } catch (error) {
      toast(getErrorMessage(error, t("indexCard.retryFailed")), "error");
    } finally {
      setRetrying(false);
    }
  };

  const rebuild = async () => {
    try {
      dispatch(setIndexStatus(await rebuildIndex(true)));
      toast(t("indexCard.rebuilding"), "info");
    } catch (error) {
      toast(getErrorMessage(error, t("indexCard.rebuildFailed")), "error");
      throw error;
    }
  };

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-fg">{t("indexCard.title")}</h2>
        {indexing > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <Spinner className="size-3.5" /> {t("index.indexing")}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {status.semantic ? t("indexCard.semantic") : t("indexCard.keyword")}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Count label={t("indexCard.searchable")} value={counts.ready} />
        <Count label={t("index.indexing")} value={indexing} />
        <Count label={t("indexCard.failed")} value={counts.failed} tone={counts.failed ? "text-rose-600 dark:text-rose-400" : undefined} />
        <Count label={t("index.notIndexed")} value={counts.skipped} tone={counts.skipped ? "text-amber-600 dark:text-amber-400" : undefined} />
      </div>
      {withProblems > 0 && (
        <p className="mt-3 text-xs text-fg-subtle">
          {t("indexCard.problems", { count: withProblems })}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(counts.failed > 0 || withProblems > 0) && (
          <Button size="sm" variant="secondary" onClick={() => void retry()} loading={retrying} icon={<RotateCw className="size-3.5" />}>
            {t("indexCard.retry")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setConfirmRebuild(true)} icon={<DatabaseZap className="size-3.5" />}>
          {t("indexCard.rebuild")}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRebuild}
        title={t("indexCard.rebuildTitle")}
        confirmLabel={t("indexCard.rebuild")}
        message={t("indexCard.rebuildText")}
        onConfirm={rebuild}
        onClose={() => setConfirmRebuild(false)}
      />
    </section>
  );
}
