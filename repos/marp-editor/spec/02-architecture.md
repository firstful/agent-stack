# Technical Architecture

## Stack

| Layer            | Choice                                |
|------------------|---------------------------------------|
| Frontend         | Vite + React 18 + TypeScript          |
| Styling          | Tailwind CSS                          |
| MARP Render      | @marp-team/marp-core (client-side)    |
| State (V1)       | React context + cookies (js-cookie)   |
| State (V2+)      | Zustand + server persistence          |
| Backend          | Node.js + Express + TypeScript        |
| Database (V2)    | SQLite via better-sqlite3             |
| LLM API          | OpenAI-compatible (tool calling)      |
| Multimodal LLM   | GPT-4o (vision, audio-capable)        |
| Image Gen        | OpenAI DALL-E 3 / compatible API      |
| Scraper (V4)     | Playwright + JSDOM                    |
| Object Storage   | AWS S3 / MinIO (S3-compatible)        |
| File Upload      | multer + @aws-sdk/client-s3           |

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ MARP     │  │ Chat     │  │ Cookie/SessionStore  │  │
│  │ Preview  │  │ Sidebar  │  │                      │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│  ┌──────────┐  ┌──────────┐                             │
│  │ Editor   │  │ Theme    │                             │
│  │ Controls │  │ Panel    │                             │
│  └──────────┘  └──────────┘                             │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / JSON
┌──────────────────────▼──────────────────────────────────┐
│                   Backend (Express)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ LLM Proxy│  │ Auth(V2) │  │ Theme Scraper (V4)   │  │
│  │ (V5 multi│  │          │  │                      │  │
│  │  modal)  │  │          │  │                      │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Image Gen│  │ File Mgr │  │ Upload Mgr (V5)      │  │
│  │ (V3)     │  │ (V2)     │  │ multer → S3 + DB     │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐ │
│  │  SQLite (better-sqlite3) + S3 Bucket               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Key Flows

### LLM Editing Flow (V1)
1. User types message in chat sidebar
2. Message sent to backend `/api/chat`
3. Backend calls LLM with system prompt + current markdown + CSS + conversation history
4. LLM uses tool calls to: `edit_markdown(changes)`, `edit_css(changes)`, `get_current_state()`
5. Backend applies tool results to in-memory document, returns updated markdown + CSS
6. Client re-renders MARP preview

### File Management Flow (V2)
1. User saves presentation → POST `/api/presentations`
2. Backend stores in SQLite with version number
3. User can list presentations → GET `/api/presentations`
4. Fork = POST `/api/presentations/:id/fork` → creates new entry with incremented version

### Image Generation Flow (V3)
1. LLM or user requests hero image for slide N
2. Backend calls image generation API with prompt
3. Returns URL or base64 data
4. Inserted as `<img>` in slide markdown

### Theme Scraping Flow (V4)
1. User triggers scrape via chat ("import theme from example.com") or Theme Panel "Import from URL" button
2. Client sends POST `/api/scrape-theme` with `{ url: string }`
3. Backend checks cache for that URL; returns cached result if fresh (< 24h)
4. If not cached, backend launches Playwright (headless Chromium), loads page (10s timeout)
5. Scraper runs in parallel extraction passes against the rendered page:

   **Pass 1 — Static HTML/CSS analysis (cheerio, in-process):**
   - Parse `<link rel="icon">` / `apple-touch-icon` / fallback `/favicon.ico`
   - Parse `<link rel="stylesheet">` for Google Fonts URLs
   - Parse inline `<style>` for `@import`, `@font-face`, CSS custom properties (`--*-color`)
   - Extract `<meta name="theme-color">`

   **Pass 2 — Computed style analysis (Playwright in-page):**
   - `document.fonts.ready` → enumerate loaded `font-family` values and their weights
   - Extract computed `color`, `background-color` from `body`, `h1`, `h2`, `p`, `a:link`, `a:visited`
   - Extract all unique `background-color` values from elements occupying > 5% of viewport

   **Pass 3 — Visual analysis (Playwright screenshot → Canvas):**
   - Take full-page screenshot (PNG, 1280x720 viewport)
   - Downsample to 100x56 pixels
   - Run k-means clustering (k=5) on downsampled pixels to find dominant color clusters
   - Filter out near-white and near-black; take top 3-5 saturated clusters as palette
   - Compute relative area weight for each cluster
   - Detect logo region: scan top 200px strip, find region with highest contrast relative to background
   - Extract logo bounding box as `{ x, y, width, height }`

6. Scraper assembles result into `ScrapeResult` (see Data Model)
7. Result cached in-memory Map (key: normalized URL → `{ result, timestamp }`) with 24h TTL
8. Returns response to client
9. User can save the palette via POST `/api/themes` for later reuse
10. User can apply the palette via POST `/api/apply-palette` which generates CSS variables overriding the current theme

### Theme Scraper Pipeline Architecture

```
┌──────────────┐     ┌────────────────┐     ┌─────────────────┐
│  Client       │     │  Express Route  │     │  Scraper Engine  │
│  POST /api/   │────>│  /api/scrape-   │────>│  theme-scraper.ts│
│  scrape-theme │     │  theme.ts       │     │                  │
└──────────────┘     └────────────────┘     └────────┬─────────┘
                                                      │
                               ┌──────────────────────┼──────────────────────┐
                               │                      │                      │
                               ▼                      ▼                      ▼
                     ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐
                     │  Pass 1         │   │  Pass 2          │   │  Pass 3         │
                     │  cheerio parse  │   │  Playwright      │   │  Screenshot +   │
                     │  <link>/<style> │   │  computed styles │   │  k-means colors │
                     └─────────────────┘   └──────────────────┘   └─────────────────┘
                               │                      │                      │
                               └──────────────────────┼──────────────────────┘
                                                      ▼
                                            ┌──────────────────┐
                                            │  Result Assemble │
                                            │  + Cache (24h)   │
                                            └──────────────────┘
                                                      │
                                                      ▼
                                            ┌──────────────────┐
                                            │  Response JSON   │
                                            └──────────────────┘
```

### Playwright Setup
- Playwright installed via `npm install playwright` (not bundled — user runs `npx playwright install chromium`)
- Launched in headless mode with `{ headless: true }` 
- Viewport set to 1280x720
- 10-second navigation timeout; on timeout → return partial result with what was extracted
- Page blocking: block non-essential resource types to save bandwidth — `blockedResourceTypes: ['image', 'media']`. Stylesheets and fonts must load for accurate extraction.
- Proxy support via env `SCRAPER_PROXY_URL` for production deployments

### Error Handling
| Scenario                | Behaviour                                                   |
|-------------------------|-------------------------------------------------------------|
| URL unreachable         | Return 400 `{ error: "Could not reach URL" }`               |
| Timeout (>10s)          | Return partial result with available data                   |
| No fonts found          | `fonts: null` — suggest system font stack                   |
| No colors found         | `colors: null` — suggest default MARP palette               |
| Playwright not installed| Return 503 `{ error: "Scraper unavailable", hint: "..." }`  |
| Invalid URL format      | Return 400 `{ error: "Invalid URL" }`                       |

## V5 — Multimodal & Upload Flows

### File Upload Flow (V5)
1. User drags file onto drop zone or clicks to open file picker
2. Client validates: file type (allowlist), size (< 10MB), total session quota (< 50MB)
3. Client POSTs to `/api/upload` as `multipart/form-data`
4. Server generates UUID filename, uploads to S3 bucket via `@aws-sdk/client-s3`
5. Server inserts record into `uploaded_files` table (id, userId, filename, mimeType, s3Key, size, createdAt)
6. Server returns `{ id, filename, mimeType, s3Url, size }`
7. Client adds file to Zustand store's file list
8. Next LLM chat request automatically includes uploaded media in the multimodal context

### Multimodal Chat Flow (V5)
1. User types message, optionally with uploaded files already in context
2. Client sends POST `/api/chat` with: `{ message, markdown, css, history, activeTheme }`
3. Prompt assembler on server (see `05-prompt-engineering.md`):
   a. Builds system prompt with available tool definitions and session context
   b. If a scraped theme is active, injects palette CSS variables + color/font summary into system prompt
   c. Builds user message content array: `[{ type: "text" }, ...{ type: "image_url" }]` for each uploaded image
   d. Trims context window: drops oldest images if token budget exceeded
4. Backend calls GPT-4o with assembled messages + tool definitions
5. LLM processes images visually, can reference them in tool calls (e.g., "use this logo image in slide 2")
6. Tool calls handled identically to V1 flow — `edit_markdown`, `edit_css`, etc.
7. Updated markdown/CSS returned to client

### New Session Context Assembly (V5)
1. On session start (V2+ authenticated user), client calls GET `/api/uploads`
2. Backend returns list of all files uploaded by this user, with S3 presigned URLs
3. Files displayed in a "Session Files" panel in the UI
4. User can toggle which files are included as context for the next LLM call
5. By default, all image-type uploads are checked ON

## Project Structure

```
marp-editor/
├── spec/
│   ├── 01-prd.md
│   ├── 02-architecture.md
│   ├── 03-ui-ux.md
│   ├── 04-data-model.md
│   └── 05-prompt-engineering.md       (V5)
├── AGENTS.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── server/
│   ├── index.ts           # Express app entry
│   ├── db.ts              # SQLite setup (V2)
│   ├── llm.ts             # LLM API proxy + tool calling (V1)
│   ├── prompt.ts           # Prompt assembler — multimodal context builder (V5)
│   ├── s3.ts              # S3 client wrapper — upload, download, presign (V5)
│   ├── image-gen.ts       # Image generation (V3)
│   ├── theme-scraper.ts   # Website theme scraper (V4)
│   ├── routes/
│   │   ├── chat.ts        # POST /api/chat
│   │   ├── auth.ts        # POST /api/auth/register + login (V2)
│   │   ├── pres.ts        # CRUD /api/presentations (V2)
│   │   ├── images.ts      # POST /api/generate-image (V3)
│   │   ├── theme.ts       # POST /api/scrape-theme, /api/apply-palette,
│   │   │                  #   GET /api/themes, POST /api/themes (V4)
│   │   └── uploads.ts     # POST /api/upload, GET /api/uploads,
│   │                      #   DELETE /api/uploads/:id (V5)
│   └── types.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── types.ts
│   ├── components/
│   │   ├── Presentation.tsx
│   │   ├── ChatSidebar.tsx
│   │   ├── EditorControls.tsx
│   │   ├── SlideNavigator.tsx
│   │   ├── ThemePanel.tsx
│   │   ├── FileUploader.tsx         (V5)
│   │   ├── SessionFiles.tsx         (V5)
│   │   ├── LoginForm.tsx (V2)
│   │   ├── FileManager.tsx (V2)
│   │   └── ImageGenDialog.tsx (V3)
│   ├── lib/
│   │   ├── api.ts
│   │   ├── marp.ts
│   │   ├── cookies.ts
│   │   └── store.ts
│   └── styles/
│       └── index.css
├── scripts/
│   ├── seed.ts (V2)
│   └── setup-s3.ts         # Create S3 bucket + lifecycle policy (V5)
└── .env.example
```
