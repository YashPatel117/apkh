import type { Metadata } from "next";

export const metadata: Metadata = { title: "Notes" };

// Notes are loaded once by the (home) layout so every page shares them.
export default function NoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
