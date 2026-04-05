import path from "path";
import type { NextConfig } from "next";

/**
 * You have another `package-lock.json` higher in the tree (e.g. home). Next.js
 * would otherwise pick that as the Turbopack root and `src/app` routes break
 * with 404. Pin the root to this project directory.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
