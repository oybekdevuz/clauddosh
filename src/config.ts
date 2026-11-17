import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} .env faylida ko'rsatilmagan`);
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  redisUrl: process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
  adminIds: new Set(
    (process.env.ADMIN_IDS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isSafeInteger(n) && n > 0),
  ),
};

/** Sherik soni: 1..4 (o'zi bilan birga guruh 2..5 kishi). */
export const MIN_PARTNERS = 1;
export const MAX_PARTNERS = 4;
