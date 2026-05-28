/**
 * Zero-dependency structured logging utility.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const base = `[${formatTimestamp()}] [${level.toUpperCase()}] ${message}`;
  if (context && Object.keys(context).length > 0) {
    return `${base} ${JSON.stringify(context)}`;
  }
  return base;
}

export function debug(message: string, context?: Record<string, unknown>): void {
  if (shouldLog('debug')) {
    console.debug(formatMessage('debug', message, context));
  }
}

export function info(message: string, context?: Record<string, unknown>): void {
  if (shouldLog('info')) {
    console.error(formatMessage('info', message, context));
  }
}

export function warn(message: string, context?: Record<string, unknown>): void {
  if (shouldLog('warn')) {
    console.warn(formatMessage('warn', message, context));
  }
}

export function error(message: string, context?: Record<string, unknown>): void {
  if (shouldLog('error')) {
    console.error(formatMessage('error', message, context));
  }
}

/** Create a scoped logger with a namespace prefix */
export function createLogger(namespace: string) {
  return {
    debug: (message: string, context?: Record<string, unknown>) =>
      debug(`[${namespace}] ${message}`, context),
    info: (message: string, context?: Record<string, unknown>) =>
      info(`[${namespace}] ${message}`, context),
    warn: (message: string, context?: Record<string, unknown>) =>
      warn(`[${namespace}] ${message}`, context),
    error: (message: string, context?: Record<string, unknown>) =>
      error(`[${namespace}] ${message}`, context),
  };
}

export const logger = {
  debug,
  info,
  warn,
  error,
  setLogLevel,
  getLogLevel,
  createLogger,
};
