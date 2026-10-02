import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Knowledge Hub",
    short_name: "Knowledge Hub",
    description:
      "Capture notes, files and links, then ask questions and get grounded answers from your own knowledge.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#060a18",
    theme_color: "#060a18",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
