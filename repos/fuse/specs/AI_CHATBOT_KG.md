# AI Agent — Ambient Chatbot with Knowledge Graph

## Objective

Every channel in Fuse has an implicitly available AI agent. It has full access
to the channel's context (messages, documents, calendar, participants,
knowledge graph). Users interact with it like a team member.

## Design Principle

The AI agent is not an external chatbot bolted on. It is a **native participant
in every channel**, just like any user. It is an identity of type `agent` with
the canonical key `ai-bot@org.com` (per-org, distinct per channel):

- Identity type: `agent` (transparent cross-org like all types)
- A user profile with avatar, presence, typing indicators
- The ability to post messages, create polls, schedule meetings, create docs
- Memory (knowledge graph) that persists across channels and sessions
- Org admins can set cross-org policy: "block `agent` messages from orgB"
- **Cannot join E2EE channels** — adding an agent downgrades the channel
  from E2EE to TLS, with a visible warning to all participants

This means the AI agent is subject to the same cross-org policies as any
other identity type. If you federate with a partner org, their AI agents
can participate in shared channels — unless your admin blocks type `agent`.

## Channel Integration

### Invocation
- `@ai <question>` — Mentions the AI in any message. Bot replies in-thread.
- `@ai /command` — Slash commands routed to the AI
- `@ai` in a thread — AI answers based on thread context
- DM with the AI Bot — Personal AI assistant
- Proactive: AI can suggest (e.g., "Based on this discussion, should I create
  a doc?"). Configurable per channel.

### What the AI Can Do

| Category | Capabilities |
|----------|-------------|
| Answer questions | Channel context, docs, past messages, calendar |
| Search | Full-text across all org content |
| Summarize | Thread summary, daily digest, meeting recap |
| Schedule | Create meetings, check calendars, propose times |
| Remember | Facts stored in knowledge graph, cross-channel |
| Remind | "Remind me about this on Friday" |
| Create docs | Draft docs from conversation, fill templates |
| Manage tasks | Create, assign, track tasks from messages |
| Translate | Translate messages inline |
| Code | Explain, review, generate code snippets |
| Moderate | Flag policy violations, suggest edits (admin-config) |
| Recommend | Suggest channels, documents, people to follow up with |

### Knowledge Graph

The AI maintains a persistent knowledge graph per org:

```
┌──────────┐     ┌──────────┐     ┌──────────────┐
│  User    │─────│  Message  │─────│  Document     │
└──────────┘     └──────────┘     └──────────────┘
     │                │
     │                │
┌────┴────────┐  ┌────┴───────────┐
│ Fact          │  │ Topic          │
│ ("Alice likes │  │ ("deployment   │
│  Python")    │  │  architecture") │
└─────────────┘  └────────────────┘
```

#### Entities
- Users (name, email, role, relationships)
- Channels (purpose, members, topics)
- Documents (title, summary, sections)
- Meetings (title, attendees, decisions)
- Facts (key-value: "Alice prefers async communication")

#### Edges (Relationships)
- `authored` — user → message/document
- `mentioned_in` — user/channel → message
- `related_to` — message/doc → topic
- `decided_in` — decision → meeting
- `knows_about` — user → topic
- `prefers` — user → preference

#### Implicit Learning
The AI automatically extracts:
- Decisions made in meetings ("We decided to use Postgres")
- Preferences ("Bob prefers afternoon meetings")
- Expertise ("Alice is the deploy expert" — from who answers deployment
  questions)
- Project timelines and milestones
- Cross-links between related discussions

#### Explicit Memory
Users can teach the AI:
- "Remember that our deployment window is Tuesday 2-4 PM"
- "Remember that I work best with detailed specs"
- "Alice is our GDPR point of contact"

### Fact Memory Commands

| Command | Example |
|---------|---------|
| `Remember that <fact>` | "@ai Remember that deploy window is Tuesday 2-4 PM" |
| `What do you know about <topic/user>?` | "@ai What do you know about the deploy process?" |
| `Forget that <fact>` | "@ai Forget the thing about Tuesday deploy" |
| `What facts do you have stored?` | "@ai Show me my stored facts" |

### AI + Calendar

The AI's calendar access lets it:
- "When is everyone free for a 30-min meeting next week?"
- "Remind me 1 hour before my meeting with Bob"
- "Reschedule the sprint review to Thursday"
- "What's on my calendar today?"
- "Who am I meeting with this week?"

### AI + Documents

- "Summarize the onboarding doc for the new intern"
- "Create a design doc from this thread"
- "What's the deployment process? (searches docs)"
- "Add a section about error handling to the API doc"
- "Find the doc where we discussed caching strategy"

### AI + Cross-Org

Cross-org AI respects trust boundaries:
- Within a shared channel, the AI has context from both orgs' messages in
  that channel
- The AI does **not** have access to internal channels of the other org
- Org admins can set policy: "Allow AI to access partner org's public docs"
- Facts are per-org unless explicitly shared

### AI Model Strategy

| Tier | Model | Use Case |
|------|-------|----------|
| Local | Small (Phi-4, Llama-3.2-3B) | Fast responses, simple Q&A, summarization |
| Local | Medium (Llama-3.3-70B, Qwen-2.5-72B) | Complex reasoning, code, planning |
| Cloud | GPT-4o, Claude Opus | Advanced tasks (opt-in, per-user setting) |

- Default: local models for privacy and latency
- Cloud fallback for complex tasks (if user has API key)
- All training data stays on-prem (no model training on user data)
- RAG pipeline: embed + vector DB (pgvector or Qdrant)

## Implementation Notes

- Vector embeddings stored in PostgreSQL via pgvector
- Knowledge graph stored in PostgreSQL (adjacency list + JSON properties)
- AI responses are streamed via Server-Sent Events
- All AI actions are audited (what the AI did, who asked)
- Users can see what context the AI used (citations)
- AI's knowledge graph is exportable
