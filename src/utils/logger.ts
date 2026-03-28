import pino from "pino";

export const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss",
      ignore: "pid,hostname",
    },
  },
  level: process.env.LOG_LEVEL || "info",
});

export function createChildLogger(name: string) {
  return logger.child({ component: name });
}

export function setGlobalLogLevel(level: string): void {
  logger.level = level;
}
