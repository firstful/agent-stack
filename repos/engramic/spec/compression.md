# Compression Lifecycle

## Trigger Conditions

Compression MAY occur when:

- token threshold exceeded
- turn threshold exceeded
- idle duration exceeded
- provider context limit approached

---

## Compression Flow

```
Transcript Spans
        ↓
Summarization Request
        ↓
Summary Node Creation
        ↓
Working Set Replacement
        ↓
Raw Span Archived
```

Raw spans MUST remain recoverable.
