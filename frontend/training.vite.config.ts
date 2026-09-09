import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

// A self-contained preview of the same training component used at /training.
// No Firebase project or Monkeytype API is needed for device-local practice.
export default defineConfig({
  root: "training-preview",
  plugins: [solid(), tailwindcss()],
  publicDir: false,
  server: { port: 3000, strictPort: true, open: false },
  build: { outDir: "../../dist", emptyOutDir: true },
});
