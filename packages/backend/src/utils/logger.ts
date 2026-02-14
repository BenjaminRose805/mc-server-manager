import pino from "pino";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

const isDev = process.env.NODE_ENV !== "production";

fs.mkdirSync(config.logsDir, { recursive: true });

const logFilePath = path.join(config.logsDir, "app.log");

export const logger = pino({
  level: config.logLevel,
  transport: {
    targets: [
      ...(isDev
        ? [
            {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss",
                ignore: "pid,hostname",
              },
              level: config.logLevel as string,
            },
          ]
        : [
            {
              target: "pino/file",
              options: { destination: 1 },
              level: config.logLevel as string,
            },
          ]),
      {
        target: "pino-roll",
        options: {
          file: logFilePath,
          frequency: "daily",
          limit: { count: 7 },
          mkdir: true,
        },
        level: config.logLevel as string,
      },
    ],
  },
});

export { logFilePath };
