# v6 — Document Store (Notion/Confluence-like)

## Objective

Add a block-based document editor and knowledge base where teams can create,
share, and collaborate on documents — deeply integrated with the rest of Fuse.

## Concept

A document in Fuse is a collapsible, block-based page that lives alongside
channels and messages. Every channel automatically has an associated
document/wiki space. Documents can reference channels, messages, meetings,
and people — and vice versa.

## Block-Based Editor

Like Notion, every document is a list of content blocks:

| Block Type | Description |
|------------|-------------|
| Text | Rich text paragraph (bold, italic, code, links, @mentions) |
| Heading 1/2/3 | Section headers |
| Bullet list | Unordered list |
| Numbered list | Ordered list |
| Toggle list | Collapsible section |
| Quote | Blockquote |
| Callout | Colored callout box (info, warning, tip) |
| Divider | Horizontal rule |
| Code block | Syntax-highlighted code with language selector |
| Table | Simple table with sortable columns |
| Kanban board | Column-based board (like Notion's) |
| Calendar view | Events from associated channel/calendar |
| Timeline | Project timeline / Gantt |
| Embed | URL embed (YouTube, Figma, maps, etc.) |
| Image | Inline image with caption |
| File | File attachment with preview |
| Database | Structured table with views (table, board, calendar, gallery) |
| Sync block | Linked copy of another block (reference, not duplicate) |
| AI block | Dynamic block — AI-generated content, updated on demand |
| Template | Pre-structured page template |
| Equation | LaTeX math block |
| Mermaid diagram | ` ```mermaid ` rendered to SVG |

## Page Hierarchy

Pages are nested. Every page has:
- Title (first block)
- Icon (emoji or custom)
- Cover image (optional)
- Page URL (`/docs/page-uuid`)
- Property metadata (created, modified, author, tags)
- Backlinks (automatically tracked across all docs)

### Templates

Built-in templates:
- Meeting notes (auto-links to calendar event)
- Project proposal
- Engineering design doc (ADR template)
- Onboarding guide
- Weekly standup notes (recurring)
- Incident postmortem
- OKR tracker

## Channel-Doc Integration

Every channel (#engineering, #design) has a linked wiki space:
```
#engineering
├── messages (chat)
├── meetings (linked calendar)
├── voice (open voice channels)
└── wiki (pages)
    ├── Architecture overview
    ├── API reference
    ├── Onboarding
    └── Runbooks
```

- `/docs` slash command in chat creates a doc from the current thread
- A doc can be linked in a channel's bookmarks
- Doc updates appear as channel messages (configurable)
- @mention a page in a message to embed a smart link

## Real-Time Collaboration

- OT/CRDT-based concurrent editing (use **Yjs** / **Yrs**)
- Cursor presence: see who's editing what block
- Comment threads on blocks (like Google Docs)
- Suggest mode (track changes)
- Version history (every save is a version)

## Database Views

A Fuse database is a collection of typed entries with views:

```yaml
Database: "Sprint Tasks"
Schema:
  Task: text
  Assignee: user
  Status: select (Backlog, In Progress, Review, Done)
  Priority: select (P0, P1, P2)
  Sprint: text
  Due: date
  Linked PR: url

Views:
  - Table view (default)
  - Kanban board (group by Status)
  - Calendar (by Due date)
  - Gallery (card view, grouped by Assignee)
```

Databases can be filtered, sorted, and linked across pages.

## AI Integration

The channel AI agent can:
- Create a doc from a conversation summary
- Suggest edits to a doc
- Answer questions based on doc content ("What's the deployment process?")
- Generate meeting notes from a meeting transcript
- Fill in database entries from chat messages
- Automatically link related docs based on content similarity

## Search

- Full-text search across all docs (Tantivy/Meilisearch)
- Block-level search results with context
- Search across docs + messages + meetings in one query
- Natural language search via AI agent

## Export

- Markdown export (single file per page)
- HTML export
- PDF export (with table of contents)
- JSON export (full block structure)
- Bulk export of entire workspace

## Cross-Org Docs

Trust Level 4 allows shared docs:
- Joint project proposals with partner org
- Shared knowledge base
- Collaborative specification documents
- Access controls: specific pages, not entire space

## v6 Does NOT Include

- Nothing major — v6 is the final foundational pillar
- Future: spreadsheets (like Airtable), whiteboards (like FigJam/Miro),
  forms/surveys
