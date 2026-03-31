"use client";

import { getAllNotes, getNoteLastUpdatedTime } from "@/service/noteService";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { setNotes } from "@/store/slices/noteSlice";
import { useEffect } from "react";

let isFetchingNotes = false;

export default function NoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { latestUpdatedAt } = useAppSelector((state) => state.note);
  const dispatch = useAppDispatch();

  useEffect(() => {
    (async () => {
      if (isFetchingNotes) return;
      isFetchingNotes = true;
      try {
        const lastUpdatedTime = await getNoteLastUpdatedTime();
        if (
          !lastUpdatedTime ||
          !latestUpdatedAt ||
          lastUpdatedTime > latestUpdatedAt
        ) {
          const notes = await getAllNotes();
          dispatch(setNotes(notes));
        }
      } finally {
        isFetchingNotes = false;
      }
    })();
  }, []);

  return <div>{children}</div>;
}
