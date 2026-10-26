import type { Metadata } from "next";

export const metadata: Metadata = { title: "Trash" };

export default function TrashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
