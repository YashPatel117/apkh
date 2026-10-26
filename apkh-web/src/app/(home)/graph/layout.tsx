import type { Metadata } from "next";

export const metadata: Metadata = { title: "Constellation" };

export default function GraphLayout({ children }: { children: React.ReactNode }) {
  return children;
}
