"use client";

import { useState } from "react";
import { DatabaseZap, RotateCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { setIndexStatus } from "@/store/slices/noteSlice";
import { rebuildIndex, retryFailedIndexing } from "@/service/noteService";
import { getErrorMessage } from "@/service/axios/axios";
import { Button } from "@/app/common/ui/Button";
import { ConfirmDialog } from "@/app/common/ui/ConfirmDialog";
import { Spinner } from "@/app/common/ui/Spinner";
import { useToast } from "@/app/common/ui/Toast";

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
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  if (!status) return null;
  const { counts } = status;
  const indexing = counts.queued + counts.processing;
  const withProblems = status.notes.filter((n) => n.status === "ready" && n.files.length).length;

  const retry = async () => {
    setRetrying(true);
    try {
      dispatch(setIndexStatus(await retryFailedIndexing()));
      toast("Retrying failed notes…", "info");
    } catch (error) {
      toast(getErrorMessage(error, "Couldn't retry indexing."), "error");
    } finally {
      setRetrying(false);
    }
  };

  const rebuild = async () => {
    try {
      dispatch(setIndexStatus(await rebuildIndex(true)));
      toast("Rebuilding the search index…", "info");
    } catch (error) {
      toast(getErrorMessage(error, "Couldn't start the rebuild."), "error");
      throw error;
    }
  };

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-fg">Search index</h2>
        {indexing > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <Spinner className="size-3.5" /> Indexing
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {status.semantic
          ? "Notes and attachments are indexed by meaning and by keyword."
          : "Notes and attachments are indexed by keyword (your active model has no embedding model)."}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <Count label="Searchable" value={counts.ready} />
        <Count label="Indexing" value={indexing} />
        <Count label="Failed" value={counts.failed} tone={counts.failed ? "text-rose-600 dark:text-rose-400" : undefined} />
        <Count label="Not indexed" value={counts.skipped} tone={counts.skipped ? "text-amber-600 dark:text-amber-400" : undefined} />
      </div>
      {withProblems > 0 && (
        <p className="mt-3 text-xs text-fg-subtle">
          {withProblems} note{withProblems === 1 ? " has" : "s have"} attachments that couldn&apos;t be fully read — hover the badge on the
          note for details.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(counts.failed > 0 || withProblems > 0) && (
          <Button size="sm" variant="secondary" onClick={() => void retry()} loading={retrying} icon={<RotateCw className="size-3.5" />}>
            Retry failed
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setConfirmRebuild(true)} icon={<DatabaseZap className="size-3.5" />}>
          Rebuild index
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRebuild}
        title="Rebuild the search index?"
        confirmLabel="Rebuild index"
        message="Every attachment is downloaded and read again, and every passage re-embedded. Images and scanned pages are sent to your AI model again, which uses tokens. Only needed if search results look wrong."
        onConfirm={rebuild}
        onClose={() => setConfirmRebuild(false)}
      />
    </section>
  );
}
