# UI / UX Specification

## Layout

```
┌──────────────────────────────────────────────────────────┐
│ Header:  MARP Editor │ slides │ [Image] [Username Login]│
├──────────────────────────────────────┬───────────────────┤
│                                      │  ┌─ Outline ─┐   │
│   MARP Presentation Preview          │  │ 1 Welcome │   │
│   (rendered slides, nav controls)    │  │ 2 How it..│   │
│                                      │  │ 3 Features│   │
│   ┌──────────────────────────────┐   │  │ 4 Get Sta.│   │
│   │                              │   │  └───────────┘   │
│   │   Slide display area         │   │   Chat Sidebar    │
│   │   (16:9, click to advance)   │   │   (conversation   │
│   │                              │   │    history +      │
│   │                              │   │    input field)   │
│   └──────────────────────────────┘   │                   │
│                                      │   ────────────    │
│   ◀   Slide 3 of 12   ▶   🔍 100%   │   User: make a   │
│                                      │   title slide    │
├── [Show Code] [CSS] [Files] [Theme] ─┤   ────────────    │
│                                      │   AI: I'll add   │
│                                      │   a title slide  │
│                                      │   with "My Deck" │
│                                      │                   │
│                                      │   [Input field]  │
│                                      │   [Send ▶]       │
└──────────────────────────────────────┴───────────────────┘
```

## Modes

| Mode        | Description                                    |
|-------------|------------------------------------------------|
| Edit        | Default. Preview + chat sidebar.               |
| Fullscreen  | Presentation mode, slides fill entire viewport |
| Split       | Preview left, raw markdown editor right        |

## Slide Outline
- Collapsible panel at the top of the Chat Sidebar, toggled via "Outline" button in the header
- Parses current markdown into sections (split by `---`)
- For each slide, extracts the first heading (`#`, `##`, `###`) — falls back to "Slide N" if no heading
- Each entry shows: slide number (gray), heading text, indented by heading level
- Clicking an entry navigates directly to that slide (`setCurrentSlide(index)`)
- Active slide highlighted with blue border + background
- Outline auto-scrolls to keep the active entry visible
- Toggle off/on via the "Outline" button in the sidebar header

## Chat Sidebar
- Scrollable conversation history
- User messages right-aligned (blue bg)
- AI messages left-aligned (gray bg) with slide preview thumbnails when relevant
- Input field at bottom with Send button (Enter to send)
- Loading indicator while waiting for LLM response
- System messages (e.g., "Slide updated") shown as centered gray text

## Presentation Preview
- Renders current Markdown as MARP slides (16:9)
- Slide navigation: prev/next arrows, slide counter "Slide X of Y"
- Zoom slider: 50%–200%
- Clicking a slide advances to next

## Theme Panel (V4)

### Layout
```
┌────────────────────────────────────┐
│  Theme Panel                    [X] │
├────────────────────────────────────┤
│  Active: default       [dropdown ▽] │
│                                      │
│  ┌────────────────────────────────┐ │
│  │ [Import from URL...]           │ │
│  └────────────────────────────────┘ │
│                                      │
│  ── Saved Palettes ──               │
│  │ McDonald's                  [×] │ │
│  │   ● #BD0017  ● #FFC72C  ● #fff │ │
│  │   Fonts: Speedee, Helvetica     │ │
│  │                                  │ │
│  │ GitHub                     [×] │ │
│  │   ● #24292F  ● #0366D6  ● #fff │ │
│  │   Fonts: -apple-system, Inter   │ │
│  └─────────────────────────────────┘ │
└────────────────────────────────────┘
```

### Import from URL Dialog
1. User clicks "Import from URL" button in Theme Panel
2. Modal opens with URL input field + "Scrape" button
3. User enters URL (with placeholder: `https://example.com`)
4. Client validates URL format, POSTs to `/api/scrape-theme`
5. Loading state: spinner + "Scraping theme from {url}..."
6. On success, dialog shows preview:

```
┌───────────────────────────────────┐
│ Import Theme from URL             │
│                                   │
│ URL: [https://mcdonalds.com     ] │
│                                   │
│ ┌─ Preview ────────────────────┐ │
│ │                              │ │
│ │  Favicon: [McD]              │ │
│ │                              │ │
│ │  Colors:                     │ │
│ │  ● #BD0017  ● #FFC72C       │ │
│ │  ● #FFFFFF  ● #000000       │ │
│ │                              │ │
│ │  Fonts: Speedee (heading)    │ │
│ │         Helvetica Neue (body)│ │
│ └──────────────────────────────┘ │
│                                   │
│      [Cancel]  [Save Palette]     │
└───────────────────────────────────┘
```

7. "Save Palette" button saves to backend (POST `/api/themes`) and adds to saved list
8. "Apply to Deck" also available if user wants immediate application
9. On error, show inline error message (not a separate error dialog)

### Saved Palettes List
- Lists all previously saved `ThemePalette` records from GET `/api/themes`
- Each entry shows: name, swatches (small colored circles), font names
- Click entry to expand with: "Apply palette", "Delete", "View source URL"
- Delete sends DELETE `/api/themes/:id`
- Apply sends POST `/api/apply-palette` with palette ID

### Apply Palette Flow
1. User clicks "Apply palette" on a saved (or freshly scraped) palette
2. Client sends POST `/api/apply-palette` with `{ paletteId: string }`
3. Backend generates CSS variable overrides:
   ```css
   :root {
     --marp-primary: #BD0017;
     --marp-secondary: #FFC72C;
     --marp-background: #FFFFFF;
     --marp-text: #000000;
     --marp-accent: #BD0017;
     --marp-font-heading: 'Speedee', sans-serif;
     --marp-font-body: 'Helvetica Neue', Helvetica, sans-serif;
   }
   ```
4. CSS is merged into the presentation's CSS and returned
5. Client re-renders MARP preview with updated CSS

## File Manager (V2)
- Modal/drawer listing user's presentations
- Each entry: title, last modified date, version number
- Fork button on each entry
- Search/filter by title

## Editor Controls
- Toggle between chat-only, split (markdown + preview), and presentation modes
- Raw markdown view (read-only or editable textarea)
- CSS view (read-only or editable textarea)
- Export/Save buttons

## File Upload & Session Media (V5)

### Layout — Updated
```
┌──────────────────────────────────────────────────────────┐
│ Header:  MARP Editor │ 12 slides │ [Image] [Files] [Usr] │
├──────────────────────────────────────┬───────────────────┤
│                                      │  ┌─ Outline ─┐   │
│   MARP Presentation Preview          │  │ Session    │   │
│   (rendered slides, nav controls)    │  │ Files ──┐  │   │
│                                      │  │ [img1]  │  │   │
│   ┌──────────────────────────────┐   │  │ [img2] ☑│  │   │
│   │                              │   │  │ [img3] ☐│  │   │
│   │   Slide display area         │   │  │ [logo] ☑│  │   │
│   │   (16:9, click to advance)   │   │  └─────────┘  │   │
│   │                              │   │  ┌─ Chat ───┐ │   │
│   └──────────────────────────────┘   │  │ messages  │ │   │
│                                      │  │           │ │   │
│   ◀   Slide 3 of 12   ▶   🔍 100%   │  │           │ │   │
│                                      │  │           │ │   │
├── [Show Code] [CSS] [Files] [Theme] ─┤  │ [Input  ] │ │   │
│                                      │  │ [Send ▶]  │ │   │
└──────────────────────────────────────┴───────────────────┘
```

### Session Files Panel
- Located above the Chat sidebar, below the Slide Outline
- Header: "Session Files" with a count badge and an upload button (➕ or cloud icon)
- Lists all files uploaded in the current session, newest first
- Each file entry shows:
  - Thumbnail (100x56 crop for images, file-type icon for non-images)
  - Filename (truncated to 24 chars)
  - File size (KB/MB)
  - Checkbox toggle: ON = included in LLM context, OFF = excluded
  - Remove button (✕) to delete from session
- Clicking an image thumbnail opens a lightbox preview
- Toggle all ON/OFF button in the header

### Upload Dropzone
- Dragging a file over the chat sidebar or editor area triggers a dropzone overlay:
  ```
  ┌─────────────────────────────────────┐
  │  ┌───────────────────────────────┐  │
  │  │  Drop files here to upload   │  │
  │  │  or click to browse          │  │
  │  │                               │  │
  │  │  Supported: PNG, JPG, WEBP,  │  │
  │  │  GIF, SVG, PDF  (max 10MB)   │  │
  │  └───────────────────────────────┘  │
  └─────────────────────────────────────┘
  ```
- Dropzone appears as translucent overlay with dashed border
- Clicking the dropzone opens the system file picker (accept MIME types from allowlist)
- On drop/select, files upload immediately (one at a time) with per-file progress indicator
- Upload errors shown inline (red text below the failed file)

### Media in Chat Messages
- When the LLM references an uploaded image, the assistant message shows a small thumbnail inline
- User messages do not re-embed images (they are already in context)

### New/Updated Keyboard Shortcuts

| Shortcut         | Action                        |
|------------------|-------------------------------|
| Ctrl+Enter       | Send chat message             |
| Escape           | Exit fullscreen / close modal |
| ArrowLeft        | Previous slide                |
| ArrowRight       | Next slide                    |
| Ctrl+S           | Save presentation (V2)        |
| F                | Toggle fullscreen             |
| M                | Toggle raw markdown view      |
| T                | Open theme panel (V4)         |
| /                | Focus chat input              |
| U                | Open file upload dialog (V5)  |
