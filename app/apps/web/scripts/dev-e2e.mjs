// Dev/E2E launcher: runs the web dev server on fixed local ports with the sample workbook exposed at /__sample.xlsx.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.env.WEB_PORT ??= '5183';
process.env.API_URL ??= 'http://127.0.0.1:3011';
process.env.SAMPLE_XLSX ??= resolve(root, "../../../Major Shutdown Schedule Oct'26 (15 days) Rev.I.xlsx");

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts') });
await server.listen();
server.printUrls();
