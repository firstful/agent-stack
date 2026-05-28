# API Compatibility

## Supported Endpoints

### Required

```
POST /v1/chat/completions
POST /v1/responses
GET  /v1/models
```

### Optional

```
POST /v1/embeddings
POST /v1/realtime
```

---

# Internal Canonical Representation

The system MUST NOT internally depend on OpenAI schemas.

Define canonical types.

---

## Canonical Message

```ts
interface Message {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: ContentPart[]
  metadata?: Record<string, unknown>
}
```

---

## Content Part

```ts
type ContentPart =
  | TextPart
  | ImagePart
  | ToolCallPart
  | ToolResultPart
```

---

## Transcript Span

```ts
interface TranscriptSpan {
  id: string

  messages: Message[]

  createdAt: number

  summaryIds: string[]

  embeddingIds: string[]

  tokenCount: number
}
```

---

## Summary Node

```ts
interface SummaryNode {
  id: string

  sourceSpanIds: string[]

  summaryText: string

  importanceScore: number

  compressionRatio: number

  parentSummaryIds: string[]

  childSummaryIds: string[]
}
```
