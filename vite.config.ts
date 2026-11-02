import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({build:{assetsInlineLimit:Infinity,cssCodeSplit:false,rollupOptions:{input:fileURLToPath(new URL('./src/main.tsx',import.meta.url)),output:{format:'iife',entryFileNames:'page.js',assetFileNames:'[name][extname]'}}}});
