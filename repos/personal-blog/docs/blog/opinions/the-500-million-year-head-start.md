---
title: The 500-Million-Year Head Start
date: 2026-05-17
tags: [LLM, AI, neuroscience]
---

A conversation with ChatGPT dies the moment you close the tab. You don't. That single fact captures the deepest gap between today's LLMs and biological intelligence: LLMs have no persistent state, no continuous self, no world model that survives between invocations. Every prompt arrives into a blank slate — a context window that defines not just what the model "knows" in this moment, but the very ceiling of what it can reason about.

### The Context Window as Cognitive Prison

The context window is the LLM's working memory, and it is vanishingly small compared to the human brain's capacity. Even a million-token context window — among the largest available in 2026 — is roughly 750,000 words, or about a long novel. The model can attend to more text, but still never learns from it. The human brain, by contrast, maintains a lifetime of experience, with an estimated storage capacity in the petabyte range[^salk], and can recall relevant information from decades ago in milliseconds.

But the gap isn't just about capacity. It's about *architecture*:

| Property | LLM | Human Brain |
|---|---|---|
| Memory persistence | Ephemeral (context window) | Durable (lifelong) |
| Update mechanism | Fine-tuning (costly, slow) | Synaptic plasticity (real-time) |
| Attention scope | Fixed window | Global associative retrieval |
| World model | Rebuilt per prompt | Continuous and self-consistent |
| Learning | Training phase only | Continuous, awake and asleep |

This table understates the problem. An LLM with a 1-million-token context window still doesn't *learn* from what it reads there. It can attend to more text, but the moment the prompt ends, that information is gone. The model's weights — its actual knowledge — remain frozen.

### The Right Comparison: Parameters vs. Synapses

A common claim — "GPT-4 has a trillion parameters (if rumors are accurate), the brain has only 86 billion neurons — so LLMs are already bigger!" — compares the wrong things. A parameter is a scalar weight. A neuron is not a weight; it's a processing unit that integrates thousands of inputs and produces a single output. The correct analog for an LLM parameter is a **synapse** — the adjustable connection between two neurons.

| Count | LLM | Human Brain |
|---|---|---|
| Parameters / Synapses | ~10<sup>12</sup> (1 trillion) | ~10<sup>15</sup> (1 quadrillion) |
| Units (params vs. neurons) | ~10<sup>12</sup> | ~86 × 10<sup>9</sup> |

By the synapse metric — which is the fair comparison — the brain is three orders of magnitude larger than any LLM. And each synapse is not a single float. It's a complex molecular machine with dozens of protein types, vesicle release probabilities, receptor densities, and short-term plasticity dynamics, all of which can be modulated independently. A synapse encodes more than one bit of information.

**But the neuron comparison isn't useless.** The fact that people reach for neurons (not synapses) when comparing to parameters reveals a real intuition: both are the fundamental units that define a system's total capacity. A neuron and a parameter both represent "one thing the system can tune." The mistake is assuming they're equally expressive. A parameter is one scalar. A neuron is an entire sub-network — it receives thousands of inputs, performs nonlinear integration across its dendritic tree, fires or doesn't, and adjusts its output based on recent history, chemical context, and gene expression.

### How Many Parameters Does a Single Neuron Cost?

If a parameter and a neuron are both "units of capacity" but a neuron is vastly more capable, we can ask: *how many parameters would it take to approximate one biological neuron's complexity?* The answer varies by fidelity:

| Model | Parameters per neuron | What it captures |
|---|---|---|
| Simple ANN unit | ~10<sup>1</sup> | Weighted sum + nonlinearity |
| Leaky integrate-and-fire | ~10<sup>1</sup> | Temporal integration, threshold, reset |
| Hodgkin-Huxley (single compartment) | ~10<sup>2</sup> | Ion channel dynamics, action potential shape |
| Multi-compartment model | ~10<sup>3</sup>–10<sup>4</sup> | Dendritic tree, spatial processing |
| Full biophysical model | ~10<sup>4</sup>–10<sup>5</sup> | All channels, morphology, gene expression |

An artificial neuron in a standard ANN (~10 parameters) captures roughly 0.1–1% of a biological neuron's complexity. A Hodgkin-Huxley model (~100 parameters) gets perhaps 10%. Even a full biophysical model (~10,000 parameters) still omits molecular and epigenetic layers.

Crunching the numbers: if a single neuron requires ~1,000 parameters to approximate its input-output behavior, then the brain's 86 billion neurons represent roughly **10<sup>14</sup> equivalent parameters** — two orders of magnitude beyond GPT-4. The synapse comparison (~10<sup>15</sup>) gives three orders. Both metrics converge on the same conclusion: the brain is not smaller, and each of its elements is far richer.

### The Inverse Question: What Is a Neuron in an LLM?

If parameters are the analog of synapses, then what counts as a "neuron" inside a transformer? The closest equivalent is a **node in the MLP expansion layer** — the feedforward network that sits between attention heads. Each MLP node receives inputs from the full residual stream (its "dendrites"), applies a nonlinear activation (GELU — its "firing"), and projects back into the residual stream (its "axon").

In GPT-3 (175B parameters): 96 layers × ~50,000 MLP nodes per layer = roughly **5 million "neurons"**, each connected by ~25,000 parameters (the weights going in and out). Compare that to the brain's 86 billion neurons:

| | GPT-3 | Human Brain |
|---|---|---|
| "Neurons" | ~5M | ~86B |
| "Synapses" per neuron | ~25K | ~7K |
| Total "synapses" | ~10<sup>12</sup> (parameters) | ~10<sup>15</sup> |

The brain has roughly **10,000× more neurons**, but each LLM "neuron" has **~3× more connections** (25K vs. 7K). The brain's advantage is in the *sheer number of processing units*, not in per-unit connectivity. An LLM compensates for having far fewer neurons by making each one more broadly connected — every MLP node can attend to the entire residual stream, whereas a biological neuron is limited to its local dendritic neighborhood.

This framing also clarifies what "scaling" means for each system. Scaling an LLM adds parameters (synapses) and MLP nodes (neurons) together, preserving the dense-all-to-all connectivity pattern. Brains scale by adding neurons locally within sparse, structured topologies. The brain's wiring is constrained by physical space and energy; an LLM's wiring is constrained by compute budget and memory bandwidth. These are not just different sizes — they are different architectural philosophies.

### Why Transformers Look Like Brains (But Aren't)

Transformers are sometimes called "brain-like" because they use attention mechanisms that superficially resemble salience — the brain's ability to focus on important stimuli while filtering noise. Both systems weigh inputs, both layer abstractions, both exhibit emergent capabilities at scale. But the resemblance is a convergent solution to a shared constraint (efficient information routing), not evidence of structural equivalence.

The differences that matter:

**Attention is not salience.** In transformers, attention weights are computed from the input and immediately discarded — they don't persist, don't accumulate, and have no intrinsic value attached to them. In the brain, salience is modulated by dopamine, norepinephrine, and other neuromodulators that encode *value* — not just relevance, but what matters for survival, goals, and emotional state. An LLM cannot care about anything it reads. A human cannot stop caring.

**Layers are not cortical columns.** Transformer layers stack identical attention + FFN blocks. Each block applies the same operation to every token, and information flows strictly upward. Cortical columns have intricate internal structure with distinct cell types, layer-specific connectivity patterns, and massive reciprocal feedback loops — top-down predictions meet bottom-up sensory data at every level. Brains are not just deeper; they are *looped*.

**Backpropagation is not sleep.** Training an LLM uses backpropagation, which requires a perfect computational graph of the forward pass — every activation must be stored in memory, every gradient computed exactly. The brain cannot do this. There is no global error signal, no differentiable computational graph, no way to "pause and replay" synaptic activity. Instead, the brain uses local learning rules (Hebbian plasticity, spike-timing-dependent plasticity) and consolidates memories during sleep via replay, synaptic scaling, and homeostasis. These mechanisms are computationally cheaper and biologically plausible, but they produce messier, more robust, and more sample-efficient learning.

### The RNA Connection You Don't Hear About

Most comparisons stop at synapses — neurons fire, connections adjust. But cutting-edge research reveals a deeper layer: RNA molecules facilitate *synaptic tagging and capture* (STC), enabling durable memory storage. When a synapse is strongly activated, local RNAs are modified and transported to the nucleus, triggering gene expression changes that stabilize the connection. This is not gradient descent. It's a biological mechanism for deciding which experiences are worth remembering, operating at a molecular timescale that no artificial system replicates.

Some groups are building "RNA-inspired" memory architectures — using local molecular-like signals to gate which weights get updated during fine-tuning — but these are embryonic. The real lesson is that biological memory is multi-scale: electrical (milliseconds), chemical (seconds), molecular (minutes), and structural (hours to lifetime). LLMs operate at exactly one timescale.

### Where the Brain Actually Beats AI

Despite the hype, there are concrete tasks where even the largest LLMs fall short of human cognition:

- **Counterfactual reasoning with sparse data.** A human can reason about a single example ("If I drop this glass, it breaks") and generalize correctly. LLMs need statistically significant patterns distributed across millions of examples.
- **Real-time world modeling.** Walking through a crowded room requires predicting trajectories of dozens of bodies, adjusting posture, planning a path, and filtering irrelevant input — all in milliseconds. No LLM can do this, because it has no continuous world model to update.
- **Compositional generalization.** Humans combine known concepts into novel structures effortlessly ("a purple square with polka dots made of glass"). LLMs struggle with compositional generalization outside their training distribution.
- **Long-term credit assignment.** An action today with consequences six months from now — humans can (sometimes) connect those dots. LLMs cannot, because there is no persistent self to trace the causal chain.
- **Sample efficiency.** A human needs a handful of examples to learn a new concept. An LLM needs millions. The gap is so wide it suggests the architectures are doing fundamentally different things.

### Speed, Scale, and Energy

A GPU core switches at ~1 GHz (10⁻⁹ s). A neuron fires at ~10 Hz (10⁻¹ s). That's a **100-million-fold** difference in per-unit clock speed. But the brain has ~10,000× more processing units. Which wins?

| | LLM (GPT-3) | Human Brain |
|---|---|---|
| Processing units | ~5M "neurons" | ~86B neurons |
| Unit clock speed | ~1 GHz | ~10 Hz |
| Total compute (est.) | ~5 × 10¹⁵ FLOPs/s | ~8.6 × 10¹¹ firings/s |
| Sequential depth | 96 layers (serial) | Variable, ~5–20 synapses (serial) |
| Task latency (perception) | ~1–10 s | ~0.2 s |
| Power | ~700 W (H100) | ~20 W[^brainpower] |
| Energy per operation | ~10⁻⁹ J | ~10⁻¹⁶ J |

**The throughput paradox.** By raw FLOPs, an LLM exceeds the brain by roughly four orders of magnitude (~10¹⁵ vs. ~10¹¹). But for perception tasks the brain is faster (200ms vs. seconds). Why? Because the brain has dedicated, massively parallel hardware for the problems it evolved to solve — vision, spatial reasoning, language — optimized over millions of years. An LLM is general-purpose: it routes every task through the same 96 serial transformer layers. The brain routes vision through V1→V2→V4→IT in parallel with motion through V1→MT→MST, each path specialized and shallow.

**The energy chasm.** This is where the comparison stops being close. The brain runs on 20 watts[^brainpower] — less than a dim lightbulb. An H100 draws 700W, and training GPT-4 is estimated at ~50 GWh[^gpt4energy]. Per operation, the brain is ~10⁷× more energy efficient. That's not a technology gap that Moore's Law will close; it's a fundamental difference in physical substrate (ion channels vs. transistor gates) and architecture (sparse, event-driven spikes vs. dense, synchronous matrix multiplications). The brain processes information only when it needs to; an LLM recomputes every parameter on every forward pass.

**What this means for scaling.** If you could magically match the brain's neuron count with LLM-like components (5M → 86B neurons), the sequential layer depth would still create bottlenecks, and the energy cost would be astronomical — roughly 10 MW per inference. Clock speed gives LLMs a real advantage, but it doesn't erase the architectural gap.

### Toward Hybrid Architectures

The next generation of AI won't be purely transformer-based. The path toward persistent, continuously learning systems is already visible:

- **RWKV and Mamba** — Recurrent architectures that maintain a hidden state across tokens, trading parallelism for persistent memory. Not as parallelizable as transformers, but fundamentally capable of statefulness.
- **Retrieval-Augmented Generation (RAG)** — External vector stores as a crude approximation of episodic memory. Better than nothing, but a library lookup is not recollection.
- **Liquid neural networks** — Time-continuous models whose dynamics evolve via differential equations, capable of adapting to new inputs without retraining. Tiny scale today, but architecturally closer to biological neurons.
- **Memory-augmented transformers** — Explicit memory slots that persist across inference steps, read and written by attention (DeepMind's Differentiable Neural Computer, 2016).
- **Sleep-inspired consolidation** — Some experiments interleave training with "replay phases" where the model rehearses past examples, mimicking hippocampal replay during sleep. Early results show improved generalization.

None of these solve the core problem: an architecture that learns continuously from experience, maintains a persistent self-consistent world model, and can reason about its own knowledge state over time. That likely requires a hybrid — part transformer, part recurrent network, part external memory, and crucially, a meta-learning system that decides what to remember, what to forget, and when to update its beliefs.

### Multi-Dimensional Comparison

Bringing the threads together, here is the full picture across every axis that matters:

| Dimension | LLM | Human Brain | Winner |
|---|---|---|---|
| **Learning phase** | Separate training → inference; nothing learned during use | Continuous, lifelong; every experience is training | Brain |
| **Objective** | Next-token prediction (static corpus) | Survival in a changing physical world | Brain |
| **Training data** | Frozen internet snapshot | Real-time interaction with reality (lifelong) | Brain |
| **Grounding** | None — learns text statistics, not world models | Physical — every belief is tested against reality | Brain |
| **Feedback loop** | Offline (loss on validation set) | Online (consequences of actions, pain/pleasure) | Brain |
| **Learning signal** | Global backpropagation (requires full computational graph) | Local plasticity rules (Hebbian, STDP) + neuromodulator gating | Brain |
| **Data efficiency** | Billions of tokens to learn a concept | 1–10 examples | Brain |
| **Weight update cost** | ~10²³ FLOPs per fine-tuning run | ~10⁻¹⁰ J per synaptic update | Brain |
| **Update parallelism** | Synchronous, batched, global | Asynchronous, local, continuous | Brain |
| **Memory: working** | Context window (~128K tokens, ~100K words) | Prefrontal cortex (~7 items) | LLM |
| **Memory: long-term** | Frozen parameters; static after training | Synaptic weights, structural plasticity; always adapting | Brain |
| **Memory: episodic** | None (no personal experience to store) | Hippocampal indexing, replay during sleep | Brain |
| **Memory: procedural** | None | Cerebellum, basal ganglia; skills become automatic | Brain |
| **Memory: semantic** | All knowledge is semantic, no personal context | Semantic knowledge grounded in episodic experience | LLM (capacity) |
| **Consolidation** | None; no analog to sleep or replay | Sleep replay, sharp-wave ripples, synaptic homeostasis | Brain |
| **Forgetting** | Catastrophic (fine-tuning on new data destroys old) | Gradual, interference-based, spaced repetition | Brain |
| **Recall mechanism** | Deterministic retrieval by pattern matching | Reconstructive; rebuilt from fragments each time | Neither |
| **Recall precision** | Near-perfect for trained facts | Variable; confabulation, distortion, forgetting | LLM |
| **Transfer learning** | Fine-tuning (costly, destructive) | Zero-shot analogical reasoning | Brain |
| **Processing units** | ~5M MLP nodes | ~86B neurons | Brain |
| **Tunable connections** | ~10¹² parameters | ~10¹⁵ synapses | Brain |
| **Per-unit complexity** | ~10¹ params/node | ~10³–10⁵ params/neuron (equiv.) | Brain |
| **Clock speed** | ~1 GHz | ~10 Hz | LLM |
| **Total compute** | ~10¹⁵ FLOPs/s | ~10¹¹ firings/s | LLM |
| **Parallelism** | 96 sequential layers, dense all-to-all within layer | Massive, sparse, local; ~10⁴ parallel paths | Brain |
| **Task latency (perception)** | ~1–10 s | ~0.2 s | Brain |
| **Task latency (knowledge)** | ~0.01 s per token | ~0.5 s per word (reading) | LLM |
| **Energy (per inference)** | ~700 W (H100) | ~20 W | Brain |
| **Energy (per operation)** | ~10⁻⁹ J (FLOP) | ~10⁻¹⁶ J (firing) | Brain |
| **Training energy** | ~10⁶–10⁷ kWh (GPT-4) | ~2 × 10⁴ kWh (80 years × 20W) | Brain |
| **Effective compute / joule** | ~10⁹ FLOPs/J | ~10¹⁶ firings/J | Brain |
| **Substrate** | Silicon, digital, synchronous | Carbon, chemical, asynchronous | Neither |
| **Robustness** | Brittle; adversarial examples, distribution shift | Graceful degradation; noise-tolerant | Brain |
| **Deployability** | Copy instantly to unlimited hardware | Must train each instance from scratch | LLM |
| **Evolution time** | ~10 years | ~500 million years | Brain (unfair) |

**The memory formation gap is the deepest.** An LLM learns once — an enormous, expensive, centralized training run — and then never learns again. Every subsequent interaction is pure inference; the model's weights stay exactly as they were at the end of training. It cannot form new memories from conversation. It cannot update its beliefs when corrected. It cannot remember what you told it five minutes ago unless that text fits in the context window, and even then, that memory evaporates the moment the context is scrolled away.

A human learns continuously, from every waking moment. Each conversation is training. Each correction updates the model. Sleep consolidates the day's experiences into durable memories, prunes irrelevant connections, and rehearses important patterns. The brain has a *complementary learning system*: the hippocampus stores episodic memories rapidly (one-shot) and replays them to the neocortex during sleep, where they are gradually integrated into semantic knowledge without overwriting existing structure. This is precisely the architectural machinery that LLMs lack — a fast writer (hippocampus) that feeds a slow integrator (neocortex), with sleep as the consolidation bridge.

**Where LLMs genuinely win.** Clock speed, working memory (context window), recall precision, and deployability are not trivial advantages. A 128K context window allows reasoning across documents that would take a human days to read. Perfect recall of trained facts means an LLM never forgets a detail. Instant deployability means a single training run can produce millions of identical copies. These are real strengths — but they are strengths of *retrieval* and *throughput*, not of *understanding* or *adaptation*.

The scorecard makes it lopsided in favor of the brain on almost every architectural dimension, but that's an unfair comparison: the brain had a 500-million-year head start and operates on a fundamentally more expressive substrate. The useful question is not "which is better" but "what can each teach us about building the next generation of intelligent systems."

**The objective gap compounds everything.** The brain's fitness function — survival — demands that its world model be grounded in physical reality. A false belief can kill you. There is no analogous pressure on an LLM. Next-token prediction on a static text corpus rewards statistically plausible completions, not truth, not actionability, not coherence with a changing world. An LLM that confidently describes a non-existent paper is optimizing the same loss as one that accurately summarizes a real one — both are equally plausible completions given the training distribution. This is the root cause of hallucination, and it cannot be fixed by scaling. It requires a fundamentally different objective: one that incorporates feedback from an environment, rewards accurate world models over plausible text, and penalizes confident falsehoods the way nature penalizes a mouse that mistakes a shadow for safety.

### What a Truly Intelligent AI Would Need

The transformer has been an extraordinary discovery — a simple, parallelizable, massively scalable architecture that extracts patterns from text at unprecedented breadth. But the equation "more parameters + more data = general intelligence" has limits that the field is already encountering. The gap between LLMs and the human brain is not just a gap in size. It's a gap in *architecture* — in persistence, in continuous learning, in multi-scale memory, in the ability to value some information over others.

Scaling the context window from 128K to 128M tokens doesn't give the model a childhood. It doesn't let it dream. And without those things, it is not thinking — it is retrieving.

If we take the brain seriously as a reference architecture, a truly intelligent AI system would need four things that no current LLM provides:

**1. Broader scale.** Not just more parameters, but more architectural richness per unit. The brain's 86 billion neurons are each worth an estimated 10³–10⁵ equivalent parameters when you account for dendritic computation, ion channel dynamics, and gene expression. Scaling the raw parameter count without scaling per-unit complexity misses the point.

**2. Continuous feedback and learning.** Training and inference must be the same process. Every interaction should update the model. This means abandoning the frozen-weight paradigm in favor of online learning — and solving the catastrophic forgetting problem that comes with it, likely through a complementary learning system (fast hippocampus, slow neocortex) rather than a single monolithic update mechanism.

**3. Sophisticated memory compaction.** A context window is not memory. The brain does not store everything verbatim and replay it — it consolidates, abstracts, prunes, and integrates new information into an existing knowledge structure without destroying what came before. This requires a sleep-like offline consolidation process: replay of salient experiences, synaptic homeostasis to prevent saturation, and gradual integration of episodic memories into semantic structure.

**4. A coherent, continuously updated world model.** The brain maintains a single persistent representation of the world that is updated in real time, tested against sensory input, and used for prediction. An LLM rebuilds its "world" from scratch on every prompt. True intelligence requires a persistent state that tracks changes, resolves contradictions, and can be wrong in falsifiable ways — the kind of model that grounds intelligence in something beyond text statistics.

These are not engineering challenges that more GPUs will solve. They are architectural gaps that require fundamentally different designs — designs that may look less like scaled-up transformers and more like the 500-million-year evolution of the brain.

### Sources
[^salk]: Bartol et al., "Nanoconnectomic upper bound on the variability of synaptic plasticity" (eLife, 2015). Salk Institute estimates brain memory capacity at ~1 PB; later models (PLOS One, 2024) range from 0.2–95 PB depending on synaptic model granularity.
[^brainpower]: Salk Institute (2016). The waking adult brain consumes ~20W of continuous power — about as much as a dim lightbulb. [Read more](https://www.salk.edu/news-release/memory-capacity-of-brain-is-10-times-more-than-previously-thought/)
[^gpt4energy]: Ludvigsen, "The carbon footprint of GPT-4" (Towards Data Science, 2023). Training GPT-4 on ~25,000 A100 GPUs for 90–100 days consumed an estimated 52–62 GWh of electricity. [Read more](https://towardsdatascience.com/the-carbon-footprint-of-gpt-4-d6c676eb21ae/)
[^who-malaria]: WHO World Malaria Report 2024. Global malaria control investment reached approximately $4 billion in 2023 — less than half of the $8.3 billion target. [Read more](https://www.who.int/teams/global-malaria-programme/reports/world-malaria-report-2024/questions-and-answers)

### Further Reading
- Anthony Zador, "A Critique of Pure Learning" (2019) — on why biological constraints matter for AI
- Jeff Hawkins, "A Thousand Brains" (2021) — neocortical theory and reference frames
- DeepMind, "Differentiable Neural Computer" (Nature, 2016)
- Gu et al., "Mamba: Linear-Time Sequence Modeling with Selective State Spaces" (2023)
- Frey & Morris, "Synaptic Tagging and Long-Term Potentiation" (Nature, 1997)
- The Blue Brain Project — cortical column simulation work
- McClelland et al., "Why There Are Complementary Learning Systems in the Hippocampus and Neocortex" (1995)
