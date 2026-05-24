// ── Data ─────────────────────────────────────────────────────────────

const SKILLS: string[] = [
  "C#", "Python", "SQL", "JavaScript", "TypeScript",
  ".NET", "Blazor", "Node.js",
  "Docker", "Kubernetes", "Azure", "Linux",
  "REST APIs", "Event-Driven Architecture",
  "CI/CD", "Automation", "RPA", "AI / LLM",
];

const VARIANT_SKILL_MAP: Record<string, string[]> = {
  "backend-developer":    ["C#", "SQL", ".NET", "REST APIs", "Event-Driven Architecture", "CI/CD", "Docker"],
  "fullstack-developer":  ["C#", "JavaScript", "TypeScript", "Blazor", ".NET", "Node.js", "Docker", "Azure"],
  "agentic-engineer":     ["Python", "AI / LLM", "Automation", "RPA", "Event-Driven Architecture", "Docker", "Linux"],
  "forward-deployed-swe": ["C#", "Python", "Automation", "RPA", "Docker", "Azure", "CI/CD", "Linux"],
};

const VARIANT_LABELS: Record<string, string> = {
  "backend-developer":    "Backend Developer",
  "fullstack-developer":  "Full-Stack Developer",
  "agentic-engineer":     "Agentic Engineer",
  "forward-deployed-swe": "Forward-Deployed SWE",
};

// ── State ────────────────────────────────────────────────────────────

interface AppState {
  path: (string | number)[];
  variant: string | null;
  skills: string[];
  isRecruiter: boolean;
}

const state: AppState = {
  path: [],
  variant: null,
  skills: [],
  isRecruiter: false,
};

// ── DOM helpers ──────────────────────────────────────────────────────

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function show(stepId: string | number): void {
  document.querySelectorAll(".rf-step").forEach((s) => s.classList.remove("active"));
  const el = $(`rf-step-${stepId}`);
  if (el) el.classList.add("active");
  const container = document.querySelector(".rf-container");
  if (container) {
    window.scrollTo({
      top: (container as HTMLElement).offsetTop - 20,
      behavior: "smooth",
    });
  }
}

// ── Actions (exposed via window.rf for onclick) ─────────────────────

function go(id: string | number): void {
  state.path.push(id);
  show(id);
}

function setRecruiter(): void {
  state.isRecruiter = true;
}

function pickVariant(btn: HTMLElement): void {
  const variant = btn.dataset.variant;
  if (!variant) return;
  state.variant = variant;
  state.path.push(`variant-${variant}`);

  const grid = $("rf-skills");
  if (!grid) return;
  grid.innerHTML = "";

  for (const skill of SKILLS) {
    const label = document.createElement("label");
    label.className = "rf-skill-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = skill;
    cb.addEventListener("change", () => label.classList.toggle("selected"));

    label.appendChild(cb);
    label.appendChild(document.createTextNode(skill));
    grid.appendChild(label);
  }

  show(3);
}

function finish(): void {
  state.skills = [];
  document.querySelectorAll("#rf-skills input:checked").forEach((cb) => {
    state.skills.push((cb as HTMLInputElement).value);
  });
  state.path.push(`skills-${state.skills.length}`);

  const v = state.variant || "base";
  const label = VARIANT_LABELS[v] || v;

  const matchedSkills = state.skills.filter((s) =>
    (VARIANT_SKILL_MAP[v] ?? []).some((vs) =>
      s.toLowerCase().includes(vs.toLowerCase())
    )
  );

  const note = $("rf-match-note");
  if (note) {
    if (matchedSkills.length > 0) {
      note.textContent = `You picked ${matchedSkills.length} skills that align with the ${label} role. Great fit!`;
    } else {
      note.textContent = `Based on your answers, the ${label} role seems like the best match.`;
    }
  }

  const dl = $("rf-dl-btn") as HTMLAnchorElement | null;
  if (dl) {
    dl.href = `/assets/resume/${v}.pdf`;
    dl.textContent = `📄 Download ${label} Resume`;
  }

  if (state.isRecruiter) {
    const anonBtn = $("rf-dl-btn-anon") as HTMLAnchorElement | null;
    if (anonBtn) {
      anonBtn.style.display = "inline-block";
      anonBtn.href = `/assets/resume/${v}-anon.pdf`;
    }
    const badge = $("rf-recruiter-badge");
    if (badge) badge.style.display = "inline-block";
  }

  const pathStr = state.path
    .map((p) => (typeof p === "number" ? `Q${p}` : String(p)))
    .join(" → ");
  const pathNote = $("rf-path-note");
  if (pathNote) pathNote.textContent = `Your path: ${pathStr}`;

  show("final");
}

// ── Expose globally ─────────────────────────────────────────────────

(window as unknown as Record<string, unknown>).rf = {
  go,
  setRecruiter,
  pickVariant,
  finish,
};
