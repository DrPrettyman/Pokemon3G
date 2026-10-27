import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const pokedata3gRoot = path.resolve(root, "../pokedata3g");

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow Vite to serve sprites that live in the sibling pokedata3g package.
      allow: [root, pokedata3gRoot],
    },
  },
});
