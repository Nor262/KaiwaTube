import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ensureServerInit, handleApiRequest } from './server/index';
import { applyCommonSecurityHeaders, buildAppCspHeader } from './server/security';

function createMiddleware(isDev: boolean) {
  const cspHeader = buildAppCspHeader(isDev);
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    applyCommonSecurityHeaders(res);
    if (!(req.url || '').startsWith('/api/')) {
      res.setHeader('Content-Security-Policy', cspHeader);
    }
    void handleApiRequest(req, res, next);
  };
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'nihongo-api-server',
      configureServer(server) {
        ensureServerInit();
        server.middlewares.use(createMiddleware(true));
      },
      configurePreviewServer(server) {
        ensureServerInit();
        server.middlewares.use(createMiddleware(false));
      },
    },
  ],
});
