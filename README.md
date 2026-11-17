# clauddosh

Claude obunasini birga ishlatish uchun sherik topib beradigan Telegram bot (TypeScript + grammY + Redis).

## Ishga tushirish

```bash
npm install
cp .env.example .env   # BOT_TOKEN, REDIS_URL, ADMIN_IDS ni to'ldiring
npm run dev            # dev rejim (watch)
# yoki
npm run build && npm start
```

## Buyruqlar

| Buyruq    | Kim uchun | Nima qiladi |
|-----------|-----------|-------------|
| `/start`  | hamma     | Sherik sonini tanlash (1–4, guruh jami 2–5 kishi) yoki navbatdagi holatni ko'rsatish |
| `/status` | hamma     | Navbatdagi o'rin |
| `/cancel` | hamma     | Navbatdan chiqish |
| `/id`     | hamma     | O'z Telegram ID'sini ko'rish |
| `/stat`   | admin     | Statistika (`ADMIN_IDS` dagi ID'lar uchun) |

## Qanday ishlaydi

Har bir guruh o'lchami (2, 3, 4, 5) uchun alohida navbat bor. Odam navbatga yozilganda va navbat
to'lganda, birinchi N kishi ajratib olinadi va har biriga qolganlarning kontakti (username, ID,
profil havolasi) yuboriladi. Navbatga yozish va guruhni ajratish bitta Redis Lua skriptida
atomar bajariladi, shuning uchun bir vaqtda bosilganda ham hech kim ikki guruhga tushmaydi.

Bir odam bir vaqtda faqat bitta navbatda tura oladi. Redis kalitlari `cd:` prefiksi bilan saqlanadi.
