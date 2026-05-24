---
title: The 0.01% That Justifies Anything
date: 2026-05-16
tags: [rationalism, utilitarianism, longtermism, LLM hype, magical thinking]
---

What if a 0.01% chance of a trillion-person future morally outweighs every preventable death today? That's the arithmetic behind **future-centric bias** — a tiny logical slip that cascades into catastrophic policy. Rationalist and LessWrong communities champion rigorous reasoning, but over-weighting an extremely speculative future can justify any means to achieve a post‑scarcity utopia, treating present‑day suffering as expendable.

### How a Small Fallacy Escalates

```kroki-blockdiag
blockdiag {
  orientation = portrait;
  node_width = 180;

  "Assume trillion-human\nfuture (p > 0)" -> "Linear utility\naggregation" -> "Ignore epistemic\nuncertainty" -> "Derive policy:\nany cost justified";

  "Assume trillion-human\nfuture (p > 0)" [color = "#ffcccc"];
  "Derive policy:\nany cost justified" [color = "#ff6666"];
}
```

1. **Assume a non‑zero chance of a trillion‑human future** → treat expected utility as `p × 10^12` lives. Even with `p = 0.0001` the product dwarfs any current welfare concern.
2. **Linear aggregation of utility** → add that massive expected value to today’s actions.
3. **Ignore epistemic uncertainty** → treat the probability as a hard fact, effectively discounting present suffering to zero.
4. **Derive policy** → any intervention that marginally raises `p` (e.g., extreme AI‑alignment work, radical bio‑enhancement) is deemed morally obligatory, regardless of immediate costs.

### Real‑World Examples of Disastrous Outcomes
- **AI‑Risk Prioritization** – Total malaria funding globally was ~$4.1B in 2023, while total AI safety research spending (across all sources) was a fraction of that. Yet the most vocal longtermist funders directed disproportionate resources toward speculative alignment work over proven present-day interventions like bed nets and antimalarials.
- **LLM‑Hype Magical Thinking** – Tech firms announce ever-larger models as if scaling alone leads to general intelligence, justifying multi-billion-dollar GPU clusters that consume rare minerals and strain energy grids, while delivering marginal returns.
- **Population‑Control Policies** – Some futurist proposals endorse severe reproductive restrictions today, betting on a post-scarcity future where human labor is obsolete — a policy that would be immediately condemned absent the "trillion lives" multiplier.

### Acknowledging the Counter-Argument

A longtermist would rightly note: ignoring a 0.01% chance of existential catastrophe is itself a bias. If there's a real chance of losing everything, shouldn't we pay disproportionate attention to it? The answer is *yes* — but the math depends entirely on how you estimate those probabilities, not just the raw numbers. The fallacy isn't in caring about the future; it's in treating a speculative probability as a precise input to an unbounded utility calculation. When the margin of error on `p` spans 10 orders of magnitude, the output of the equation tells you nothing.

### Why the Fallacy Persists
- **Pascalian Expected Value** – Treating a minuscule probability as if it were certain because the payoff is astronomically large.
- **Conjunction Fallacy of “Trillion‑Human” Scenarios** – Assuming that if both a transformative technology and a massive future exist, they must dominate moral calculus.
- **Magical Scaling Assumptions** – Believing performance will continue to improve logarithmically forever, ignoring hardware and thermodynamic constraints.

### Toward a Balanced Approach
- **Dual‑Horizon Allocation** – Split resources by a rule of thumb: at least as much on proven present interventions as on speculative future work. Most funders today are closer to 10:1 future-biased.
- **Calibrated Discounting** – Weight expected utility by epistemic confidence. A 0.001% chance should be discounted by its uncertainty — if the probability itself has a 90% margin of error, that uncertainty must propagate through the calculation.
- **Humility in Forecasting** – Recognize the limits of scaling laws for LLMs and the speculative nature of post‑scarcity scenarios. A future trillion-person civilization remains a thought experiment, not a policy input.

The goal isn't to dismiss longtermist concerns — it's to demand they meet the same epistemic standards they claim to champion. When a 0.01% probability is treated as a moral certainty, the math isn't rigorous. It's Pascal's Mugging with a better calculator.

[^who-malaria]: WHO World Malaria Report 2024. Global malaria control investment reached approximately $4 billion in 2023 — less than half of the $8.3 billion target. [Read more](https://www.who.int/teams/global-malaria-programme/reports/world-malaria-report-2024/questions-and-answers)
[^aisafety-funding]: EA Forum (2023). Open Philanthropy spent ~$46M on AI safety in 2023; total global AI safety funding was roughly $110–130M in 2024 — a fraction of malaria funding. [Read more](https://forum.effectivealtruism.org/posts/XdhwXppfqrpPL2YDX/an-overview-of-the-ai-safety-funding-situation)
