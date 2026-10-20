# AWS tayyorgarlik tekshiruvi — 2026-10-19

Mo‘ljal: `riizq.uz`, bitta EC2/Lightsail Ubuntu 24.04 LTS serveri. v1’da
yuklangan fayllar serverdagi private volume’da (`STORAGE_DRIVER=local`); S3 v2’da.

| Tekshiruv | Natija |
| --- | --- |
| Backend unit testlari | 934 test, 53 fayl — o‘tdi |
| Frontend testlari | 170 test, 16 fayl — o‘tdi |
| Production config generator | 4 test — o‘tdi; standart lokal storage, S3 faqat `--storage s3` bilan, fresh secrets, 0600/0700, overwrite refusal, raw password transport |
| Backend typecheck, lint, format | o‘tdi |
| Frontend Docker build/typecheck/bundle verification | o‘tdi; same-origin `/api/v1`, demo kodi yo‘q |
| API va web Docker image | joriy kod bilan yig‘ildi; UID 10001, `/data/uploads` 10001:10001 `0700` |
| Migratsiya va kasallik ma’lumotnomasi | yangi DB’da va takroriy ishga tushirishda o‘tdi |
| Runtime DB huquqlari | schema CREATE, audit UPDATE, farm DELETE rad; user INSERT ruxsat |
| Backup/restore | read-only backup roli dump qildi; alohida DB’da data va grant’lar tiklandi |
| HTTPS smoke | ishonilgan lokal CA, HTTP va `www` → apex redirect, SPA, asset cache/404, API routing, dependency health, private portlar |
| Uploads volume | API foydalanuvchisiga tegishli, konteyner qayta yaratilganda saqlanadi, backup’dagi `tar` oqimi o‘qiydi |
| Deploy skriptlari | `bash -n` va shellcheck 0.10.0 — ogohlantirishsiz |
| Trivy API va web | `HIGH,CRITICAL --ignore-unfixed` filtri bilan 0 finding (CI); yangi image’lar CI’da qayta skanerlanadi |
| Source arxivi | checksum, `.env*` va haqiqiy private qiymatlar yo‘qligi tekshirildi |

Caddy’ning rasmiy tayyor 2.11.7 image’ida 4 ta fixable HIGH finding aniqlandi.
Shu release Go 1.27.2 va `golang.org/x/net` 0.60.0 bilan qayta yig‘ilgach,
yakuniy image skani o‘tdi. Versiyalar `apps/frontend/caddy/go.mod` va `go.sum`
orqali saqlanadi; CI ikkala image’ni qayta skanerlaydi.

Lokal `.deploy/aws/api.env` v1 rejimiga o‘tkazildi: `STORAGE_DRIVER=local`,
`UPLOAD_LOCAL_DIR=/data/uploads`, bo‘sh `S3_*` qatorlari olib tashlandi (oldingi
nusxa `api.env.bak-20261019T153820Z`; secret’lar o‘zgarmadi). Offline preflight
endi to‘liq o‘tadi. `.deploy/releases/` dagi yangi source arxiv joriy kodni
o‘z ichiga oladi; 13:21 dagi eski arxiv eskirgan.

Tashqi muhitda hali bajariladigan ishlar:

- `riizq.uz` A yozuvini server IP’siga o‘zgartirish (hozir `45.138.159.4` —
  registrator hostingi) va public ACME sertifikati; `www` allaqachon apex’ga
  CNAME;
- Eskiz sender/shablon/balans va haqiqiy SMS yetkazilishi;
- operatorning age public kaliti, shifrlangan backup’ni server tashqarisiga
  muntazam ko‘chirish (v1’da S3 yo‘q) va monitoring;
- haqiqiy trafik bo‘yicha yuklama testi;
- v2: S3 bucket/IAM va mavjud fayllarni bucket’ga ko‘chirish (README 2-bo‘lim).

Lokal smoke AWS/SMS’ga murojaat qilmaydi; lokal uploads volume va Caddy
internal CA ishlatadi. PostgreSQL dump/restore va uploads `tar` oqimi sinovdan
o‘tdi; operator kaliti bilan age encryption hali bajarilmadi. Production AWS
resurslari yaratilmadi, serverga deploy qilinmadi, haqiqiy SMS yuborilmadi.
Testlar faqat o‘zining vaqtinchalik Compose project, konteyner va
volume’larini o‘chiradi.
