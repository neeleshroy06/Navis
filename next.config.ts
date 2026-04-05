import path from "path";
import { fileURLToPath } from "url";
import type { NextConfig } from "next";

/** Absolute path to this repo (same folder as `package.json`). */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    // Picks this project when a `package-lock.json` also exists higher in the tree
    // (e.g. under your user profile). Avoids the “inferred workspace root” warning.
    root: projectRoot,
  },
};

export default nextConfig;
