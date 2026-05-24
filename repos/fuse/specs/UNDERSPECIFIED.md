# Underspecified Parts — Need Your Input

This is the current list of open questions. Items marked with
**[BLOCKING]** need resolution before implementation.

## Critical

1. **Name / Branding** — Codename is "Fuse" pending a real name.

2. **[RESOLVED] Auth / Identity Provider** — Self-hosted: magic link only
    (no passwords). SaaS: OAuth/SSO (Google/GitHub/Microsoft) + magic link
    fallback. Enterprise: OIDC (BYOIDP) in v1. See OVERVIEW.md Authentication
    section. ✓ Spec'd.

3. **[BLOCKING] Cross-org E2EE scope** — E2EE groups across two Fuse
   instances: whose server sequences epochs? Who holds K_g? How does
   Alice@a.com discover Carol@b.com's GM public key? Currently spec says
   "E2EE not supported cross-org in v1-v2" — meaning cross-org shared
   channels (v2 feature) are TLS-only. Intentional, or should cross-org
   E2EE be spec'd now?

4. **[BLOCKING] Device lifecycle — RECOVER scope** — Alice loses her phone,
   RECOVERs on a laptop. Does this replace ALL her device leaves across ALL
   E2EE groups with one action, or must she re-join each group individually?
   First option needs a server broadcast to every group Alice belongs to.
   Second is impractical for users in 20+ groups.

5. **[RESOLVED] How does the initial K_g get distributed on channel creation?**
    1:1 DMs → creator's client encrypts K_g to the other party's GM key
    (Option A). Groups → server mediates, generates K_g, encrypts to each
    initial member's GM key (Option B, same as RECOVER). ✓ Spec'd.

## High Importance

6. **Mobile Strategy** — PWA only for v1-v4? React Native? Flutter? How
   much rich experience can mobile deliver?

7. **Data Residency / Sovereignty** — Cross-org: "both servers store their
   own copy" — acceptable? GDPR right-to-deletion across org boundaries?

8. **File Storage Architecture** — S3-compatible (MinIO, local FS for
   self-hosted)? Max attachment size? (email caps at 25MB — lift for
   Fuse-to-Fuse?)

9. **Archiving / Compliance / eDiscovery** — Exportable message archives?
   Legal hold? Super admin who can read any channel?

10. **E2EE + outbound SMTP** — Alice in a pure-human E2EE group types
    `/email bob@gmail.com` to forward a thread. Server can't read E2EE
    content. Needs client-side decrypt + re-upload (trust issue), or
    blocked with an error in E2EE groups.

11. **[RESOLVED] E2EE search** — Encrypted keyword trie via CTR-based SSE
    (prefix-preserving). See `OVERVIEW.md` Search Index section. Privacy
    slider per channel: 🔒 = local-only, 🔐 = trie-enabled, 🔓 = plaintext.
    ✓ Spec'd.

12. **Inbound SMTP plaintext window** — customer@example.com emails support@.
    Email arrives via SMTP in the clear before support@ re-encrypts it to
    the group's K_g. During that window, plaintext is exposed on the server.
    No mitigation spec'd (immediate encrypt? encrypted-at-rest queue?).

## Medium Importance

13. **Rate Limits / Anti-Spam** — DNSBL integration? DKIM/DMARC enforcement?
    How to prevent a trusted domain from spamming channels?

14. **Billing / Pricing** — SaaS pricing model.

15. **Plugin / Extension API** — When can third parties build on Fuse?

16. **Bridges** — Slack, Discord, Teams bridges? Massive adoption driver,
    massive complexity.

17. **Offline Support** — PWA service worker for chat? Full offline sync
    (like Missive)?

## Recently Decided (codified in specs)

| Question | Decision | Spec location |
|----------|----------|---------------|
| SMTP upgrade mechanism | Both EHLO keyword on port 25 AND SRV record (`_fuse._tcp`) | V1_SMTP_GATEWAY.md |
| Thread upgrade semantics | No retroactive upgrade. Only new messages after STARTFUSE | V1_SMTP_GATEWAY.md |
| Server architecture | Monorepo (packages/core + packages/server + packages/cloud). Core holds all business logic; server wraps for self-hosted; cloud adds multi-tenant SaaS. No forking. | OVERVIEW.md |
| Cross-org delivery model | Webhook push with public key crypto (sign + encrypt). Exponential backoff queue | V2_FEDERATION.md |
| Auth (self-hosted) | Magic link only, no passwords | OVERVIEW.md — Authentication |
| Auth (SaaS) | OAuth/SSO (Google/GitHub/Microsoft) + magic link fallback | OVERVIEW.md — Authentication |
| Auth (enterprise) | OIDC (BYOIDP) in v1 | OVERVIEW.md — Authentication |
| E2EE search | Encrypted keyword trie via CTR-based SSE (prefix-preserving). Privacy slider per channel: 🔒 local, 🔐 trie, 🔓 plaintext | OVERVIEW.md — Search Index |
| AI model sourcing | Self-hosted = BYOK. SaaS tenants get billed | AI_CHATBOT_KG.md |
| Registration flow | Domain-claim via DNS TXT verification. Users auto-join @ verified domains | OVERVIEW.md |
| Encryption model | Optional E2EE (Signal/MLS). Adding server-side identity downgrades to S2EE with warning | OVERVIEW.md |
| IMAP support | No IMAP. Web UI + mobile only. Export tool for portability | V1_SMTP_GATEWAY.md |
| Legacy email UI | Separate visual container (orange border, "EXTERNAL EMAIL" badge) | V1_SMTP_GATEWAY.md |
| Identity types | PK = name@domain. Types: human, agent, shared, service, guest. Transparent cross-org, type-aware policy | OVERVIEW.md |
| Shared mailbox model | Team identity (type `shared`) — multi-user backing, acts across all modalities (email, chat, meetings, voice, docs) | V1B_SHARED_MAILBOXES.md |
| Shared display in voice/meetings | Multiple concurrent backers shown as support@ #1, #2 or support@ (Alice) — configurable | V1B_SHARED_MAILBOXES.md |
| Group E2EE protocol | Single shared K_g + Ed25519 signatures (not per-sender keys). Three modes: Async, Shared (epoch rotation), Blob | OVERVIEW.md |
| Epoch hash membership binding | Rolling hash of member list + key fingerprints, used as AEAD associated data | OVERVIEW.md |
| INVITE/JOIN/REMOVE protocol | Two-phase (INVITE→JOIN). Per-member encrypted payloads via GM public keys. Server sequences epochs | OVERVIEW.md |
| Recovery key | Three-key model: identity, group management, recovery. RECOVER signed with recovery key, server mediates rotation | OVERVIEW.md |
| S2EE model | Not a separate channel model. Same E2EE protocol, but server-side identity's keys on server. Proxy bridge for external SMTP/webhook content | OVERVIEW.md |
| E2EE history sharing | Explicit admin action. Re-encrypts old messages with current K_g. Dedup by message_id. System banner | OVERVIEW.md |
| Multi-device | Leaves per device, each with own identity subkey signed by master key | OVERVIEW.md |
| Channel genesis (1:1) | Creator's client encrypts K_g to recipient's GM key (Option A) | OVERVIEW.md — Channel Genesis |
| Channel genesis (groups) | Server mediates — generates K_g, encrypts to initial members' GM keys (Option B, same as RECOVER) | OVERVIEW.md — Channel Genesis |
