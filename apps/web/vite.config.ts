import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { devEndpoints, waitForApi } from '../../scripts/api-readiness.js';

const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, envDir, '');
  // Server-only values are used for the proxy; only VITE_* are exposed to browser code.
  const endpoints = command === 'serve' ? devEndpoints(env) : undefined;
  return {
    plugins: [
      vue(),
      {
        name: 'herenow-api-readiness',
        apply: 'serve',
        async configureServer(server) {
          const url = `${endpoints!.apiTarget}/api/health`;
          server.config.logger.info(`等待 HereNow API 就绪：${url}`);
          await waitForApi(url);
          server.config.logger.info('HereNow API 已就绪，启动前端。');
        },
      },
    ],
    envDir,
    server: endpoints
      ? {
          host: endpoints.host,
          port: endpoints.port,
          strictPort: true,
          proxy: { '/api': endpoints.apiTarget },
        }
      : undefined,
    build: { manifest: true, sourcemap: false, chunkSizeWarningLimit: 1000 },
  };
});
