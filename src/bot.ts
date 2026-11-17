import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import { config, MAX_PARTNERS, MIN_PARTNERS } from "./config.js";
import {
  getQueueState,
  getStats,
  getUsers,
  joinQueue,
  leaveQueue,
  saveUser,
  type UserProfile,
} from "./store.js";

const SIZES = Array.from({ length: MAX_PARTNERS - MIN_PARTNERS + 1 }, (_, i) => MIN_PARTNERS + i + 1); // [2..5]

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fullName = (u: UserProfile) => [u.firstName, u.lastName].filter(Boolean).join(" ");

const chooseKeyboard = () => {
  const kb = new InlineKeyboard();
  for (let p = MIN_PARTNERS; p <= MAX_PARTNERS; p++) {
    kb.text(`👥 ${p} ta sherik (${p + 1} kishi)`, `join:${p}`).row();
  }
  return kb;
};
const leaveKeyboard = () => new InlineKeyboard().text("❌ Navbatdan chiqish", "leave");

const WELCOME =
  "👋 Salom! Bu bot Claude obunasini birga ishlatish uchun <b>sherik topib beradi</b>.\n\n" +
  "1️⃣ Nechta sherik kerakligini tanlang (guruh jami 5 kishigacha).\n" +
  "2️⃣ Navbatga yozilasiz.\n" +
  "3️⃣ Guruh to'lganda hammaga bir-birining kontaktini yuboraman — keyin o'zingiz bog'lanib, kelishib olasiz.\n\n" +
  "Nechta sherik bilan bo'lishmoqchisiz?";

const NO_USERNAME_WARN =
  "\n\n⚠️ Sizda <b>username</b> yo'q. Sheriklarga faqat ismingiz profilga havola qilib beriladi — " +
  "Telegram maxfiylik sozlamalaringizga qarab u ochilmasligi mumkin. " +
  "Telegram sozlamalaridan username qo'yib, /start ni qayta bosing.";

function waitingText(size: number, count: number, hasUsername: boolean) {
  return (
    `✅ Siz <b>${size - 1} sherikli (${size} kishilik)</b> navbatdasiz.\n` +
    `Hozir navbatda: <b>${count}/${size}</b>.\n\n` +
    "Guruh to'lishi bilan sizga sheriklaringiz kontaktini yuboraman." +
    (hasUsername ? "" : NO_USERNAME_WARN)
  );
}

/** Telegram ID ko'rsatilmaydi: username bo'lsa @username, bo'lmasa ismning o'zi profilga havola. */
function contactBlock(u: UserProfile) {
  const name = esc(fullName(u));
  return u.username
    ? `• ${name} — @${esc(u.username)}`
    : `• <a href="tg://user?id=${u.id}">${name}</a>`;
}

async function notifyGroup(bot: Bot, memberIds: number[]) {
  const members = await getUsers(memberIds);
  await Promise.all(
    members.map(async (me) => {
      const others = members.filter((m) => m.id !== me.id);
      const text =
        `🎉 <b>Sheriklar topildi!</b> Guruh: ${members.length} kishi.\n\n` +
        `Sizning sheriklaringiz:\n${others.map(contactBlock).join("\n")}\n\n` +
        "Endi o'zingiz bog'lanib, obunani qanday bo'lishishni kelishib oling. " +
        "Yana sherik kerak bo'lsa — /start.";
      try {
        await bot.api.sendMessage(me.id, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      } catch (e) {
        console.error(`Guruh xabarini ${me.id} ga yuborib bo'lmadi:`, e instanceof GrammyError ? e.description : e);
      }
    }),
  );
}

async function showStatusOrMenu(ctx: Context, edit = false) {
  const state = await getQueueState(ctx.from!.id);
  const reply = (text: string, kb: InlineKeyboard) =>
    edit
      ? ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb })
      : ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });

  if (state) {
    return reply(
      `⏳ Siz <b>${state.size - 1} sherikli (${state.size} kishilik)</b> navbatdasiz.\n` +
        `Navbatda: <b>${state.count}/${state.size}</b>, sizning o'rningiz: ${state.position}.`,
      leaveKeyboard(),
    );
  }
  return reply(WELCOME, chooseKeyboard());
}

export function createBot() {
  const bot = new Bot(config.botToken);
  const pm = bot.chatType("private");

  // Har bir xabarda profilni yangilab boramiz (username o'zgarsa ham to'g'ri kontakt beriladi)
  pm.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) {
      await saveUser({
        id: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
      });
    }
    await next();
  });

  pm.command("start", (ctx) => showStatusOrMenu(ctx));
  pm.command("status", (ctx) => showStatusOrMenu(ctx));

  pm.command("cancel", async (ctx) => {
    const size = await leaveQueue(ctx.from.id);
    await ctx.reply(size ? "Navbatdan chiqdingiz. Qaytadan yozilish uchun /start." : "Siz hech qaysi navbatda emassiz. /start");
  });

  pm.callbackQuery(/^join:(\d)$/, async (ctx) => {
    const partners = Number(ctx.match[1]);
    if (partners < MIN_PARTNERS || partners > MAX_PARTNERS) return ctx.answerCallbackQuery("Noto'g'ri tanlov");
    const size = partners + 1;
    const res = await joinQueue(ctx.from.id, size);

    if (res.status === "already") {
      await ctx.answerCallbackQuery(`Siz allaqachon ${res.size} kishilik navbatdasiz`);
      return showStatusOrMenu(ctx, true);
    }
    if (res.status === "waiting") {
      await ctx.answerCallbackQuery("Navbatga yozildingiz");
      return ctx.editMessageText(waitingText(size, res.count, !!ctx.from.username), {
        parse_mode: "HTML",
        reply_markup: leaveKeyboard(),
      });
    }
    await ctx.answerCallbackQuery("Sheriklar topildi!");
    await ctx.editMessageText(`✅ ${size} kishilik guruh to'ldi! Kontaktlarni pastda yubordim.`);
    await notifyGroup(bot, res.memberIds);
  });

  pm.callbackQuery("leave", async (ctx) => {
    const size = await leaveQueue(ctx.from.id);
    await ctx.answerCallbackQuery(size ? "Navbatdan chiqdingiz" : "Siz navbatda emassiz");
    await ctx.editMessageText(WELCOME, { parse_mode: "HTML", reply_markup: chooseKeyboard() });
  });

  pm.command("stat", async (ctx, next) => {
    if (!config.adminIds.has(ctx.from.id)) return next(); // oddiy foydalanuvchiga buyruq "yo'q"
    const s = await getStats(SIZES);
    const waitingTotal = s.queues.reduce((a, q) => a + q.waiting, 0);
    const text =
      "📊 <b>Statistika</b>\n\n" +
      `👤 Jami foydalanuvchilar: <b>${s.users}</b>\n` +
      `🤝 Tuzilgan guruhlar: <b>${s.groupsTotal}</b> (${s.matchedPeople} kishi)\n` +
      `📅 Bugun: <b>${Number(s.today.groups ?? 0)}</b> guruh, ${Number(s.today.people ?? 0)} kishi\n\n` +
      `⏳ <b>Hozir navbatda: ${waitingTotal}</b>\n` +
      s.queues
        .map(
          (q) =>
            `   ${q.size} kishilik: ${q.waiting} kutmoqda · tuzilgan: ${Number(s.groupsBySize[String(q.size)] ?? 0)}`,
        )
        .join("\n");
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  pm.on("message", (ctx) => ctx.reply("Boshlash uchun /start ni bosing."));

  bot.catch((err) => {
    console.error(`Update ${err.ctx.update.update_id} da xato:`, err.error);
  });

  return bot;
}

export async function setCommands(bot: Bot) {
  await bot.api.setMyCommands([
    { command: "start", description: "Sherik topish / navbatga yozilish" },
    { command: "status", description: "Navbatdagi holatim" },
    { command: "cancel", description: "Navbatdan chiqish" },
  ]);
  for (const adminId of config.adminIds) {
    await bot.api
      .setMyCommands(
        [
          { command: "start", description: "Sherik topish / navbatga yozilish" },
          { command: "status", description: "Navbatdagi holatim" },
          { command: "cancel", description: "Navbatdan chiqish" },
          { command: "stat", description: "Statistika (admin)" },
        ],
        { scope: { type: "chat", chat_id: adminId } },
      )
      .catch(() => {}); // admin hali botga yozmagan bo'lsa xato beradi — muhim emas
  }
}
