# Data Model Specification

## Core Types (TypeScript)

```typescript
// ── Presentation ──
interface Presentation {
  id: string
  title: string
  markdown: string
  css: string
  theme: string
  version: number
  parentId: string | null       // for fork tracking
  forkOrigin: string | null     // "forked from <id>@v<version>"
  createdAt: number
  updatedAt: number
  userId: string | null         // null for anonymous (V1)
}

// ── Session / Cookie State (V1) ──
interface SessionState {
  presentationId: string
  markdown: string
  css: string
  theme: string
}

// ── Chat Message ──
interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
}

// ── Tool Call (LLM) ──
interface ToolCall {
  id: string
  type: 'edit_markdown' | 'edit_css' | 'get_state' | 'generate_image' | 'apply_theme'
  arguments: Record<string, unknown>
}

// ── Uploaded File (V5) ──
interface UploadedFile {
  id: string
  userId: string
  filename: string
  mimeType: string
  s3Key: string                     // object key in S3 bucket, e.g. "uploads/<uuid>.<ext>"
  s3Bucket: string
  size: number                      // bytes
  width?: number                    // extracted for images
  height?: number                   // extracted for images
  createdAt: number
}

// ── S3 Configuration ──
interface S3Config {
  region: string
  bucket: string
  endpoint: string                  // custom endpoint for MinIO; leave blank for AWS
  accessKeyId: string
  secretAccessKey: string
  presignExpires: number            // presigned URL TTL in seconds (default 3600)
}

// ── Media Content Block (OpenAI multimodal format) ──
type MediaContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

// ── Assembled Prompt Context (V5) ──
interface AssembledPrompt {
  systemPrompt: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | MediaContentBlock[]
  }>
  tools: ToolDefinition[]
  tokenEstimate: number
}

// ── Tool Definition (for LLM function calling) ──
interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>   // JSON Schema
  }
}

// ── Active Theme Context (injected into prompt) ──
interface ThemeContext {
  name: string
  isScraped: boolean
  sourceUrl?: string
  palette: {
    primary: string
    secondary: string
    background: string
    text: string
    accent: string
  }
  fonts: {
    heading: string
    body: string
  }
  cssSummary: string                    // key CSS variable declarations as text
}

// ── User (V2) ──
interface User {
  id: string
  username: string
  passwordHash: string
  createdAt: number
}

// ── Theme Palette (V4) ──
interface ThemePalette {
  id: string
  name: string
  sourceUrl: string
  colors: {
    primary: string
    secondary: string
    background: string
    text: string
    accent: string
    additional: string[]
  }
  fonts: {
    heading: string
    body: string
    fallback: string
  }
  logo?: {
    dataUrl: string
    position: { x: number; y: number; width: number; height: number }
  }
}

// ── Scrape Result (V4 raw scraper output) ──
interface ScrapeResult {
  url: string
  scrapedAt: number
  favicon: string | null             // absolute URL to favicon
  fonts: {
    heading: string | null           // most common heading font-family
    body: string | null              // most common body font-family
    families: Array<{
      family: string
      weights: number[]
      source: 'google' | 'font-face' | 'system'
      url?: string                   // CSS URL if Google Fonts / @font-face
    }>
  }
  colors: {
    meta: string | null              // <meta name="theme-color">
    palette: Array<{
      hex: string
      rgb: [number, number, number]
      area: number                   // relative screen area (0–1)
      source: 'dominant' | 'computed' | 'meta'
    }>
    computed: {
      bodyText: string | null
      bodyBg: string | null
      link: string | null
      headings: string | null
    }
  }
  logo: {
    detected: boolean
    boundingBox: { x: number; y: number; width: number; height: number } | null
    dataUrl: string | null           // cropped logo image as base64 PNG
  } | null
  screenshot: string | null          // full page screenshot as base64 PNG (optional, for preview)
}

// ── Version Node (V2 forkable versioning) ──
interface VersionNode {
  id: string
  presentationId: string
  version: number
  parentVersion: number | null
  markdown: string
  css: string
  title: string
  createdAt: number
  isFork: boolean
  forkLabel?: string
}
```

## Database Schema (SQLite, V2+)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE presentations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE version_nodes (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_version INTEGER,
  markdown TEXT NOT NULL,
  css TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_fork INTEGER NOT NULL DEFAULT 0,
  fork_label TEXT,
  FOREIGN KEY (presentation_id) REFERENCES presentations(id)
);

CREATE TABLE theme_palettes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  palette_json TEXT NOT NULL,
  user_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE uploaded_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  s3_bucket TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_uploaded_files_user ON uploaded_files(user_id, created_at);
```

## Forkable Versioning Strategy

Version history is a tree (not a linear chain):

```
v1 ── v2 ── v3 ── v4  (main branch)
        │
        └── v2.1 ── v2.2  (fork)
```

Each version node stores the complete markdown + CSS at that point.
`parent_version` links to the version number it was forked from.
`is_fork` marks nodes that are branch points.

## API Endpoints

| Method | Path                              | Description              | Version |
|--------|-----------------------------------|--------------------------|---------|
| POST   | /api/chat                         | Send chat + LLM tool call| V1      |
| GET    | /api/state                        | Get current state        | V1      |
| POST   | /api/auth/register                | Register user            | V2      |
| POST   | /api/auth/login                   | Login                    | V2      |
| GET    | /api/presentations                | List user presentations  | V2      |
| POST   | /api/presentations                | Create new               | V2      |
| GET    | /api/presentations/:id            | Get presentation         | V2      |
| PUT    | /api/presentations/:id            | Update (new version)     | V2      |
| POST   | /api/presentations/:id/fork       | Fork at version          | V2      |
| GET    | /api/presentations/:id/versions   | Get version tree         | V2      |
| POST   | /api/generate-image               | Generate hero image      | V3      |
| POST   | /api/scrape-theme                 | Scrape theme from URL    | V4      |
| GET    | /api/themes                       | List saved themes        | V4      |
| POST   | /api/themes                       | Save theme palette       | V4      |
| DELETE | /api/themes/:id                   | Delete saved theme       | V4      |
| POST   | /api/apply-palette                | Apply palette to deck    | V4      |
| POST   | /api/upload                       | Upload file (multipart)  | V5      |
| GET    | /api/uploads                      | List user's uploaded files| V5      |
| GET    | /api/uploads/:id                  | Get file metadata        | V5      |
| GET    | /api/uploads/:id/download         | Get presigned download URL| V5      |
| DELETE | /api/uploads/:id                  | Delete file from S3 + DB | V5      |
| PATCH  | /api/uploads/:id/toggle-context   | Toggle file in/out of LLM| V5      |
|        |                                   | context for current session|        |

## Cookie Schema (V1)

```
marp_session = {
  pid: string,        // presentation ID
  md: string,         // markdown content (may be truncated)
  css: string,        // CSS content (may be truncated)
  theme: string       // theme name
}
```

Cookies are used for V1 anonymous state. For V2+, the server stores state and cookies only hold a session token.
