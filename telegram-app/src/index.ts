import { config, logger } from "./config.js";
import { startHealthServer } from "./health.js";
import { createBot, startPolling } from "./bot.js";
import { setupMessageHandlers } from "./message-handler.js";

logger.info("Starting Telegram adapter");

const bot = createBot(config.telegramBotToken);
setupMessageHandlers(bot);

let isRunning = false;
const healthServer = startHealthServer(config.healthPort, () => isRunning);

const runner = startPolling(bot);
isRunning = true;

function shutdown() {
  logger.info("Shutting down");
  isRunning = false;
  runner.stop();
  healthServer.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
