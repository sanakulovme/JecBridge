# JecBridge MCP

🇬🇧 [English](README.md) · 🇺🇿 O'zbekcha

Kompyuteringizdagi **istalgan kodli loyihani** MCP orqali **istalgan AI provayderga** ulaydi: claude.ai, ChatGPT, Claude Desktop, Cursor, Claude Code, VS Code. AI loyihani o'qiydi, o'zgartiradi, testlarni ishga tushiradi yoki noldan quradi. Har bir o'zgarishdan oldin avtomatik checkpoint olinadi, shuning uchun AI xato qilsa bir buyruq bilan orqaga qaytasiz.

## O'rnatish

Node.js 22+ va git kerak.

```bash
git clone https://github.com/sanakulovme/jecbridge.git
cd jecbridge
npm install
npm link        # ixtiyoriy: "jecbridge" buyrug'i hamma joyda ishlaydi
```

## Windows'da o'rnatish

PowerShell'ni oching:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install BurntSushi.ripgrep.MSVC        # ixtiyoriy: tezroq qidiruv uchun
winget install Cloudflare.cloudflared         # claude.ai / ChatGPT uchun
```

O'rnatgandan keyin PowerShell'ni **yopib qayta oching**, shunda yangi buyruqlar PATH'ga tushadi. Keyin:

```powershell
git clone https://github.com/sanakulovme/jecbridge.git $HOME\jecbridge
cd $HOME\jecbridge
npm install
npx jecbridge C:\Users\Abbos\projects\my-app --tunnel
```

Windows bo'yicha eslatmalar:
- **Bo'sh joyli yo'llar.** Ularni qo'shtirnoqqa oling: `node src\cli.js "C:\My Projects\app" --tunnel`
- **JSON config.** Claude Desktop yoki Cursor config'ida `\` ikki marta yoziladi (`"C:\\Users\\Abbos\\my-app"`) yoki `/` ishlatiladi (`"C:/Users/Abbos/my-app"`).
- **Windows Firewall.** So'rasa, *Private networks* uchun ruxsat bering. Server faqat `127.0.0.1` da tinglaydi, tashqariga faqat tunnel orqali chiqadi.
- **CRLF fayllar.** Windows qator oxiri (CRLF) avtomatik qo'llab-quvvatlanadi: tahrir qilinganda fayl formati buzilmaydi.

## 1. Web provayderlar (claude.ai, ChatGPT)

Web AI sizning kompyuteringizni ko'ra olmaydi, shuning uchun tunnel kerak:

```bash
brew install cloudflared                 # bir marta (Windows: winget install Cloudflare.cloudflared)
npx jecbridge ~/projects/my-app --tunnel
```

Terminal public URL chiqaradi: `https://xxxx.trycloudflare.com/mcp/<token>`

- **claude.ai:** Settings → Connectors → *Add custom connector* → URL'ni qo'ying
- **ChatGPT:** Settings → Apps & Connectors → *Developer mode* yoqing → *Create* → URL'ni qo'ying

> ⚠️ URL ichida maxfiy token bor, uni hech kimga bermang. Token `.jecbridge/token` faylida saqlanadi. Yangilash uchun shu faylni o'chiring.
> Quick tunnel URL'i har ishga tushirishda o'zgaradi. Doimiy manzil uchun Cloudflare named tunnel yoki ngrok static domain ishlating.

## 2. Local klientlar (stdio)

**Claude Desktop** (`claude_desktop_config.json`) va **Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "jecbridge": {
      "command": "node",
      "args": ["/TO'LIQ/YO'L/jecbridge/src/cli.js", "/TO'LIQ/YO'L/my-app", "--stdio"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add jecbridge -- node /path/jecbridge/src/cli.js /path/my-app --stdio
```

## 3. Noldan loyiha

```bash
jecbridge ~/projects/yangi-loyiha --init --tunnel
```

Keyin AI'ga yozing: *"Shu papkada Next.js + Tailwind landing page qur, `npm run build` bilan tekshir."*

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
npm test     # 20 ta e2e sinov: noldan qurish, tahrir, undo, xavfsizlik, stdio, read-only
```
