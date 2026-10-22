# Mening Fermam

Fermerlar uchun ferma, hayvonlar, ombor va veterinariya ma’lumotlarini
yuritish ilovasi. npm workspaces monorepo:

| Papka | Nima | Hujjat |
| --- | --- | --- |
| [`apps/backend`](apps/backend) | NestJS 12 API (Prisma 7, PostgreSQL 16, Redis 7, S3) | [`apps/backend/README.md`](apps/backend/README.md) |
| [`apps/frontend`](apps/frontend) | React + Vite web ilova | [`apps/frontend/README.md`](apps/frontend/README.md) |

## Tez start

Talab: Node.js 22+, npm (pnpm/yarn emas), Docker Desktop yoqilgan (Compose v2).

```sh
npm ci                                                              # bitta root lockfile
cp apps/backend/.env.example apps/backend/.env                      # backend dev qiymatlar
cp apps/frontend/.env.example apps/frontend/.env.development.local  # frontend dev qiymatlar
npm run start:dev:all   # backend (Docker, fonda) tayyor bo‘lgach → frontend http://localhost:5173
```

`start:dev:all` backend’ni fonda ko‘taradi va API sog‘lom bo‘lishini kutadi;
Ctrl+C faqat frontend’ni to‘xtatadi. Backend loglari: `npm run dev:logs`,
to‘xtatish: `npm run dev:down`. Backend’ni loglari bilan oldingi rejimda
ko‘tarish: `npm run start:dev` (frontend alohida terminalda `npm run dev:web`).

## Google bilan kirish (v1) va SMS

v1’da SMS o‘chiq (`SMS_ENABLED=false`, Eskiz akkaunti tasdiqlanguncha):
fermerlar **“Google bilan kirish”** tugmasi orqali kiradi — birinchi kirishda
`FARMER` hisobi avtomatik ochiladi. Administrator xodim qo‘shganda uning Google
emailini kiritadi; o‘sha Google akkaunt bilan kirganda hisob bog‘lanadi.
Admin rollari Google’dan keyin ham TOTP (ikki bosqichli) kodini kiritadi.
Telefon + parol bilan kirish (admin bergan hisoblar, demo) ishlashda davom etadi.

Google Client ID olish (bepul, bir marta):

1. [Google Cloud Console](https://console.cloud.google.com/) → loyiha yarating.
2. **APIs & Services → OAuth consent screen**: *External*, ilova nomi va email.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   *Authorized JavaScript origins*: `http://localhost:5173` (dev) va
   `https://riizq.uz` (production). Redirect URI kerak emas.
4. Client ID’ni (`…apps.googleusercontent.com`) `apps/backend/.env` dagi
   `GOOGLE_CLIENT_ID=` ga yozing va `npm run dev:restart`. Client secret kerak emas.

Birinchi haqiqiy SUPER_ADMIN (Google email bilan, parolsiz):

```sh
docker compose -f apps/backend/compose.dev.yaml exec \
  -e BOOTSTRAP_EMAIL=siz@gmail.com -e 'BOOTSTRAP_FULL_NAME=Ism Familiya' \
  api node dist/cli/create-super-admin.js
```

Demo SUPER_ADMIN yangi foydalanuvchi yarata olmaydi (ataylab: demo
akkauntlar faqat namoyish uchun) — foydalanuvchilarni haqiqiy admin qo‘shadi.

SMS’ni qayta yoqish (v2): `SMS_ENABLED=true`, Eskiz sozlamalari —
[Eskiz OTP qo‘llanmasi](apps/backend/docs/operations/eskiz-otp.md). Dev’da
`SMS_PROVIDER=mock` kodlari `http://localhost:3001/api/v1/dev/sms-inbox` da.

## Asosiy komandalar (root)

| Komanda | Vazifasi |
| --- | --- |
| `npm run start:dev:all` | backend (fonda) + frontend dev server |
| `npm run start:dev` | backend dev stack, loglar terminalda |
| `npm run dev:up` / `dev:down` / `dev:logs` / `dev:reset` | backend stack: fonda ko‘tarish / to‘xtatish / loglar / volume’lar bilan o‘chirish |
| `npm run dev:web` | frontend dev server |
| `npm run build` | barcha workspace’larni build qilish |
| `npm run lint` / `npm test` | barcha workspace’lar |
| `npm run test:e2e` | backend e2e (`TEST_DATABASE_URL`, `TEST_REDIS_URL` kerak) |
| `npm run audit:deps` | `npm audit --audit-level=high` (butun lockfile) |
| `npm run aws:prepare -- --domain riizq.uz ...` | yangi private production konfiguratsiya; mavjud katalogni qayta yozmaydi |
| `npm run aws:package` | secretsiz AWS source arxivi |
| `npm run test:deploy` / `test:deploy:smoke` | config generator / alohida Docker stack’da HTTPS va migratsiya testlari |

## AWS’da riizq.uz

Bitta Ubuntu 24.04 EC2/Lightsail serveri uchun frontend, API, PostgreSQL,
Redis va avtomatik HTTPS konfiguratsiyasi tayyor:
[AWS deploy yo‘riqnomasi](deploy/aws/README.md).
Production fayllari `.deploy/aws/` da alohida saqlanadi; development `.env`
serverga ko‘chirilmaydi. v1’da yuklangan fayllar serverdagi private volume’da
saqlanadi (S3 — v2’da). Release oldidan DNS’ni server IP’siga yo‘naltirish va
Google OAuth client’ga `https://riizq.uz` origin’ini qo‘shish kerak.

## Muammolar va yechimlar

| Xabar | Yechim |
| --- | --- |
| `failed to connect to the docker API` / `Docker Desktop is manually paused` | Docker Desktop’ni oching (pauzada bo‘lsa — Resume). |
| `failed to resolve source metadata … Temporary failure in name resolution` | Internet/DNS yo‘q (masalan, uyqudan keyin Wi-Fi hali ulanmagan): ulanishni tekshirib qayta ishga tushiring. |
| “Google tugmasini yuklab bo‘lmadi” / tugma ko‘rinmaydi | `GOOGLE_CLIENT_ID` bo‘sh yoki sahifa origin’i Google Console’dagi *Authorized JavaScript origins* ro‘yxatida yo‘q. |
| `This project is configured to use npm` | Loyiha faqat npm bilan: `pnpm …` o‘rniga `npm run …`. |
| Seed: `… demo akkaunti bazada … roli bilan bor, seed esa … kutadi` | `.env` dagi `DEMO_*_PHONE` ni tekshiring; dev baza eski bo‘lsa `npm run dev:reset` (dev volume’lar o‘chadi), so‘ng qayta ishga tushiring. |
| Frontend build: `Production build to‘xtatildi: VITE_DEMO_…` | Demo qiymatlar `apps/frontend/.env` da emas, `.env.development.local` da bo‘lsin. |

## Xavfsizlik va ta’minot zanjiri

- Dependency versiyalari aniq (`.npmrc`: `save-exact=true`), bitta
  `package-lock.json`, o‘rnatish faqat `npm ci`. `packageManager` maydoni
  pnpm/yarn’ni to‘xtatadi (ikkinchi lockfile paydo bo‘lmasligi uchun).
- Dependency install-skriptlari faqat `package.json` → `allowScripts`
  ro‘yxatidagilar uchun (npm 11): `prisma`, `@prisma/engines`, `esbuild`;
  `@scarf/scarf` (telemetriya) va `fsevents` rad etilgan.
- CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): backend
  typecheck, lint, format, unit va e2e testlar; butun repo uchun
  `npm audit` (high/critical → to‘xtaydi), gitleaks (butun tarix), semgrep;
  production image build + Trivy. CodeQL va Dependabot ham yoqilgan.
  Action’lar commit SHA bilan pin qilingan.
- `.env`, upload fayllar, DB dump/backup va private kalitlar Git’ga ham,
  Docker build context’ga ham kirmaydi (`.gitignore`, `.dockerignore`).
- Batafsil: [`apps/backend/docs/security/overview.md`](apps/backend/docs/security/overview.md).
