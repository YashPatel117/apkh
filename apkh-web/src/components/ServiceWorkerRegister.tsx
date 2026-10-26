"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // Dev: a worker left over from a production run on this port serves stale
      // /_next/static chunks cache-first, hiding hot-reload changes. Remove it.
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        if (!registrations.length) return;
        await Promise.all(registrations.map((r) => r.unregister()));
        if ("caches" in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
        location.reload();
      });
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
