"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, LocateFixed, Pause, Play, Plus, Sparkles, X } from "lucide-react";
import { Constellation, ConstellationApi } from "@/components/cosmos/Constellation";
import { clusterColor, groupByCategory, StarNote } from "@/components/cosmos/constellationLayout";
import { useReveal } from "@/components/motion/primitives";
import { useNotes } from "@/context/notesContext";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { appendPage } from "@/store/slices/noteSlice";
import { getNotesPage } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { useTheme } from "@/components/ui/theme";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

function snippet(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function hasWebgl() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function GraphPage() {
  const t = useT();
  const toast = useToast();
  const dispatch = useAppDispatch();
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  const { notesLoaded, openNote, newNote, filteredNotes, query, activeCategory, activeFolder, aiAnswer, aiFailed, clearSearch } = useNotes();
  const { notes, nextCursor, totalNotes, byId } = useAppSelector((state) => state.note);

  const apiRef = useRef<ConstellationApi | null>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const overlay = useReveal<HTMLDivElement>({ threshold: 0, step: 70 });

  const [webgl, setWebgl] = useState(true);
  const [hovered, setHovered] = useState<StarNote | null>(null);
  const [spin, setSpin] = useState(true);
  const [flown, setFlown] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => setWebgl(hasWebgl()), []);

  const stars = useMemo<StarNote[]>(
    () =>
      notes.map((note) => ({
        id: note.id,
        title: note.title,
        category: note.category ?? "",
        folderId: note.folderId ?? null,
        updatedAt: note.updatedAt,
        weight: Math.log10(10 + (note.content?.length ?? 0) + note.files.length * 4000),
      })),
    [notes],
  );
  const groups = useMemo(() => groupByCategory(stars), [stars]);

  // Search / category / folder filters light up the matching stars.
  const filtering = Boolean(query.trim() || activeCategory || activeFolder);
  const highlightKey = filtering ? filteredNotes.map((n) => n.id).join(",") : "";
  // The last AI answer is drawn as beams from the question to the notes it cited.
  const beamIds = useMemo(
    () => (aiAnswer && !aiFailed ? [...new Set(aiAnswer.references.map((r) => r.note_id))] : []),
    [aiAnswer, aiFailed],
  );

  useEffect(() => {
    apiRef.current?.setData(stars);
  }, [stars]);
  useEffect(() => {
    apiRef.current?.setHighlight(highlightKey ? new Set(highlightKey.split(",")) : filtering ? new Set() : null);
  }, [highlightKey, filtering, stars]);
  useEffect(() => {
    apiRef.current?.setBeams(beamIds);
  }, [beamIds, stars]);
  useEffect(() => {
    apiRef.current?.setAutoRotate(spin);
  }, [spin]);

  const fly = (category: string | null) => {
    const next = category === flown ? null : category;
    setFlown(next);
    apiRef.current?.flyTo(next);
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      dispatch(appendPage(await getNotesPage({}, nextCursor)));
    } catch (error) {
      toast(getErrorMessage(error, t("graph.loadFailed")), "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const hoveredNote = hovered ? byId[hovered.id] : undefined;
  const hoveredGroup = hovered ? groups.find((g) => g.name === hovered.category.trim()) : undefined;
  const empty = notesLoaded && totalNotes === 0;

  return (
    <div
      className={cn(
        "relative h-full min-h-[520px] overflow-hidden",
        // Night sky in dark mode; a printed star chart (concentric rings) in light mode.
        "bg-[repeating-radial-gradient(circle_at_50%_55%,transparent_0,transparent_139px,rgba(15,23,42,0.05)_140px,transparent_141px),radial-gradient(70%_60%_at_50%_50%,rgba(99,102,241,0.08),transparent)]",
        "dark:bg-[radial-gradient(60%_55%_at_50%_50%,rgba(79,70,229,0.22),transparent),radial-gradient(40%_40%_at_85%_10%,rgba(245,158,11,0.08),transparent)] dark:bg-[#04060f]",
      )}
    >
      {webgl && !empty && (
        <Constellation
          className="absolute inset-0"
          apiRef={apiRef}
          labelsRef={labelsRef}
          tooltipRef={tooltipRef}
          questionRef={questionRef}
          onHover={setHovered}
          onOpen={openNote}
          onInteract={() => setSpin(false)}
        />
      )}

      {/* Labels, tooltip and question are positioned by the scene every frame */}
      <div ref={labelsRef} data-uncategorized={t("graph.uncategorized")} className="pointer-events-none absolute inset-0 overflow-hidden" />
      <div ref={questionRef} className="star-label z-10">
        {beamIds.length > 0 && aiAnswer && (
          <p className="max-w-56 -translate-x-1/2 -translate-y-[calc(100%+18px)] truncate rounded-full border border-amber-300/60 bg-amber-50/90 px-3 py-1 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-100">
            “{aiAnswer.query}”
          </p>
        )}
      </div>
      <div ref={tooltipRef} className="star-label z-20">
        {hovered && (
          <div className="glass ml-5 w-64 -translate-y-1/2 animate-scale-in rounded-2xl border border-line p-3.5 shadow-2xl shadow-black/20">
            {hoveredGroup && (
              <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold tracking-wide text-fg-subtle uppercase">
                <span className="size-1.5 rounded-full" style={{ background: clusterColor(hoveredGroup, dark) }} />
                {hoveredGroup.uncategorized ? t("graph.uncategorized") : hoveredGroup.name}
              </p>
            )}
            <p className="mt-1 line-clamp-2 font-semibold text-fg">{hovered.title || t("ai.untitled")}</p>
            {hoveredNote?.content && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-fg-muted">{snippet(hoveredNote.content)}</p>}
            <p className="mt-2.5 flex items-center justify-between text-[0.7rem] text-fg-subtle">
              {t("graph.updated", { date: new Date(hovered.updatedAt).toLocaleDateString() })}
              <span className="inline-flex items-center gap-0.5 font-semibold text-accent">
                {t("graph.open")}
                <ArrowUpRight className="size-3" />
              </span>
            </p>
          </div>
        )}
      </div>

      {/* ── Overlay chrome ── */}
      <div ref={overlay} className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 data-reveal className="font-display text-4xl leading-none text-fg italic sm:text-5xl">
              {t("graph.title")}
            </h1>
            <p data-reveal className="mt-2 text-sm text-fg-muted">
              {t("graph.subtitle", { count: stars.length, groups: groups.length })}
            </p>
            <p data-reveal className="mt-1 hidden text-xs text-fg-subtle sm:block">
              {t("graph.hint")}
            </p>
          </div>
          {!empty && webgl && (
            <div data-reveal className="glass pointer-events-auto flex shrink-0 items-center gap-1 rounded-2xl border border-line p-1">
              <button
                type="button"
                onClick={() => setSpin((s) => !s)}
                aria-pressed={spin}
                aria-label={t("graph.spin")}
                title={t("graph.spin")}
                className={cn(
                  "flex size-9 cursor-pointer items-center justify-center rounded-xl transition-colors",
                  spin ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {spin ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFlown(null);
                  apiRef.current?.flyTo(null);
                }}
                aria-label={t("graph.recenter")}
                title={t("graph.recenter")}
                className="flex size-9 cursor-pointer items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <LocateFixed className="size-4" />
              </button>
            </div>
          )}
        </div>

        {empty || !webgl ? (
          <div className="pointer-events-auto mx-auto flex max-w-sm flex-col items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Sparkles className="size-6" />
            </span>
            <h2 className="mt-5 text-xl font-bold tracking-tight text-fg">{webgl ? t("graph.emptyTitle") : t("graph.title")}</h2>
            <p className="mt-2 text-sm text-fg-muted">{webgl ? t("graph.emptyText") : t("graph.noWebgl")}</p>
            {webgl && (
              <Button onClick={newNote} className="mt-6" icon={<Plus className="size-4" />}>
                {t("notes.createFirst")}
              </Button>
            )}
          </div>
        ) : (
          <div />
        )}

        {!empty && webgl && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            {/* Legend: hover to isolate a constellation, click to fly there */}
            <div data-reveal className="glass pointer-events-auto max-w-full rounded-2xl border border-line p-2 sm:w-60">
              <p className="hidden px-2 pt-1 pb-1.5 text-[0.68rem] font-semibold tracking-wider text-fg-subtle uppercase sm:block">
                {t("graph.legend")}
              </p>
              <ul className="flex gap-1 overflow-x-auto sm:max-h-56 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto">
                {groups.map((group) => (
                  <li key={group.name || "_"} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => fly(group.name)}
                      onPointerEnter={() => apiRef.current?.setFocus(group.name)}
                      onPointerLeave={() => apiRef.current?.setFocus(null)}
                      onFocus={() => apiRef.current?.setFocus(group.name)}
                      onBlur={() => apiRef.current?.setFocus(null)}
                      aria-pressed={flown === group.name}
                      className={cn(
                        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 text-left text-sm transition-colors",
                        flown === group.name ? "bg-accent-soft text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full shadow-[0_0_10px_currentColor]"
                        style={{ background: clusterColor(group, dark), color: clusterColor(group, dark) }}
                      />
                      <span className="min-w-0 flex-1 truncate">{group.uncategorized ? t("graph.uncategorized") : group.name}</span>
                      <span className="font-mono text-xs text-fg-subtle">{group.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {beamIds.length > 0 && (
              <div
                data-reveal
                className="glass pointer-events-auto flex items-center gap-3 rounded-2xl border border-amber-300/50 px-4 py-2.5 text-sm dark:border-amber-400/25 sm:mx-auto"
              >
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
                </span>
                <span className="text-fg">{t("graph.beams", { count: beamIds.length })}</span>
                <button
                  type="button"
                  onClick={clearSearch}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  <X className="size-3.5" />
                  {t("graph.clearBeams")}
                </button>
              </div>
            )}

            {nextCursor && (
              <div data-reveal className="glass pointer-events-auto flex items-center gap-3 rounded-2xl border border-line px-4 py-2 text-xs text-fg-muted">
                {t("graph.loaded", { count: stars.length })}
                <Button size="sm" variant="soft" loading={loadingMore} onClick={() => void loadMore()}>
                  {t("graph.loadMore")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
