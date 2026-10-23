import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false } } }, build: { outDir: '../../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1200, rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], antd: ['antd'], flow: ['@xyflow/react'] } } } } });
