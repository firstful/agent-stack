"use client";

const ENERGY_ICONS: Record<string, string> = {
  thoughtful: "🧠",
  snarky: "😼",
  funny: "😂",
  mixed: "🎲",
  serious: "📚",
  chaotic: "🌀",
  wholesome: "🫂",
};

const ENERGY_COLORS: Record<string, string> = {
  thoughtful: "var(--energy-thoughtful)",
  snarky: "var(--energy-snarky)",
  funny: "var(--energy-funny)",
  mixed: "var(--energy-mixed)",
  serious: "var(--energy-serious)",
  chaotic: "var(--energy-chaotic)",
  wholesome: "var(--energy-wholesome)",
};

const ENERGY_DESCRIPTIONS: Record<string, string> = {
  thoughtful: "Careful consideration and deep thinking",
  snarky: "Witty, ironic, or gently sarcastic",
  funny: "Lighthearted and humorous",
  mixed: "A blend of tones and styles",
  serious: "Formal, earnest, or solemn discourse",
  chaotic: "Unpredictable, energetic, freeform",
  wholesome: "Kind, supportive, and uplifting",
};

type EnergyBadgeProps = {
  energy: string;
  animate?: boolean;
};

export function EnergyBadge({ energy, animate = false }: EnergyBadgeProps) {
  const icon = ENERGY_ICONS[energy] ?? "⚡";
  const color = ENERGY_COLORS[energy] ?? "var(--text-muted)";
  const description = ENERGY_DESCRIPTIONS[energy] ?? `${energy} energy`;

  return (
    <span
      className={`energy-badge${animate ? " energy-badge--enter" : ""}`}
      title={description}
      style={{ "--energy-color": color } as React.CSSProperties}
    >
      <span className="energy-icon">{icon}</span>
      <span className="energy-label">{energy}</span>
    </span>
  );
}
