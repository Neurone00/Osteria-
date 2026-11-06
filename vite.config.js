import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset paths relative, so the build works on GitHub Pages
// project sites, Netlify, Vercel, or a plain folder on any static host.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
