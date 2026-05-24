---
title: "Any Library You Want: $20"
date: 2026-05-18
tags: [LLM, software engineering, libraries, DX]
---

For most of my career, building your own library was a decision with teeth. It meant months of design, maintenance commitment, documentation, edge cases you hadn't thought of, and a sinking feeling when you realized you'd basically reimplemented half of a popular open-source project but worse. So we reached for dependencies instead — pulling in hundreds of them per project, each with its own assumptions, version constraints, and attack surface. The trade-off was clear: someone else's bug is better than your own bug, and someone else's maintenance is free.

LLMs change this equation fundamentally. Not by making libraries obsolete, but by making the cost of creating your own library approach zero.

### The Threshold Shift

Before LLMs, the minimum viable library cost about a week of focused work — design, implement, test, document, handle edge cases, write a README. That week had to compete against every other feature request, bug fix, and meeting on your plate. Most of the time, it lost. You reached for an existing dependency instead, accepting its baggage because the alternative was too expensive.

The same library now costs about $20 and 20 minutes.

Not every library, of course. Deep infrastructure — databases, rendering engines, networking stacks — still requires substantial engineering. But the long tail of small, focused utility libraries that every project accumulates? Those are now essentially free.

I have started treating libraries as disposable. Need a custom event emitter with different semantics than Node's? $20. Need a specialized validation pattern that doesn't quite fit Zod? $20. Need a rate limiter with exactly your shaping algorithm? $20. The economics have inverted: it's now cheaper to build your own than to evaluate, vet, and integrate someone else's.

### Why Libraries, Not Apps

There is a trap here. If LLMs are cheap, why not just generate the code inline — shove a long prompt into every file and move on? Because code that lives in your application logic carries your business context, your naming conventions, your database schema, your authentication model. That context is noise for the LLM. It dilutes the signal.

The breakthrough insight is that **libraries are the natural unit of LLM-generated code because they are context-free**.

A good library is a sealed box: it takes well-defined inputs, produces well-defined outputs, and has zero knowledge of your database, your auth system, your API routes, or your company's internal naming conventions. This is precisely the condition under which LLMs excel. A prompt like "Write a TypeScript function that takes an array of numbers and returns a moving average with configurable window size" has a clear right answer. The LLM doesn't need to know about your user model, your caching strategy, or whether you use Postgres or MySQL.

Application code, by contrast, is tangled in business logic. Every prompt about application code requires paragraphs of context — here's our user schema, here's how auth works, here's our error handling convention — and even then the LLM will produce something that almost works but misses a subtle business rule. Libraries avoid this because they have no business rules.

This is also why LLMs produce better code for libraries than for any other unit of software. The interface is the spec. The spec is the code. And the code has no dependencies on anything outside the file.

### Spec-Driven Development

The best way to get high-quality library code from an LLM is to write the spec first, in the form of a type signature and test cases.

I don't mean test-driven development in the traditional sense (red, green, refactor). I mean writing the complete type signature — every input type, every output type, every edge case encoded in the type system — and a set of example inputs with expected outputs. Then handing that to the LLM.

```typescript
// Spec:
// function memoize<T, R>(fn: (arg: T) => R, keyFn?: (arg: T) => string): (arg: T) => R
// - Returns a memoized version of fn
// - Uses keyFn to generate cache keys (defaults to JSON.stringify)
// - Cache size is unbounded (for now)
// - Handles multiple calls with the same arg without re-executing fn
// - Must not mutate fn or any global state

// Example:
// const add = (x: number) => x + 10
// const memoized = memoize(add)
// memoized(5) // => 15, calls add
// memoized(5) // => 15, from cache
```

The LLM takes this and produces the implementation. The cost: roughly $0.50–$2.00 depending on model and complexity. The time: about 60 seconds.

If the implementation has issues, you fix the spec and regenerate. You never dig into the implementation details. The spec is the source of truth. The code is a view.

This is the workflow that makes library generation viable at scale. You are not debugging generated code. You are refining specs.

### Why $20?

A $20 library is one that requires a few iterations: a spec, a first pass, some edge case handling, basic documentation, and perhaps two or three refinement cycles. At current API pricing, that's roughly 200K–500K tokens of GPT-4-class model usage. It covers about 30–60 minutes of human time — mostly spent thinking about the spec, not writing code.

Compare this to the real cost of an open-source dependency:

- **Evaluation cost.** Reading the docs, checking the API, verifying it handles your case, checking the license, reviewing the last commit date, checking for security issues. This is not free.
- **Integration cost.** Wrapping the library to match your conventions, handling version mismatches, writing glue code.
- **Ongoing cost.** Updating when the library changes, dealing with breaking releases, patching security vulnerabilities, migrating when the library is abandoned.
- **Opportunity cost.** The library you chose shapes your architecture. A library that almost fits will pull your code in its direction. A bespoke library fits exactly.

Even if you value your engineering time at $50/hour — which is low — the evaluation and integration of a non-trivial dependency costs more than $20. The bespoke library built by an LLM breaks even immediately and pays dividends over the life of the project because it has no external dependencies, no version risk, and no surface area beyond what you explicitly designed.

### What This Unlocks

The ability to generate libraries at near-zero cost changes how you approach software design:

**You can design the ideal API first.** Instead of asking "what library already does something like this?", you ask "what would the perfect API look like for this problem?" Then generate it.

**You can decompose aggressively.** Every distinct concern — a sorting algorithm, a caching strategy, a formatting function, a validation pattern — can be its own library. No more monolithic utility files. No more copy-paste across projects.

**You can experiment freely.** Want to try three different implementations of the same interface? Generate all three, benchmark them, keep the winner. The cost of the two losers is trivial.

**You can eliminate whole categories of dependencies.** Date formatting, string manipulation, data structure transformations — these are now cheaper to generate than to import. Every dependency you remove is one fewer potential supply-chain attack, one fewer version conflict, one fewer migration.

### When Not to Do This

Not every dependency should be replaced. Some libraries are genuinely hard:

- **Protocol implementations** (HTTP clients, database drivers, crypto) — getting these wrong is catastrophic, and the spec is not just a type signature but a compliance document.
- **Large frameworks** (React, Express, Vue) — the value is not just the code but the ecosystem, the documentation, the community knowledge.
- **Anything security-critical** — you want your crypto audited by experts, not generated by an LLM in 60 seconds.

The "cheaper to build than to import" principle applies to the long tail of small, focused utilities. Not to infrastructure.

### The Bottom Line

For the first time in my career, the economically rational choice is often to build rather than to buy. The cost of creating a small, well-specified library has dropped from a week of engineering time to $20 and a spec. This inverts the dependency calculus that has governed software engineering for decades.

The implications are still unfolding, but one is already clear: the teams that learn to think in terms of specs rather than dependencies will build software that is smaller, more correct, and vastly easier to maintain than the teams that keep pulling in libraries out of habit.

The library isn't dead. It's just become cheap enough to write yourself.
