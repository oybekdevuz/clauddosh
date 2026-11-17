import { createBot, setCommands } from "./bot.js";
import { config } from "./config.js";
import { redis } from "./store.js";

async function main() {
  await redis.ping();
  const bot = createBot();
  await setCommands(bot);

  if (config.adminIds.size === 0) console.warn("⚠️  ADMIN_IDS bo'sh — /stat hech kimga ishlamaydi.");

  const stop = async () => {
    await bot.stop();
    redis.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await bot.start({
    drop_pending_updates: false,
    onStart: (me) => console.log(`✅ @${me.username} ishga tushdi`),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
