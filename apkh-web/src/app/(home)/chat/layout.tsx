"use client";

import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { getChatSessions } from "@/service/chatService";
import { setSessions, setLoading, setActiveSession } from "@/store/slices/chatSlice";
import { CircularProgress } from "@mui/material";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useAppDispatch();
  const sessions = useAppSelector((state) => state.chat.sessions);
  const activeSessionId = useAppSelector((state) => state.chat.activeSessionId);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (sessions.length === 0) {
          dispatch(setLoading(true));
          const fetchedSessions = await getChatSessions();
          if (mounted) {
            dispatch(setSessions(fetchedSessions));
            // Automatically select first session if none selected
            if (fetchedSessions.length > 0 && !activeSessionId) {
              const urlParams = new URLSearchParams(window.location.search);
              if (!urlParams.get("session")) {
                  dispatch(setActiveSession(fetchedSessions[0].id));
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load chat sessions:", err);
      } finally {
        if (mounted) {
          dispatch(setLoading(false));
          setIsInitializing(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [dispatch, sessions.length, activeSessionId]);

  if (isInitializing) {
    return (
      <div className="flex h-[calc(100vh-80px)] w-full items-center justify-center">
        <CircularProgress size={40} className="text-sky-600" />
      </div>
    );
  }

  return <>{children}</>;
}
