import { Bot } from "grammy";
import { run, type RunnerHandle } from "@grammyjs/runner";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { logger } from "./config.js";

export function createBot(token: string): Bot {
  const bot = new Bot(token);
  bot.api.config.use(apiThrottler());

  bot.catch((err) => {
    logger.error({ err: err.error }, "Bot error");
  });

  return bot;
}

export function startPolling(bot: Bot): RunnerHandle {
  const runner = run(bot, {
    runner: { fetch: { allowed_updates: ["message", "callback_query"] } },
  });

  logger.info("Telegram bot started in polling mode");
  return runner;
}
