"use client";

import type { OAuthProviderId } from "@/lib/auth";
import { initiateOAuth, OAUTH_PROVIDERS } from "@/lib/auth";

export function OAuthButton({ provider }: { provider: OAuthProviderId }) {
  const cfg = OAUTH_PROVIDERS.find((p) => p.id === provider);
  if (!cfg) return null;

  return (
    <button
      className="oauth-btn"
      style={{
        "--oauth-color": cfg.color,
        "--oauth-hover": cfg.hoverColor,
      } as React.CSSProperties}
      onClick={() => initiateOAuth(provider)}
    >
      <img
        src={cfg.iconPath}
        alt=""
        className="oauth-icon"
        width={20}
        height={20}
      />
      <span>Continue with {cfg.name}</span>
    </button>
  );
}
