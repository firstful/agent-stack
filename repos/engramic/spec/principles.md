# Critical Architectural Principle

The middleware MUST treat:

- raw transcript
- summaries
- retrieval artifacts
- provider prompts

as separate layers.

Provider prompts are:

- compiled execution artifacts

NOT:

- canonical conversational state.

That distinction is foundational to the architecture.

---

## Architectural Insight

These tools collectively shift the system from:

> "summarized chat history"

to:

> "governed, addressable memory runtime"

The key upgrade is not compression itself, but **controllability and reversibility of memory state transitions**.
