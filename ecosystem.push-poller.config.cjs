/**
 * PM2 app definition for the Exora push poller (standalone-server.js).
 *
 * Usage:
 *   ./pm2-push-poller.sh
 *   # or
 *   pm2 startOrReload ecosystem.push-poller.config.cjs --update-env
 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const root = __dirname;
const fileEnv = loadEnvFile(path.join(root, '.env'));

// Avoid clashing with other local apps (e.g. nextjs on 3000).
const port = fileEnv.PORT || '3010';

module.exports = {
  apps: [
    {
      name: 'exora-push-poller',
      script: path.join(root, 'standalone-server.js'),
      cwd: root,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      watch: false,
      env: {
        ...fileEnv,
        PORT: port,
        NODE_ENV: fileEnv.NODE_ENV || 'production',
      },
    },
  ],
};
