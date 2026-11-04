/**
 * Long-running HTTP server for Railway (and similar hosts).
 * Reuses Vercel-style handlers in api/*.js with a thin req/res adapter.
 *
 *   PORT=3000 node railway-server.js
 *   npm start
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import settingsHandler from './api/settings.js';
import eventAnalyzeHandler from './api/event-analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

function createRes(rawRes) {
  let statusCode = 200;
  const headers = {};
  return {
    statusCode,
    setHeader(name, value) {
      headers[name] = value;
      rawRes.setHeader(name, value);
    },
    status(code) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(body) {
      if (!rawRes.getHeader('content-type')) {
        rawRes.setHeader('content-type', 'application/json; charset=utf-8');
      }
      rawRes.statusCode = statusCode;
      rawRes.end(JSON.stringify(body));
    },
    end(chunk) {
      rawRes.statusCode = statusCode;
      rawRes.end(chunk);
    },
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  const raw = Buffer.concat(chunks).toString('utf8');
  const ct = String(req.headers['content-type'] ?? '');
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function normalizePath(urlPath) {
  const p = (urlPath.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  return p;
}

function sendPrivacy(res) {
  const file = path.join(__dirname, 'public', 'privacy', 'index.html');
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Not found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
}

const server = http.createServer(async (req, rawRes) => {
  const pathname = normalizePath(req.url || '/');
  const res = createRes(rawRes);

  try {
    if (pathname === '/' || pathname === '/health') {
      res.status(200).json({ ok: true, runtime: 'railway' });
      return;
    }
    if (pathname === '/privacy') {
      sendPrivacy(rawRes);
      return;
    }

    const adapterReq = {
      method: req.method || 'GET',
      headers: req.headers,
      url: req.url,
      body: null,
    };

    if (pathname === '/api/settings' || pathname === '/settings') {
      await settingsHandler(adapterReq, res);
      return;
    }

    if (pathname === '/api/event-analyze' || pathname === '/event-analyze') {
      if (req.method === 'POST' || req.method === 'PUT') {
        adapterReq.body = await readBody(req);
      }
      await eventAnalyzeHandler(adapterReq, res);
      return;
    }

    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('[railway-server]', error);
    if (!rawRes.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[exora] Railway HTTP listening on :${PORT}`);
});
