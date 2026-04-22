import pino from "pino";

export const logger = pino({
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname,req,res,responseTime",
          translateTime: "SYS:standard",
          messageFormat: "{msg}",
        },
      },
      {
        target: "pino/file",
        options: { destination: "./logs/log.json" },
      },
    ],
  },
});
