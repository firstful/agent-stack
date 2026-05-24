# Product Requirements Document — MARP Presentation Editor

## Overview
A web-based, LLM-driven MARP presentation editor supporting conversational slide authoring, theme management, image generation, and website theme scraping.

## Versions

### V1 — Core MVP (Unauthenticated)
- Web app, no auth required
- State stored in cookies
- LLM backend (OpenAI-compatible) with tool calling to edit an in-memory Markdown file and CSS file
- UI splitscreen: rendered MARP presentation + controls + chat sidebar
- Chat sidebar lets user converse with LLM to iteratively build/edit the presentation

### V2 — User Persistence & File Management
- User accounts (simple auth)
- Save presentations to server
- Fork presentations (simple forkable versioning: each save creates a new version node; fork = new branch from any node)
- Browse saved presentations

### V3 — Image Generation
- Generate hero images per slide using DALL-E / Stable Diffusion API
- Insert generated images into slides automatically or via command

### V4 — Theme Scraping & Palette Swapping
- Backend Playwright scraper fetches a given URL and extracts theme information
- Scraper identifies: favicon, web fonts (Google Fonts + @font-face), prominent colors, logo region
- Prominent colors computed by screenshot-based color extraction (vibrant.js / color-thief) + CSS analysis
- User can say "import theme from example.com" via chat, or use the Theme Panel's "Import from URL" button
- Palette-swapped presentations: apply extracted palette to existing deck with one click
- Scraped themes are cached per URL (24h TTL) to avoid redundant scraping
- Themes saved as `ThemePalette` records; can be browsed, reapplied, or deleted
- First-party support for theme palettes as a primitive in the LLM tool system

### V5 — Multimodal Context & File Uploads
- User can upload images (PNG, JPG, WEBP, GIF, SVG) and other file types
- Uploaded files stored in S3-compatible object storage
- Inference provider upgraded to GPT-4o (OpenAI-compatible, multimodal vision support)
- All uploaded images in the session included as part of the multimodal LLM context by default
- LLM sees image content and can reference them when building slides
- Scraped theme palette context injected into the LLM prompt when a theme is active
- Prompt preparation layer: assembles system prompt, user text, media content, tool definitions, and theme context into the multimodal message format
- Uploads managed server-side; file metadata tracked in SQLite
- New session loads all prior uploads as available context

## User Personas
- **Presenter**: Wants to quickly create beautiful slide decks via chat
- **Developer**: Wants fine-grained control via Markdown/CSS + LLM assistance
- **Designer**: Wants to import visual themes from websites and apply palettes

## Constraints
- Must work as a web application (no Electron dependency)
- MARP rendering done client-side via `@marp-team/marp-core`
- LLM calls proxied through backend (API keys never sent to client)
- Cookie storage limited to ~4KB (V1); server storage for V2+
- Theme scraper runs server-side via Puppeteer/Playwright
- Uploads stored in S3-compatible bucket (AWS S3 or MinIO for dev)
- Multimodal provider must support image_url content blocks in user messages
- File uploads limited to 10MB per file, 50MB total per session
