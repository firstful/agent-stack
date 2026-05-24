# Prompt Engineering — Multimodal Context Assembly

## Overview

The prompt assembler (`server/prompt.ts`) is responsible for constructing the messages array sent to GPT-4o on every `/api/chat` call. It merges four sources of context into a coherent multimodal prompt:

1. **Base system prompt** — defines the LLM's role as a MARP slide assistant
2. **Document state** — current markdown + CSS (conveyed via tool state, not in prompt)
3. **Uploaded media** — user images included as `image_url` content blocks
4. **Active theme context** — if a scraped theme is applied, its palette and CSS variables are injected

## Prompt Assembly Pipeline

```
┌──────────────┐     ┌─────────────────┐     ┌───────────────────┐
│  Incoming    │────>│  Context         │────>│  Token Budget     │
│  Chat Request│     │  Collector       │     │  Manager          │
│  {message,   │     │                  │     │                   │
│   markdown,  │     │  • system prompt │     │  • estimate tokens│
│   css,       │     │  • theme context │     │  • drop oldest    │
│   history,   │     │  • media files   │     │    images if over │
│   fileIds,   │     │  • user message  │     │  • warn on low    │
│   activeTheme}│     │  • tool defs     │     │    budget         │
└──────────────┘     └────────┬────────┘     └────────┬───────────┘
                              │                       │
                              ▼                       ▼
                     ┌─────────────────────────────────────┐
                     │  Message Array Assembler            │
                     │  ┌───────────────────────────────┐  │
                     │  │ messages = [                  │  │
                     │  │   { role: "system",           │  │
                     │  │     content: systemPrompt },  │  │
                     │  │   ...history,                 │  │
                     │  │   { role: "user",             │  │
                     │  │     content: [                │  │
                     │  │       { type: "text",         │  │
                     │  │         text: userMsg },      │  │
                     │  │       { type: "image_url",    │  │
                     │  │         image_url: { url } }, │  │
                     │  │       ...                     │  │
                     │  │     ]}                        │  │
                     │  └───────────────────────────────┘  │
                     └─────────────────────────────────────┘
                                      │
                                      ▼
                              ┌────────────────┐
                              │  GPT-4o API    │
                              │  + tool calling │
                              └────────────────┘
```

## Base System Prompt

The system prompt is composed from these sections, concatenated with newlines:

```
You are a MARP presentation editor assistant.
You help users create and edit MARP Markdown slide decks through conversation.
You have access to tool calls that let you edit the markdown and CSS of the presentation.

## Capabilities
- Edit the presentation markdown to add, remove, or modify slides
- Edit the CSS to change themes, layouts, and styling
- View the current markdown and CSS state
- Reference uploaded images in slide content
- Work with applied themes and palettes

## MARP Markdown Format
MARP uses standard Markdown with `---` as slide separators.
Front matter (YAML between `---` delimiters at the top) controls presentation settings:

---
marp: true
theme: default
size: 16:9
paginate: true
---

Key directives:
- `<!-- fit -->` after a heading to scale it to fill the slide
- `_class: <name>` in front matter to apply a CSS class
- `_backgroundColor: <color>` per-slide background

## Image Handling
When users have uploaded images, you can reference them in slides using standard Markdown image syntax:
  ![alt text](uploaded://<file-id>)
The platform will resolve these URLs at render time. Refer to the "Session Files" section below for available images.

Always produce complete, valid MARP Markdown. Preserve existing content unless the user asks for changes.
```

### Theme Context Injection

If a scraped or custom theme is active, a **Theme Context block** is appended to the system prompt:

```
## Active Theme: "{theme name}"
{forkOrigin note if applicable}

### Palette
- Primary:   {primary.hex}
- Secondary: {secondary.hex}
- Background:{background.hex}
- Text:      {text.hex}
- Accent:    {accent.hex}

### Fonts
- Heading: {heading font family}
- Body:    {body font family}

### CSS Variables
The following CSS custom properties are defined for this theme:
{css variable declarations, one per line}

When creating slides, prefer these colors and fonts unless the user requests otherwise.
```

Only injected when `activeTheme` is non-null and the theme has a resolved palette. For built-in themes (`default`, `uncover`, `gaia`), this block is omitted since the LLM already knows them.

### Session Files Context

If the user has uploaded files with `inContext: true`, a **Session Files block** is appended to the system prompt:

```
## Session Files
The following files are available in the current session.
You can reference them in slides using ![alt](uploaded://<fileId>).

| File                          | Type   | Dimensions | Description        |
|-------------------------------|--------|------------|--------------------|
| {filename} (id: {fileId})     | {type} | {W}x{H}    | {auto or user tag} |
| {filename} (id: {fileId})     | {type} | {W}x{H}    | {auto or user tag} |

The images listed above are also visible to you as part of the user's message context.
```

## Multimodal User Message Format

The user message is sent as a **content array** (OpenAI `content` with array type), NOT a plain string. This allows interleaving text and images.

### Structure

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Make a title slide using the company logo and the primary theme color"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,iVBOR...",
        "detail": "auto"
      }
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://s3-bucket.s3.region.amazonaws.com/uploads/uuid.png?presigned=abc",
        "detail": "low"
      }
    }
  ]
}
```

### Image Inclusion Rules

| Condition | Behaviour |
|-----------|-----------|
| Image ≤ 1MB | Embed as base64 `data:` URI directly in content |
| Image > 1MB | Use S3 presigned URL (URL valid for 1 hour) |
| GIF | Embed as base64 (GIFs cannot use presigned URLs with GPT-4o) |
| SVG | Convert to PNG (1280px width) first, then embed as base64 PNG |
| PDF | Not sent as image; reference in text only ("file X is available") |
| Token budget exceeded | Drop oldest images first until under budget |

### Detail Parameter

| Detail | When to use |
|--------|-------------|
| `low` | Images > 500KB or > 1000px wide — uses 85-token low-res encoding |
| `high` | Images < 200KB and < 500px wide — enables detailed visual analysis |
| `auto` | Default — let the model decide based on content |

## Token Budget Management

### Per-Call Budget

| Component | Max Tokens |
|-----------|------------|
| System prompt | 2,000 |
| Conversation history (last 10 turns) | 4,000 |
| User text message | 1,000 |
| Images (per image, low res) | 85 |
| Images (per image, high res) | up to 4,097 (170px tiles) |
| Tool definitions | 1,500 |
| Tool call results | 4,000 |
| **Total max input** | **~16,000** (below GPT-4o 128K limit) |

### Image Budget Logic

```
const IMAGE_TOKEN_BUDGET = 8000  // max tokens for images per call
const MAX_IMAGES = 10            // hard cap regardless of budget

1. Filter uploaded files to only inContext=true image/* MIME types
2. Sort by createdAt descending (newest first)
3. If count > MAX_IMAGES, take MAX_IMAGES newest
4. For each image:
   a. Estimate tokens: if detail=low → 85; if detail=high → min(4097, tiles*170)
   b. Accumulate total
   c. If total > IMAGE_TOKEN_BUDGET, stop and drop the rest
5. Log warning if images were dropped: "Dropped N images (token budget)"
```

## Tools Definition

The tool definitions sent alongside the chat completion:

```json
[
  {
    "type": "function",
    "function": {
      "name": "edit_markdown",
      "description": "Replace the entire presentation markdown with new content",
      "parameters": {
        "type": "object",
        "properties": {
          "markdown": {
            "type": "string",
            "description": "Complete MARP Markdown content including front matter and all slides"
          }
        },
        "required": ["markdown"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "edit_css",
      "description": "Replace the entire presentation CSS with new content",
      "parameters": {
        "type": "object",
        "properties": {
          "css": {
            "type": "string",
            "description": "Complete CSS stylesheet for the presentation theme"
          }
        },
        "required": ["css"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_state",
      "description": "Retrieve the current markdown and CSS state (no changes)",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  }
]
```

Note: `generate_image` and `apply_theme` are handled by API endpoints, not LLM tool calls. The LLM can suggest them textually.

## Conversation History Truncation

Only `user` and `assistant` role messages are preserved in history (system messages, including the large system prompt, are re-generated each call, not stored).

### Truncation rules:
1. Keep at most 10 previous turns (user+assistant pairs)
2. If total history tokens > 4,000, drop oldest turns until under
3. Media content from previous turns is NOT re-sent — only the text is kept
4. Each stored history entry is a plain string (role + text), not a content array

## S3 Presigned URL Strategy

To avoid sending large base64 blobs to the LLM API, images > 1MB use S3 presigned URLs:

```
GET /api/uploads/:id/download → returns { url: presignedS3Url }
```

The presigned URL is:
- Generated server-side using `@aws-sdk/s3-request-presigner`
- Valid for 1 hour (configurable via `S3_PRESIGN_EXPIRES`)
- Inserted directly into the `image_url.url` field of the multimodal content block
- The URL is single-use + HTTPS-only

For MinIO (local dev), the presigned URL points to the MinIO endpoint.

## Theme Context Injection Rules

| Theme Origin | Inject Palette? | When |
|--------------|-----------------|------|
| Built-in (default, uncover, gaia) | No | Theme name alone is sufficient |
| Scraped theme from URL (via scraper) | Yes | Every call while active |
| User-created CSS theme | Conditional | Only if palette colors are stored in DB |
| No theme selected | No | Use defaults |

When injected, the palette text block is placed at the end of the system prompt, right before the tool definitions.

## Error Handling in Prompt Assembly

| Scenario | Behaviour |
|----------|-----------|
| S3 presigned URL generation fails | Fall back to base64 data URI |
| Image file missing from S3 | Skip image, include text warning in system prompt |
| All images dropped (budget) | Send text-only, add system message: "Image context omitted (token limit)" |
| Invalid image format after upload | Skip from multimodal, still listed in Session Files as "unavailable" |
| History parse error | Drop all history, start fresh with system prompt only |
