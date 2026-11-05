import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiBaseUrl = env.VITE_API_BASE_URL || '/api';
    const devProxyTarget =
      env.VITE_API_PROXY_TARGET ||
      (apiBaseUrl.startsWith('http') ? apiBaseUrl : 'http://localhost:6311');

    return {
      server: {
        port: 6300,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: devProxyTarget,
            changeOrigin: true,
            ws: true,
            rewrite: (path) => path,
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEYS || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEYS || ''),
        'process.env.GEMINI_API_KEYS': JSON.stringify(env.VITE_GEMINI_API_KEYS || env.GEMINI_API_KEY || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
