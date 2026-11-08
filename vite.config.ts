import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Requests to /_backend/* are forwarded to the Node server in /server (port 3000 by default),
// so the browser never deals with CORS. Override with LIFELINE_API=http://host:port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.LIFELINE_API ?? 'http://localhost:3000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/_backend': {
          target,
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/_backend/, ''),
          // A backend restart or a closed tab resets sockets; log it instead of crashing Vite.
          configure: (proxy) => {
            proxy.on('error', (err) => console.warn(`[backend proxy] ${err.message}`));
            proxy.on('proxyReqWs', (_req, _r, socket) => socket.on('error', () => {}));
            proxy.on('open', (socket) => socket.on('error', () => {}));
          },
        },
      },
    },
  };
});
