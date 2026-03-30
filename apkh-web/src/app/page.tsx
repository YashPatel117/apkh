"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="p-6">
      <h1>Welcome</h1>
      <Link href="/login" className="text-blue-500 underline">
        Go to Login
      </Link>
    </main>
  );
}
