import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3100',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/')) {
            if (id.includes('/@xyflow/')) return 'flow';
            if (/\/(antd|@ant-design|rc-[^/]+)\//.test(id)) return 'antd';
            if (/\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id))
              return 'react';
          }
        },
      },
    },
  },
});
