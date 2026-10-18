# Dragon Coin: GitHub + Render orqali bepul ishga tushirish

Bitta Node.js servis: sahifani beradi, @dragon_pcode kanalidagi promokodlarni avtomatik oladi,
obunani tekshiradi, vazifa va auksionlarni hamma foydalanuvchi uchun umumiy saqlaydi.

## 1. Bot va kanal
1. Telegramda @BotFather → `/newbot` → tokenni nusxalang.
2. Botni @dragon_pcode kanaliga **administrator** qilib qo'shing (postlarni o'qish uchun shart).
3. @userinfobot ga `/start` yozing, u sizning Telegram ID raqamingizni aytadi (admin shu ID).

## 2. Bepul baza (Upstash)
Render bepul tarifida fayllar saqlanmaydi, shuning uchun bepul Redis kerak.
1. https://upstash.com da ro'yxatdan o'ting → **Create Database** (Redis, bepul).
2. Bazaning **REST API** bo'limidan `UPSTASH_REDIS_REST_URL` va `UPSTASH_REDIS_REST_TOKEN` ni nusxalang.

## 3. GitHub
1. github.com da yangi **private** repo oching (masalan `dragon-coin`).
2. Shu papkadagi hamma fayllarni yuklang (`Add file → Upload files`). `public/index.html` ham kerak.

## 4. Render
1. https://render.com → **New → Web Service** → GitHub repoingizni tanlang.
2. Runtime: **Node**, Build: `npm install`, Start: `npm start`, Plan: **Free**.
   (Yoki **New → Blueprint** tanlasangiz `render.yaml` hammasini o'zi to'ldiradi.)
3. **Environment** bo'limiga yozing:

| Nomi | Qiymati |
|---|---|
| `BOT_TOKEN` | BotFather bergan token |
| `ADMIN_IDS` | sizning Telegram ID (bir nechta bo'lsa vergul bilan) |
| `CHANNEL` | `dragon_pcode` |
| `UPSTASH_REDIS_REST_URL` | Upstash'dan |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash'dan |

4. **Deploy**. Tayyor bo'lgach manzil chiqadi: `https://dragon-coin-xxxx.onrender.com`.
   Server ishga tushganda kanal webhooki o'zi ulanadi.

## 5. Botga Mini App ulash
@BotFather → `/mybots` → botingiz → **Bot Settings → Menu Button** → Render manzilini kiriting.
Yoki `/newapp` bilan Mini App yarating.

## 6. Foydalanish
- Admin panel faqat `ADMIN_IDS` dagi akkauntda, Telegram ichida Profil bo'limida chiqadi.
- Kanalga post yuboring, bot o'zi promokod qiladi:
  - `KOD: DRAGON500 | 500 coin`
  - `KOD: OLMOS5 | 5 olmos`
  - `KOD: TEZ100 | 300 coin | 100 ta`  (oxirgisi: eng ko'p necha kishi olishi)
- Vazifa va auksionlarni admin paneldan qo'shing, hamma ko'radi.

## Bilib qo'ying
- Render bepul servisi 15 daqiqa so'rov bo'lmasa uxlaydi, birinchi ochilish 30-60 soniya olishi mumkin.
  Oldini olish: https://uptimerobot.com da bepul monitor yarating, `https://SIZNING-MANZIL/health` ni har 5 daqiqada tekshirsin.
- Coin va olmos balansi hozircha foydalanuvchining telefonida saqlanadi. Tajribali foydalanuvchi uni o'zgartirishi mumkin.
  Auksion takliflari va promokodlar esa serverda tekshiriladi. Balansni ham serverga o'tkazish kerak bo'lsa, buni alohida qilish mumkin.
- "Botga start" vazifasini Telegram tekshirishga ruxsat bermaydi, u 4 soniya kutish bilan ishlaydi.
- Fayl ichidagi `DEMO_ADMIN` `false` qilib qo'yilgan, shuning uchun brauzerdan admin panel ochilmaydi.
