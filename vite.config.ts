import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({plugins:[tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{assetsInlineLimit:Infinity,cssCodeSplit:false,rollupOptions:{input:fileURLToPath(new URL('./src/main.tsx',import.meta.url)),output:{format:'iife',entryFileNames:'page.js',assetFileNames:'[name][extname]'}}}});
