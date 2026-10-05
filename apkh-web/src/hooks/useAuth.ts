"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { profile } from "@/services/authService";
import { clearToken, getValidToken } from "@/services/session";
import { getErrorMessage } from "@/services/axios";
import { getCategories, getNoteLastUpdatedTime, getNotesPage } from "@/services/noteService";
import { getFolders } from "@/services/folderService";
import { getChatSessions } from "@/services/chatService";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { logout, setToken, setUser } from "@/store/slices/authSlice";
import { setCategories, setFirstPage, setFolders } from "@/store/slices/noteSlice";
import { setSessions } from "@/store/slices/chatSlice";
import { clearCachedLibrary, readCachedLibrary, saveCachedLibrary } from "@/lib/offlineCache";
import { useT } from "@/i18n";

// Module-level so a remount (route change) doesn't refire the same request.
let profileRequest: Promise<unknown> | null = null;
let notesRequest: Promise<unknown> | null = null;

/** Refreshes the sidebar's category counts and folders (after saves, moves, deletes). */
export async function refreshLibraryMeta(dispatch: ReturnType<typeof useAppDispatch>) {
  const [categories, folders] = await Promise.all([getCategories(), getFolders()]);
  dispatch(setCategories(categories));
  dispatch(setFolders(folders));
}

/**
 * The signed-in session: redirects to login without a valid token, then
 * loads the profile, the first page of notes, categories, folders and
 * conversations. Offline, the last copy of the library is shown instead.
 */
export function useAuth() {
  const user = useAppSelector((state) => state.auth.user);
  const { loaded, latestUpdatedAt, notes } = useAppSelector((state) => state.note);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [loadError, setLoadError] = useState<string | null>(null);
  const t = useT();
  const [notesLoaded, setNotesLoaded] = useState(loaded);

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      if (!user) {
        profileRequest ??= profile().finally(() => (profileRequest = null));
        dispatch(setUser((await profileRequest) as never));
      }
      notesRequest ??= (async () => {
        const lastUpdated = await getNoteLastUpdatedTime();
        if (!loaded || !lastUpdated || !latestUpdatedAt || lastUpdated > latestUpdatedAt) {
          const [page] = await Promise.all([getNotesPage(), refreshLibraryMeta(dispatch)]);
          dispatch(setFirstPage(page));
        }
      })().finally(() => (notesRequest = null));
      await notesRequest;
      setNotesLoaded(true);
      // Sidebar/profile show conversation counts on every page; failures here are non-fatal.
      getChatSessions()
        .then((sessions) => dispatch(setSessions(sessions)))
        .catch(() => {});
    } catch (error) {
      // Offline: show the library as it was last seen, read-only until reconnected.
      const cached = readCachedLibrary();
      if (cached && typeof navigator !== "undefined" && !navigator.onLine) {
        if (!user && cached.user) dispatch(setUser(cached.user));
        dispatch(setFirstPage(cached.page));
        dispatch(setCategories({ categories: cached.categories, total: cached.page.total }));
        dispatch(setFolders(cached.folders));
        setNotesLoaded(true);
        return;
      }
      // 401s are handled globally by the axios interceptor (redirect to login).
      setLoadError(getErrorMessage(error, t("shell.loadFailed")));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    const token = getValidToken();
    if (!token) {
      dispatch(logout());
      router.replace("/login");
      return;
    }
    dispatch(setToken(token));
    void loadData();
  }, [dispatch, router, loadData]);

  // Keep an offline copy of what's loaded.
  const categories = useAppSelector((state) => state.note.categories);
  const folders = useAppSelector((state) => state.note.folders);
  const totalNotes = useAppSelector((state) => state.note.totalNotes);
  useEffect(() => {
    if (notesLoaded && user) saveCachedLibrary({ user, notes, categories, folders, total: totalNotes });
  }, [notesLoaded, user, notes, categories, folders, totalNotes]);

  const signOut = useCallback(() => {
    clearCachedLibrary();
    clearToken();
    dispatch(logout());
    router.replace("/login");
  }, [dispatch, router]);

  return { user, loadError, notesLoaded, loadData, signOut };
}
