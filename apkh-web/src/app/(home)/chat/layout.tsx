"use client";

import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { getChatSessions } from "@/services/chatService";
import { setSessions, setLoading, setActiveSession } from "@/store/slices/chatSlice";
import { getErrorMessage } from "@/services/axios";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const toast = useToast();
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
        if (mounted) toast(getErrorMessage(err, "Couldn't load your chats."), "error");
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
  }, [dispatch, toast]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle">
        <Spinner />
      </div>
    );
  }

  return <>{children}</>;
}
