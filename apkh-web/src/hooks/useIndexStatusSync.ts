"use client";

import { useEffect } from "react";
import { getIndexStatus } from "@/services/noteService";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { setIndexStatus } from "@/store/slices/noteSlice";

const FAST_POLL_MS = 3000;
const SLOW_POLL_MS = 15000;
// With live sync connected, index changes are pushed; polling is only a safety net.
const LIVE_POLL_MS = 60_000;
// Failed attempts back off for minutes; if nothing changes for this long, poll slowly.
const FAST_WINDOW_MS = 2 * 60_000;

/**
 * Keeps the notes' search-index status fresh: loads it once, then polls while
 * any note is queued or being indexed. Every change in progress restarts the
 * fast window, so polling slows down only while jobs are waiting to retry.
 * While `live` (realtime connected), changes arrive as events and it polls
 * once a minute.
 */
export function useIndexStatusSync(enabled: boolean, live = false) {
  const dispatch = useAppDispatch();
  const counts = useAppSelector((state) => state.note.indexStatus?.counts);
  const pending = counts ? counts.queued + counts.processing : 0;
  const progress = counts ? `${counts.queued}/${counts.processing}/${counts.ready}/${counts.failed}/${counts.skipped}` : "";

  useEffect(() => {
    if (!enabled) return;
    getIndexStatus()
      .then((status) => dispatch(setIndexStatus(status)))
      .catch(() => {});
  }, [enabled, dispatch]);

  useEffect(() => {
    if (!enabled || pending === 0) return;
    const fastUntil = Date.now() + FAST_WINDOW_MS;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const status = await getIndexStatus();
        if (!cancelled) dispatch(setIndexStatus(status));
      } catch {
        // keep polling; a transient error shouldn't freeze the status
      }
      if (!cancelled) timer = setTimeout(poll, nextDelay());
    };
    const nextDelay = () => (live ? LIVE_POLL_MS : Date.now() < fastUntil ? FAST_POLL_MS : SLOW_POLL_MS);
    timer = setTimeout(poll, nextDelay());

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, live, pending, progress, dispatch]);
}
