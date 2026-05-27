// Tiny static file server for the e2e fixture page.
// Kept dependency-free so the e2e harness adds only @playwright/test.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here);
const port = Number(process.env.PORT ?? 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/article.html';
    // Prevent path traversal. Bare `startsWith(root)` is a known
    // prefix-match bug (CVE-2024-29041 family): a sibling directory
    // whose name shares the `fixtures` prefix (e.g. `fixturesEVIL`)
    // would pass. Use `path.relative(root, filePath)` and reject if
    // the relative result escapes root (starts with `..`) or is
    // absolute (different drive on Windows, etc.).
    //
    // Manual probe (run while serve.mjs is up on PORT):
    //   curl -sS -o /dev/null -w '%{http_code}\n' \
    //     "http://127.0.0.1:$PORT/../../../../../etc/hosts"
    // Expected: 403 (or 404 if normalization produced a non-existent path).
    const filePath = normalize(join(root, pathname));
    const rel = relative(root, filePath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const s = await stat(filePath);
    if (!s.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(port, '127.0.0.1');
