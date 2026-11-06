/** In-memory ring buffer of poller log lines for the dashboard. */

const MAX_LINES = 400;

export function createLogBuffer(max = MAX_LINES) {
  const lines = [];

  function push(level, message, extra) {
    const entry = {
      at: new Date().toISOString(),
      level: level || 'info',
      message: String(message),
    };
    if (extra !== undefined) entry.extra = extra;
    lines.push(entry);
    while (lines.length > max) lines.shift();
    const prefix = `[push-poller]`;
    if (level === 'error') console.error(prefix, message, extra ?? '');
    else if (level === 'warn') console.warn(prefix, message, extra ?? '');
    else console.log(prefix, message, extra ?? '');
    return entry;
  }

  return {
    info: (msg, extra) => push('info', msg, extra),
    warn: (msg, extra) => push('warn', msg, extra),
    error: (msg, extra) => push('error', msg, extra),
    clear: () => {
      lines.length = 0;
    },
    snapshot: (limit = 200) => lines.slice(-Math.max(1, limit)),
    get length() {
      return lines.length;
    },
  };
}
