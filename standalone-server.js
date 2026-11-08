/**
 * Long-running HTTP server for local / Raspberry Pi (PM2).
 * Reuses Vercel-style handlers in api/*.js with a thin req/res adapter.
 * Hosts the push poller in-process (Vercel serverless cannot run a cron loop).
 *
 *   PORT=3010 node standalone-server.js
 *   npm start
 *   ./pm2-push-poller.sh
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import settingsHandler from './api/settings.js';
import eventAnalyzeHandler from './api/event-analyze.js';
import cexProbeHandler from './api/cex-probe.js';
import pushRegisterHandler from './api/push-register.js';
import aiUsageHandler from './api/ai-usage.js';
import { createPushPoller } from './poller/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const pushPoller = createPushPoller();
const PUSH_POLL_DISABLED =
  String(process.env.PUSH_POLL_DISABLED || '').toLowerCase() === '1' ||
  String(process.env.PUSH_POLL_DISABLED || '').toLowerCase() === 'true';

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

function sendHtmlFile(rawRes, relativePath) {
  const file = path.join(__dirname, 'public', relativePath);
  if (!fs.existsSync(file)) {
    rawRes.statusCode = 404;
    rawRes.setHeader('content-type', 'text/plain; charset=utf-8');
    rawRes.end('Not found');
    return;
  }
  rawRes.statusCode = 200;
  rawRes.setHeader('content-type', 'text/html; charset=utf-8');
  rawRes.end(fs.readFileSync(file));
}

function sendPrivacy(res) {
  sendHtmlFile(res, path.join('privacy', 'index.html'));
}

function sendDashboard(res) {
  sendHtmlFile(res, path.join('dashboard', 'index.html'));
}

const server = http.createServer(async (req, rawRes) => {
  const pathname = normalizePath(req.url || '/');
  const res = createRes(rawRes);

  try {
    if (pathname === '/' || pathname === '/health') {
      res.status(200).json({
        ok: true,
        runtime: 'standalone',
        pushPoller: pushPoller.status(),
      });
      return;
    }

    if (pathname === '/api/push-poller' || pathname === '/push-poller') {
      if (req.method === 'POST') {
        const result = await pushPoller.tick();
        res.status(200).json(result);
        return;
      }
      res.status(200).json(pushPoller.status());
      return;
    }
    if (pathname === '/privacy') {
      sendPrivacy(rawRes);
      return;
    }

    if (pathname === '/dashboard') {
      sendDashboard(rawRes);
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

    if (pathname === '/api/cex-probe' || pathname === '/cex-probe') {
      await cexProbeHandler(adapterReq, res);
      return;
    }

    if (pathname === '/api/push-register' || pathname === '/push-register') {
      if (req.method === 'POST' || req.method === 'PUT') {
        adapterReq.body = await readBody(req);
      }
      await pushRegisterHandler(adapterReq, res);
      return;
    }

    if (pathname === '/api/ai-usage' || pathname === '/ai-usage') {
      adapterReq.url = req.url;
      await aiUsageHandler(adapterReq, res);
      return;
    }

    // Same-origin dashboard helper: injects EXORA_API_TOKEN from server env.
    if (pathname === '/api/dashboard/ai-usage') {
      const token = process.env.EXORA_API_TOKEN?.trim() ?? '';
      adapterReq.url = req.url?.replace(
        '/api/dashboard/ai-usage',
        '/api/ai-usage',
      );
      adapterReq.headers = {
        ...req.headers,
        authorization: token ? `Bearer ${token}` : '',
      };
      await aiUsageHandler(adapterReq, res);
      return;
    }

    res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('[standalone-server]', error);
    if (!rawRes.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[exora] standalone HTTP listening on :${PORT}`);
  if (!PUSH_POLL_DISABLED) {
    pushPoller.start();
  } else {
    console.log('[push-poller] disabled via PUSH_POLL_DISABLED');
  }
});
