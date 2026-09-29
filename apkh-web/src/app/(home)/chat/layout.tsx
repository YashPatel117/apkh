"use client";

import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { getChatSessions } from "@/service/chatService";
import { setSessions, setLoading, setActiveSession } from "@/store/slices/chatSlice";
import { Spinner } from "@/app/common/ui/Spinner";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const hasCachedSessions = useAppSelector((state) => state.chat.sessions.length > 0);
  const [ready, setReady] = useState(hasCachedSessions);

  // Always refresh on entry; show cached sessions immediately if we have them.
  useEffect(() => {
    let mounted = true;
    (async () => {
      dispatch(setLoading(true));
      try {
        const fetched = await getChatSessions();
        if (!mounted) return;
        dispatch(setSessions(fetched));

        const requested = new URLSearchParams(window.location.search).get("session");
        if (requested) {
          dispatch(setActiveSession(requested));
          window.history.replaceState(null, "", "/chat");
        }
      } catch (err) {
        console.error("Failed to load chat sessions:", err);
      } finally {
        if (mounted) {
          dispatch(setLoading(false));
          setReady(true);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [dispatch]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle">
        <Spinner />
      </div>
    );
  }

  return <>{children}</>;
}
