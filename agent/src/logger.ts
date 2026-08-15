/**
 * logger.ts
 * Winston logger instance configured with colorized console output,
 * timestamp formatting, and log level from the environment config.
 */

import winston from 'winston';

const { combine, timestamp, colorize, printf, errors } = winston.format;

/**
 * Custom log line format:
 *   [2024-01-15 10:30:45] [INFO] Agent started for org my-org
 */
const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  // Include stack trace for error-level logs when available
  return stack ? `${base}\n${stack}` : base;
});

/**
 * Create and configure the singleton logger.
 * Call `setLogLevel` after config is loaded to apply the configured level.
 */
export const logger = winston.createLogger({
  level: 'info', // default; overridden by setLogLevel() after config loads
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    colorize({ all: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});

/**
 * Update the logger's level at runtime (called once config is loaded).
 */
export function setLogLevel(level: string): void {
  logger.level = level;
  logger.transports.forEach((t) => {
    t.level = level;
  });
}
