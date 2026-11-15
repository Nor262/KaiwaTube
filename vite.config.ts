import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ensureServerInit, handleApiRequest } from './server/index';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'nihongo-api-server',
      configureServer(server) {
        ensureServerInit();
        server.middlewares.use((req, res, next) => {
          void handleApiRequest(req, res, next);
        });
      },
      configurePreviewServer(server) {
        ensureServerInit();
        server.middlewares.use((req, res, next) => {
          void handleApiRequest(req, res, next);
        });
      },
    },
  ],
});
