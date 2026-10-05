"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INote, INotesPage } from "@/models/note";
import { AiSearchResponse, getNoteById, getNotesPage } from "@/services/noteService";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { appendPage, cacheNotes } from "@/store/slices/noteSlice";

const DEBOUNCE_MS = 300;

/** A folder filter: a folder id, "root" (notes in no folder), or null (all). */
export type FolderFilter = string | null;

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * The notes to show. Unfiltered, the library pages from the store. With
 * search words, a category or a folder, the server does the filtering (words
 * wait 300 ms after typing stops) and its results page in the same way. After
 * an AI answer, the notes it used.
 */
export function useNotesFilter(search: string, aiAnswer: AiSearchResponse | null, aiFailed: boolean) {
  const dispatch = useAppDispatch();
  const { notes, nextCursor, totalNotes, byId, revision } = useAppSelector((state) => state.note);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<FolderFilter>(null);

  // An in-progress "@mention" is a note picker, not search text.
  const typedQuery = search.replace(/(^|\s)@\S*/g, " ").replace(/\s+/g, " ").trim();
  const textQuery = useDebounced(typedQuery, DEBOUNCE_MS);
  const filtered = Boolean(textQuery || activeCategory || activeFolder);

  const [results, setResults] = useState<INotesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef<AbortController | null>(null);

  const query = useMemo(
    () => ({ q: textQuery, category: activeCategory, folderId: activeFolder }),
    [textQuery, activeCategory, activeFolder],
  );

  // Filtered results: refetched when the filters change or a note is saved.
  useEffect(() => {
    request.current?.abort();
    if (!filtered) {
      setResults(null);
      return;
    }
    const abort = new AbortController();
    request.current = abort;
    setLoading(true);
    getNotesPage(query, null, undefined, abort.signal)
      .then((page) => {
        if (abort.signal.aborted) return;
        dispatch(cacheNotes(page.notes));
        setResults(page);
      })
      .catch(() => {})
      .finally(() => !abort.signal.aborted && setLoading(false));
    return () => abort.abort();
  }, [filtered, query, revision, dispatch]);

  const hasMore = filtered ? Boolean(results?.nextCursor) : Boolean(nextCursor);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      if (filtered && results?.nextCursor) {
        const page = await getNotesPage(query, results.nextCursor);
        dispatch(cacheNotes(page.notes));
        setResults((prev) => (prev ? { ...page, notes: [...prev.notes, ...page.notes] } : page));
      } else if (!filtered && nextCursor) {
        dispatch(appendPage(await getNotesPage({}, nextCursor)));
      }
    } catch {
      // The next scroll tries again.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, filtered, results, query, nextCursor, dispatch]);

  // Notes an AI answer used; any not loaded yet are fetched.
  const referencedIds = useMemo(
    () => (aiAnswer && !aiFailed ? [...new Set(aiAnswer.references.map((r) => r.note_id).filter(Boolean))] : []),
    [aiAnswer, aiFailed],
  );
  useEffect(() => {
    const missing = referencedIds.filter((id) => !byId[id]);
    if (!missing.length) return;
    Promise.all(missing.map((id) => getNoteById(id).then((res) => res.data as INote).catch(() => null))).then((found) =>
      dispatch(cacheNotes(found.filter((n): n is INote => Boolean(n)))),
    );
  }, [referencedIds, byId, dispatch]);

  const filteredNotes = useMemo(() => {
    if (referencedIds.length) return referencedIds.map((id) => byId[id]).filter((n): n is INote => Boolean(n));
    if (!filtered) return notes;
    // Fresh copies from the store, so edits show without refetching.
    return (results?.notes ?? []).map((n) => byId[n.id] ?? n).filter((n) => byId[n.id]);
  }, [referencedIds, filtered, notes, results, byId]);

  return {
    filteredNotes,
    /** Notes matching the current filters (all pages) */
    total: referencedIds.length ? filteredNotes.length : filtered ? (results?.total ?? 0) : totalNotes,
    hasMore: referencedIds.length ? false : hasMore,
    loadMore,
    loading: filtered && loading && !results,
    loadingMore,
    /** The words being searched for (after the debounce) */
    textQuery,
    activeCategory,
    setActiveCategory,
    activeFolder,
    setActiveFolder,
  };
}
