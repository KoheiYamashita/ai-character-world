import type { NextConfig } from "next";

const isEditorMode = process.env.EDITOR_MODE === "true";

const nextConfig: NextConfig = {
  distDir: isEditorMode ? ".next-editor" : ".next",
};

export default nextConfig;
