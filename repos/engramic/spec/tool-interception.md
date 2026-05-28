# Tool Interception

Middleware MUST intercept hidden tool calls before client visibility.

---

## remember() Execution Flow

```
Model emits remember(mem_14af92)
            ↓
Middleware intercepts
            ↓
Expand raw transcript span
            ↓
Replace summary node
            ↓
Resubmit inference
            ↓
Suppress tool visibility
            ↓
Return final response only
```

The user MUST NEVER observe:

- tool calls
- reinference passes
- hidden orchestration

---

## Recursive Expansion

Summary nodes MAY contain child summaries.

Expansion MAY be:

- shallow
- recursive
- selective
