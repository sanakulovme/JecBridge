# JecBridge MCP

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

> ⚠️ URL ichida maxfiy token bor, uni hech kimga bermang. Token `.jecbridge/token` faylida saqlanadi. Yangilash uchun shu faylni o'chiring.
> Quick tunnel URL'i har ishga tushirishda o'zgaradi. Doimiy manzil uchun Cloudflare named tunnel yoki ngrok static domain ishlating.

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
| `checkpoint`, `list_checkpoints` | Holatni saqlash va ko'rish |
| `diff` | Checkpointdan beri nima o'zgargani |
| `undo` | Checkpointga qaytish (undo'ning o'zi ham qaytariladi) |

## Xavfsizlik

- **Papka qamog'i.** `../`, absolyut yo'llar va symlink orqali loyihadan tashqariga chiqib bo'lmaydi.
- **Maxfiy fayllar yopiq.** `.env*`, `.git/`, `*.pem`, `*.key`, SSH kalitlar o'qilmaydi, yozilmaydi va qidiruvda ko'rinmaydi.
- **Buyruqlar allowlist'da.** Standart holatda faqat `npm`, `node`, `python`, `pytest`, `go`, `cargo`… ruxsat etilgan. `&&`, `|`, `;`, `$(` zanjirlari, `git push` va `git -C` / `--git-dir` bloklangan.
  - Buyruq argumentlari ham tekshiriladi: `cat .env`, `cat ../fayl`, `ls /`, `--prefix=..` ishlamaydi.
  - Nomida `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `AUTH` bor environment o'zgaruvchilari buyruqlarga uzatilmaydi.
  - Shell ishlatilmaydi, Windows'da ham `%VAR%` kengaymaydi va bo'sh joyli argumentlar buzilmaydi.
  - Timeout bo'lganda buyruq barcha bolalar jarayonlari bilan birga to'xtatiladi.
  - Ro'yxatni o'zgartirish: `--allow npm,node,python`
  - Hammasiga ruxsat: `--allow-all-commands`. Faqat o'zingizga tegishli mashinada va ishonchli AI bilan ishlating.
- **Checkpointlar alohida.** Ular `.jecbridge/shadow.git` ichida saqlanadi. Sizning `.git` tarixingizga tegilmaydi.
- **Token.** Har bir HTTP so'rov uchun majburiy: URL ichida yoki `Authorization: Bearer`.
- **`--read-only`.** Faqat o'qish rejimi (kod review uchun). Loyiha papkasiga hech narsa yozilmaydi, server ma'lumotlari vaqtinchalik papkada saqlanadi.

> ⚠️ **Xavfsiz rejim sandbox emas.** `node`, `python`, `npm test` kabi ruxsat etilgan dasturlar loyiha kodini bajaradi, bu kod esa diskdagi istalgan faylni o'qiy oladi. Allowlist tasodifiy xatolardan himoya qiladi, yomon niyatli AI yoki loyihadan emas. To'liq izolyatsiya kerak bo'lsa, JecBridge'ni Docker konteyner yoki alohida foydalanuvchi ichida ishga tushiring.

> `.jecbridge/` papkasini o'z `.gitignore` faylingizga qo'shing.

## MCP'ni qo'llamaydigan provayderlar

DeepSeek, Ollama, OpenAI API kabi oddiy API'lar uchun MCP klientli agent kerak. Masalan:
- **Cline** yoki **Continue** (VS Code). Ular istalgan OpenAI-compatible API va MCP server bilan ishlaydi.
- **OpenAI Agents SDK**. Unda `MCPServerStreamableHttp` orqali shu URL'ga ulanasiz.

## Sinov

```bash
npm test     # 28 ta e2e sinov: noldan qurish, tahrir, undo, xavfsizlik, dev server, stdio, read-only, git'siz rejim
```

## Litsenziya

[MIT](LICENSE)
