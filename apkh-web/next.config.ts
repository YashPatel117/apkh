import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits bottom-left, directly over the sidebar's account menu
  // (and ignores `position` in 15.5). Build/runtime errors still show the overlay.
  devIndicators: false,
};

export default nextConfig;
