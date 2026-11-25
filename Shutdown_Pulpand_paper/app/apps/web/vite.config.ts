import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createReadStream, existsSync } from 'node:fs';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // Dev-only helper: serve a sample workbook at /__sample.xlsx so the upload flow can be exercised in a browser without a file picker.
      name: 'dev-sample-workbook',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__sample.xlsx', (_req, res) => {
          const p = process.env.SAMPLE_XLSX;
          if (!p || !existsSync(p)) { res.statusCode = 404; return res.end('set SAMPLE_XLSX'); }
          res.setHeader('content-type', 'application/octet-stream');
          createReadStream(p).pipe(res);
        });
      },
    },
  ],
  server: { port: Number(process.env.WEB_PORT ?? 5173), strictPort: true, proxy: { '/api': process.env.API_URL ?? 'http://127.0.0.1:3001' } },
});
