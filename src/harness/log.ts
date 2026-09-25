// Console logging plus a small in-memory event buffer.
// cwh.status() returns the buffer, which helps both humans and agents.
// debug/info only print in debug mode (?cwh=debug); warn/error always print.

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(scope: string): Logger;
}

export interface HarnessEvent {
  t: number;
  scope: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

const MAX_EVENTS = 100;
export const events: HarnessEvent[] = [];
let debugEnabled = false;

export function setDebug(on: boolean): void {
  debugEnabled = on;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function createLogger(scope = 'harness'): Logger {
  const tag = `[cwh:${scope}]`;
  const emit = (level: HarnessEvent['level'], args: unknown[]) => {
    events.push({ t: Math.round(performance.now()), scope, level, message: args.map(stringify).join(' ').slice(0, 500) });
    if (events.length > MAX_EVENTS) events.shift();
    if (level === 'warn' || level === 'error' || debugEnabled) console[level](tag, ...args);
  };
  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    child: (child) => createLogger(`${scope}:${child}`),
  };
}
