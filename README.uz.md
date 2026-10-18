<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="JecBridge" width="360">
  </picture>
</p>

🇬🇧 [English](README.md) · 🇺🇿 O'zbekcha

Kompyuteringizdagi **istalgan kodli loyihani** MCP orqali **istalgan AI provayderga** ulaydi: claude.ai, ChatGPT, Gemini, Claude Desktop, Cursor, Claude Code, VS Code. AI loyihani o'qiydi, o'zgartiradi, testlarni ishga tushiradi yoki noldan quradi. Har bir o'zgarishdan oldin avtomatik checkpoint olinadi, shuning uchun AI xato qilsa bir buyruq bilan orqaga qaytasiz.

## Tezkor boshlash

Faqat [Node.js 22+](https://nodejs.org) kerak. Keyin bitta qator:

```bash
npx jecbridge my-app --tunnel
```

Tamom. Papka yo'q bo'lsa o'zi yaratiladi, tunnel dasturi (cloudflared) birinchi marta avtomatik yuklab olinadi, connector URL'i esa clipboard'ga nusxalanadi. Uni AI'ga qo'ying:

- **claude.ai:** Settings → Connectors → *Add custom connector*
- **ChatGPT:** Settings → Apps & Connectors → *Developer mode* → *Create*
- **Gemini:** Settings → Connected Apps → *Add a custom app*

Keyin masalan shunday yozing: *"Shu loyihada HTML va CSS bilan kalkulyator yarat."* yoki *"Vite + React sayt yarat va ishga tushir."* AI dev server'ni o'zi ishga tushiradi va sizga `http://localhost:...` havolasini beradi.

> [git](https://git-scm.com) ixtiyoriy, lekin tavsiya etiladi: u bilan har bir o'zgarishga avtomatik checkpoint olinadi va undo qilish mumkin bo'ladi. Git bo'lmasa ham qolgan hamma narsa ishlaydi.

## Manba koddan o'rnatish

```bash
git clone https://github.com/sanakulovme/jecbridge.git
cd jecbridge
npm install
npm link        # ixtiyoriy: "jecbridge" buyrug'i hamma joyda ishlaydi
```

## Windows

Node.js'ni (va xohlasangiz git'ni) bir marta PowerShell orqali o'rnating:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git        # ixtiyoriy: checkpoint va undo uchun
```

PowerShell'ni yopib, qayta oching. Keyin:

```powershell
npx jecbridge $HOME\Desktop\my-app --tunnel
```

Windows bo'yicha eslatmalar:
- **Bo'sh joyli yo'llar.** Ularni qo'shtirnoqqa oling: `npx jecbridge "C:\My Projects\app" --tunnel`
- **JSON config'da npx.** Windows'da Claude Desktop `npx` ni to'g'ridan-to'g'ri topmasligi mumkin. Unda `"command": "cmd"` va `"args": ["/c", "npx", "-y", "jecbridge", ...]` yozing.
- **JSON config.** Claude Desktop yoki Cursor config'ida `\` ikki marta yoziladi (`"C:\\Users\\Abbos\\my-app"`) yoki `/` ishlatiladi (`"C:/Users/Abbos/my-app"`).
- **Windows Firewall.** So'rasa, *Private networks* uchun ruxsat bering. Server faqat `127.0.0.1` da tinglaydi, tashqariga faqat tunnel orqali chiqadi.
- **CRLF fayllar.** Windows qator oxiri (CRLF) avtomatik qo'llab-quvvatlanadi: tahrir qilinganda fayl formati buzilmaydi.

## 1. Web provayderlar (claude.ai, ChatGPT, Gemini)

Web AI sizning kompyuteringizni ko'ra olmaydi, shuning uchun JecBridge tunnel ochadi:

```bash
npx jecbridge ~/projects/my-app --tunnel
```

Terminal `https://xxxx.trycloudflare.com/mcp/<token>` ko'rinishidagi public URL chiqaradi va uni clipboard'ga nusxalaydi. cloudflared o'rnatilmagan bo'lsa, rasmiy dastur Cloudflare'ning GitHub sahifasidan bir marta `~/.jecbridge/bin` ga yuklab olinadi.

> ⚠️ URL ichida maxfiy token bor, uni hech kimga bermang. Agar u oshkor bo'lib qolsa, `--new-token` bilan qayta ishga tushiring: shunda barcha eski URL'lar ishlamay qoladi.
> Quick tunnel URL'i har ishga tushirishda o'zgaradi. Doimiy manzil uchun [Tunnel URL xavfsizligi](#tunnel-url-xavfsizligi) bo'limiga qarang.

## 2. Local klientlar (stdio)

**Claude Desktop** (`claude_desktop_config.json`) va **Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "jecbridge": {
      "command": "npx",
      "args": ["-y", "jecbridge", "/TO'LIQ/YO'L/my-app", "--stdio"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add jecbridge -- npx -y jecbridge /path/my-app --stdio
```

## 3. Noldan loyiha

```bash
npx jecbridge ~/projects/yangi-loyiha --tunnel
```

Keyin AI'ga yozing: *"Shu papkada Next.js + Tailwind landing page qur, `npm run build` bilan tekshir."*

## Parametrlar

| Parametr | Vazifasi |
|---|---|
| `--stdio` | stdio transport (Claude Desktop, Cursor, Claude Code) |
| `--port <n>` | HTTP port (standart `8787`, band bo'lsa keyingi bo'sh port) |
| `--host <h>` | HTTP host (standart `127.0.0.1`) |
| `--tunnel` | Web AI'lar uchun public HTTPS URL (cloudflared avtomatik yuklab olinadi) |
| `--token <t>` | Maxfiy token (standart: yaratiladi va saqlanadi; `JECBRIDGE_TOKEN` ham ishlaydi) |
| `--new-token` | Saqlangan tokenni almashtiradi, barcha eski URL'lar ishlamay qoladi |
| `--read-only` | Yozish yo'q, buyruq yo'q, loyihaga hech narsa saqlanmaydi |
| `--allow <a,b,c>` | Buyruqlar ro'yxatini almashtirish |
| `--allow-all-commands` | Istalgan shell buyrug'iga ruxsat (ehtiyot bo'ling) |

## AI'ga beriladigan tool'lar

| Tool | Vazifasi |
|---|---|
| `project_info` | Loyiha turi, asosiy fayllar (package.json, README…) |
| `list_files` | Fayllar daraxti (.gitignore va node_modules hisobga olinmaydi) |
| `read_file` | Qator raqamlari bilan o'qish, oraliq bo'yicha |
| `search_code` | Butun loyihada regex qidiruv (ripgrep) |
| `write_file` | Yangi fayl yaratish yoki to'liq almashtirish |
| `edit_file` | Aniq matn bo'lagini almashtirish (butun faylni qayta yozmasdan) |
| `delete_path`, `move_path` | O'chirish, ko'chirish, qayta nomlash |
| `run_command` | `npm install`, `npm test`, `python main.py`… |
| `start_process` | Dev server yoki watcher'ni fonda ishga tushirish (`npm run dev`) va uning URL'ini olish |
| `process_output`, `stop_process` | Fon jarayonining loglarini ko'rish, to'xtatish |
| `http_get` | O'zi ishga tushirgan dev server sahifasi yoki API'sini tekshirish (faqat `start_process` portlari) |
| `task_plan` | Ko'p bosqichli ish uchun ro'yxat: AI ish tugamasdan "tayyor" demasligi uchun |
| `checkpoint`, `list_checkpoints` | Holatni saqlash va ko'rish |
| `diff` | Checkpointdan beri nima o'zgargani |
| `undo` | Checkpointga qaytish (undo'ning o'zi ham qaytariladi) |

## Coding agent kabi ishlaydi

JecBridge ulangan har qanday AI'ga Claude Code kabi ishlashni buyuradi va buni har bir tool javobida takrorlaydi:

- **Ishni o'zi qiladi.** Sizdan kodni nusxalash, fayl yaratish yoki buyruq ishga tushirishni hech qachon so'ramaydi. Fayllarni `write_file` bilan yozadi, buyruqlarni `run_command` va `start_process` bilan ishga tushiradi.
- **Muammoni darhol tuzatadi.** Xato bergan buyruq, yiqilgan test yoki to'xtab qolgan server "sababini tuzatib, o'zing qayta urin" degan ko'rsatma bilan qaytadi.
- **Hisobot berishdan oldin tekshiradi.** Testlar yoki build'ni ishga tushiradi, dev server'ni ochadi va uni `http_get` bilan tekshiradi.
- **Vaqtidan oldin "tayyor" demaydi.** Ko'p bosqichli ish `task_plan` da har bir band tekshirilmaguncha kuzatib boriladi.
- **Sizga faqat natija aytiladi:** endi nima ishlaydi va qayerda.

Faqat xavfsizlik qoidalari bundan mustasno: AI ularni chetlab o'tmaydi, buning o'rniga sizga aniq nimaga ruxsat kerakligini aytadi.

## Undo: xato o'zgarishdan qanday tiklanish

Har bir o'zgarishdan oldin avtomatik checkpoint olinadi va unga fayl yoki buyruq nomi yoziladi, masalan `auto: before edit_file src/math.js`. Tasavvur qiling, AI avval foydali o'zgarish qildi, keyin nimanidir buzadigan ikkinchi o'zgarish qildi:

1. Yozing: *"Checkpointlarni ko'rsat."* AI `list_checkpoints` ni chaqiradi, eng yangisi tepada bo'ladi:
   ```
   a1b2c3d  auto: before edit_file src/math.js     ← buzuvchi o'zgarishdan oldin olingan
   e4f5a6b  auto: before edit_file src/math.js     ← foydali o'zgarishdan oldin olingan
   ```
2. Yozing: *"a1b2c3d ga undo qil."* Buzuvchi o'zgarish qaytariladi, foydalisi joyida qoladi.
3. Fikringiz o'zgardimi? Undo'dan oldingi holat ham saqlangan (`redoId`), shuning uchun undo'ning o'zini ham qaytarish mumkin.

Undo nimani tiklaydi va nimani tiklamaydi:

| Tiklanadi | Tiklanmaydi |
|---|---|
| Loyihadagi fayllar, jumladan o'chirilgan va yangi fayllar | E'tiborsiz qoldiriladigan papkalar: `node_modules`, `dist`, `build`, `.venv`, `.env*` va `.gitignore` dagi hamma narsa |
| | Buyruqlarning tashqi ta'siri: global o'rnatishlar, ma'lumotlar bazasi, API chaqiruvlar, emaillar, o'z repongizdagi `git` amallari |
| | Loyiha papkasidan tashqaridagi hamma narsa |

Bu "bitta o'zgarishni bekor qilish" emas, "nuqtaga qaytish": tanlangan checkpoint'dan keyingi hamma narsa qaytariladi.

## Xavfsizlik

- **Papka qamog'i.** `../`, absolyut yo'llar va symlink orqali loyihadan tashqariga chiqib bo'lmaydi. Har bir yo'l tekshiruvdan oldin `realpath` bilan hal qilinadi. Shuning uchun `~/.ssh` ga ishora qiluvchi symlink fayl tool'lari, qidiruv, `project_info` va buyruq argumentlarida bir xilda rad etiladi.
- **Maxfiy fayllar yopiq.** `.env*`, `.git/`, `*.pem`, `*.key`, SSH kalitlar o'qilmaydi, yozilmaydi va qidiruvda ko'rinmaydi.
- **Buyruqlar allowlist'da.** Standart holatda faqat `npm`, `node`, `python`, `pytest`, `go`, `cargo`… ruxsat etilgan. `&&`, `|`, `;`, `$(` zanjirlari, `git push` va `git -C` / `--git-dir` bloklangan.
  - Buyruq argumentlari ham tekshiriladi: `cat .env`, `cat ../fayl`, `ls /`, `--prefix=..` ishlamaydi.
  - Nomida `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `AUTH` bor environment o'zgaruvchilari buyruqlarga uzatilmaydi.
  - Shell ishlatilmaydi, Windows'da ham `%VAR%` kengaymaydi va bo'sh joyli argumentlar buzilmaydi.
  - Timeout bo'lganda buyruq barcha bolalar jarayonlari bilan birga to'xtatiladi.
  - Ro'yxatni o'zgartirish: `--allow npm,node,python`
  - Hammasiga ruxsat: `--allow-all-commands`. Faqat o'zingizga tegishli mashinada va ishonchli AI bilan ishlating.
- **Checkpointlar alohida.** Ular `.jecbridge/shadow.git` ichida saqlanadi. Sizning `.git` tarixingizga tegilmaydi.
- **Token.** Har bir HTTP so'rov uchun tasodifiy 192-bitli token majburiy: URL ichida yoki `Authorization: Bearer`. Noto'g'ri token bilan kelgan so'rovlar yuboruvchining IP manzili bilan logga yoziladi. 10 daqiqada 20 marta xato qilgan manzil bloklanadi.
- **`--read-only`.** Faqat o'qish rejimi (kod review uchun). Loyiha papkasiga hech narsa yozilmaydi, server ma'lumotlari vaqtinchalik papkada saqlanadi.

> ⚠️ **Xavfsiz rejim sandbox emas.** `node`, `python`, `npm test` kabi ruxsat etilgan dasturlar loyiha kodini bajaradi, bu kod esa diskdagi istalgan faylni o'qiy oladi. Allowlist tasodifiy xatolardan himoya qiladi, yomon niyatli AI yoki loyihadan emas. To'liq izolyatsiya kerak bo'lsa, JecBridge'ni Docker konteyner yoki alohida foydalanuvchi ichida ishga tushiring.

> `.jecbridge/` papkasini o'z `.gitignore` faylingizga qo'shing.

### Tunnel URL xavfsizligi

`--tunnel` rejimida URL'ning o'zi maxfiy kalit: u kimda bo'lsa, sizning AI'ingiz bilan bir xil huquqqa ega bo'ladi.

- **Quick tunnel qisqa umrli.** JecBridge to'xtatilganda URL o'ladi, har ishga tushirishda yangisi yaratiladi.
- **URL oshkor bo'ldimi?** `--new-token` bilan qayta ishga tushiring. Eski URL'lar `401 Unauthorized` oladi.
- **Terminalni kuzating.** Rad etilgan har bir so'rov yuboruvchining IP manzili bilan ko'rsatiladi.

Doimiy manzil va qo'shimcha himoya uchun JecBridge'ni `--tunnel` siz ishga tushirib, oldiga o'zingizning **Cloudflare named tunnel**'ingizni qo'ying. Buning uchun bepul Cloudflare akkaunti va domen kerak:

```bash
npx jecbridge my-app                       # http://127.0.0.1:8787 da ishlaydi
cloudflared tunnel login
cloudflared tunnel create jecbridge
cloudflared tunnel route dns jecbridge mcp.example.com
cloudflared tunnel run --url http://127.0.0.1:8787 jecbridge
```

Keyin `mcp.example.com` oldiga **Cloudflare Access** qo'yishingiz mumkin: Zero Trust → Access → Applications. Lekin web AI serverlari Access'ning interaktiv login oynasidan o'ta olmaydi. Custom header yubora oladigan klientlar uchun Access **service token** ishlating, JecBridge token'ini esa ikkinchi himoya qatlami sifatida qoldiring.

## MCP'ni qo'llamaydigan provayderlar

DeepSeek, Ollama, OpenAI API kabi oddiy API'lar uchun MCP klientli agent kerak. Masalan:
- **Cline** yoki **Continue** (VS Code). Ular istalgan OpenAI-compatible API va MCP server bilan ishlaydi.
- **OpenAI Agents SDK**. Unda `MCPServerStreamableHttp` orqali shu URL'ga ulanasiz.

## Sinov

```bash
npm test     # 36 ta e2e sinov: noldan qurish, tahrir, undo, xavfsizlik, dev server, stdio, read-only, git'siz rejim
```

## Litsenziya

[MIT](LICENSE)
