import { eq, and, or, inArray, count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import * as schema from "@groupthink/db";

// ═══════════════════════════════════════════════════════════
// Fraud Detection Engine
// ═══════════════════════════════════════════════════════════
//
// Four detection strategies run on a periodic scan:
//
// 1. Cohort Analysis — flag accounts created within the same
//    time window (cohort) whose voting patterns show suspicious
//    uniformity across multiple impulses.
//
// 2. Cross-Group Observation — flag accounts that share membership
//    in the same set of groups and vote identically across those
//    groups, suggesting a single entity controlling multiple accounts.
//
// 3. Behavioral Heuristics — Same-Vote Blocs — flag user pairs
//    that vote identically on ≥90% of common impulses, suggesting
//    coordinated voting blocs.
//
// 4. Behavioral Heuristics — Coordinated Timing — flag user pairs
//    that cast votes within a very narrow time window (3 seconds)
//    across multiple impulses, suggesting scripted or orchestrated
//    voting.
// ═══════════════════════════════════════════════════════════

// ── Configuration ──

const COHORT_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24 hours
const COHORT_MIN_VOTERS = 2;                    // Need at least 2 voters from a cohort
const COHORT_MIN_IMPULSES = 2;                  // Must vote together on this many impulses
const COHORT_VOTE_UNIFORMITY_THRESHOLD = 0.80;  // 80% must vote the same way
const CROSS_GROUP_MIN_SHARED_GROUPS = 2;         // Must share this many groups
const CROSS_GROUP_MIN_SHARED_IMPULSES = 2;       // Must have voted on this many common impulses
const CROSS_GROUP_AGREEMENT_THRESHOLD = 0.80;    // 80% vote agreement required
const SCAN_INTERVAL = 5 * 60 * 1000;             // 5 minutes

// ── Behavioral Heuristics Configuration ──

const SAME_VOTE_BLOC_MIN_USERS = 2;              // Minimum users in a voting bloc
const SAME_VOTE_BLOC_MIN_COMMON_IMPULSES = 3;    // Must have voted together this many times
const SAME_VOTE_BLOC_AGREEMENT_THRESHOLD = 0.90; // 90% identical vote required
const COORDINATED_TIMING_WINDOW_MS = 3000;       // 3-second window for coordinated votes
const COORDINATED_TIMING_MIN_INSTANCES = 2;       // Must happen on at least this many impulses
const COORDINATED_TIMING_MIN_COHORT_SIZE = 2;     // At least 2 users voting in the same window

// ── Logging ──

function log(msg: string) {
  console.log(`[fraud-detection] ${msg}`);
}

function warn(msg: string, err?: unknown) {
  console.warn(`[fraud-detection] WARN ${msg}`, err ?? "");
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

/**
 * Run a full fraud detection scan — both cohort analysis and
 * cross-group observation. Writes findings to the fraud_audit_log table.
 */
export async function runFraudDetection(db: ReturnType<typeof drizzle<typeof schema>>) {
  log("running full fraud detection scan...");
  await detectCohortAnomalies(db);
  await detectCrossGroupAnomalies(db);
  await detectSameVoteBlocs(db);
  await detectCoordinatedTiming(db);
  log("fraud detection scan complete");
}

/**
 * Start the periodic fraud detection scanner, similar to the
 * impulse lifecycle engine. Runs immediately then every SCAN_INTERVAL.
 */
export function startFraudDetection(client: postgres.Sql) {
  const db = drizzle(client, { schema });
  log(`fraud detection engine started (scan every ${SCAN_INTERVAL / 1000}s)`);

  const tick = async () => {
    try {
      await runFraudDetection(db);
    } catch (err) {
      warn("scan tick failed", err);
    }
  };

  setInterval(tick, SCAN_INTERVAL);
  tick();
}

// ═══════════════════════════════════════════════════════════
// 1. Cohort Analysis
// ═══════════════════════════════════════════════════════════

interface CohortVotePattern {
  cohortKey: string;
  userIds: string[];
  impulseId: string;
  uniformityRatio: number;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
}

/**
 * Detect accounts created within the same time window (cohort)
 * that vote together with suspicious uniformity across multiple
 * impulses.
 *
 * Algorithm:
 *   - Group users by creation day (UTC YYYY-MM-DD)
 *   - For each cohort with ≥ COHORT_MIN_VOTERS members, fetch
 *     all their votes.
 *   - For each impulse where multiple cohort members voted:
 *     calculate uniformity = max(yes, no) / total.
 *   - Flag if uniformity ≥ threshold AND the cohort has voted
 *     together in a similar pattern on ≥ COHORT_MIN_IMPULSES
 *     impulses.
 */
async function detectCohortAnomalies(db: ReturnType<typeof drizzle<typeof schema>>) {
  // Fetch all users — we group them by creation day
  const users = await db
    .select({
      id: schema.users.id,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users);

  // Group users into cohorts by creation day (UTC)
  const userCohorts = new Map<string, string[]>(); // cohortKey → userIds[]
  for (const u of users) {
    const cohortKey = u.createdAt.toISOString().slice(0, 10); // "YYYY-MM-DD"
    if (!userCohorts.has(cohortKey)) {
      userCohorts.set(cohortKey, []);
    }
    userCohorts.get(cohortKey)!.push(u.id);
  }

  // Only consider cohorts with enough members to be interesting
  const interesting = [...userCohorts.entries()]
    .filter(([, ids]) => ids.length >= COHORT_MIN_VOTERS);

  if (interesting.length === 0) {
    log("cohort scan: no cohorts with enough members");
    return;
  }

  log(`cohort scan: checking ${interesting.length} cohorts with ≥${COHORT_MIN_VOTERS} members`);

  for (const [cohortKey, userIds] of interesting) {
    // Skip already-flagged cohorts — check audit log for recent flags
    const existingFlags = await db
      .select({ count: count() })
      .from(schema.fraudAuditLog)
      .where(
        and(
          eq(schema.fraudAuditLog.action, "cohort_flag"),
          sql`${schema.fraudAuditLog.details}->>'cohortKey' = ${cohortKey}`
        )
      );

    if (Number(existingFlags[0]?.count) > 0) {
      // Already flagged in a previous scan — skip to avoid noise
      continue;
    }

    // Fetch all votes by users in this cohort
    const votes = await db
      .select({
        impulseId: schema.votes.impulseId,
        userId: schema.votes.userId,
        vote: schema.votes.vote,
      })
      .from(schema.votes)
      .where(inArray(schema.votes.userId, userIds));

    if (votes.length === 0) continue;

    // Group votes by impulse
    const votesByImpulse = new Map<string, typeof votes>();
    for (const v of votes) {
      if (!votesByImpulse.has(v.impulseId)) {
        votesByImpulse.set(v.impulseId, []);
      }
      votesByImpulse.get(v.impulseId)!.push(v);
    }

    // For each impulse, check voting uniformity among cohort members
    const flaggedPatterns: CohortVotePattern[] = [];

    for (const [impulseId, impulseVotes] of votesByImpulse) {
      // Count how many unique cohort members voted on this impulse
      const uniqueVoters = new Set(impulseVotes.map(v => v.userId));
      if (uniqueVoters.size < COHORT_MIN_VOTERS) continue;

      const yesVotes = impulseVotes.filter(v => v.vote === "yes").length;
      const noVotes = impulseVotes.filter(v => v.vote === "no").length;
      const totalVotes = impulseVotes.length;
      const uniformity = Math.max(yesVotes, noVotes) / totalVotes;

      if (uniformity >= COHORT_VOTE_UNIFORMITY_THRESHOLD) {
        flaggedPatterns.push({
          cohortKey,
          userIds,
          impulseId,
          uniformityRatio: uniformity,
          yesVotes,
          noVotes,
          totalVotes,
        });
      }
    }

    if (flaggedPatterns.length < COHORT_MIN_IMPULSES) continue;

    // Flag this cohort — consistent voting across multiple impulses
    const patternSummary = {
      cohortKey,
      userIds,
      memberCount: userIds.length,
      flaggedImpulses: flaggedPatterns.length,
      averageUniformity: flaggedPatterns.reduce((s, p) => s + p.uniformityRatio, 0) / flaggedPatterns.length,
      patterns: flaggedPatterns.map(p => ({
        impulseId: p.impulseId,
        uniformity: p.uniformityRatio,
        yesVotes: p.yesVotes,
        noVotes: p.noVotes,
      })),
    };

    // Cohort key is stored in details->>'cohortKey' for dedup lookups
    await db.insert(schema.fraudAuditLog).values({
      action: "cohort_flag",
      groupId: null, // cohort flags aren't group-specific
      details: patternSummary,
    });

    log(
      `COHORT FLAG: cohort ${cohortKey} (${userIds.length} users) — ` +
      `${flaggedPatterns.length} impulses with avg uniformity ` +
      `${(patternSummary.averageUniformity * 100).toFixed(0)}%`
    );
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Cross-Group Observation
// ═══════════════════════════════════════════════════════════

/**
 * Detect accounts that share membership in the same groups and
 * have identical voting patterns across those groups.
 *
 * Algorithm:
 *   - Group memberships by user ID.
 *   - Find pairs of users who share ≥ CROSS_GROUP_MIN_SHARED_GROUPS
 *     group memberships.
 *   - For each such pair, compare their votes across impulses
 *     that belong to those shared groups.
 *   - Flag if agreement ratio ≥ threshold on ≥ MIN_SHARED_IMPULSES.
 */
async function detectCrossGroupAnomalies(db: ReturnType<typeof drizzle<typeof schema>>) {
  // Fetch all memberships
  const allMemberships = await db
    .select({
      userId: schema.memberships.userId,
      groupId: schema.memberships.groupId,
    })
    .from(schema.memberships);

  // Group memberships by user
  const userGroups = new Map<string, string[]>();
  for (const m of allMemberships) {
    if (!userGroups.has(m.userId)) {
      userGroups.set(m.userId, []);
    }
    userGroups.get(m.userId)!.push(m.groupId);
  }

  const userEntries = [...userGroups.entries()];
  if (userEntries.length < 2) {
    log("cross-group scan: not enough users with memberships");
    return;
  }

  // Find pairs with shared groups
  const flaggedPairs: Array<{
    userA: string;
    userB: string;
    sharedGroupIds: string[];
  }> = [];

  for (let i = 0; i < userEntries.length; i++) {
    for (let j = i + 1; j < userEntries.length; j++) {
      const [userA, groupsA] = userEntries[i];
      const [userB, groupsB] = userEntries[j];

      const shared = groupsA.filter(g => groupsB.includes(g));
      if (shared.length >= CROSS_GROUP_MIN_SHARED_GROUPS) {
        flaggedPairs.push({ userA, userB, sharedGroupIds: shared });
      }
    }
  }

  if (flaggedPairs.length === 0) {
    log("cross-group scan: no user pairs with shared group memberships");
    return;
  }

  log(`cross-group scan: examining ${flaggedPairs.length} user pairs with shared memberships`);

  for (const { userA, userB, sharedGroupIds } of flaggedPairs) {
    // Check for existing flag between this pair (in either direction).
    // The details JSONB stores userA/userB as nested {id, username} objects,
    // so we must drill into ->'userB'->>'id' to extract the UUID, not use
    // ->>'userB' which would return the full serialized object as a JSON string.
    const existingFlags = await db
      .select({ count: count() })
      .from(schema.fraudAuditLog)
      .where(
        and(
          eq(schema.fraudAuditLog.action, "cross_group_flag"),
          or(
            and(
              eq(schema.fraudAuditLog.userId, userA),
              sql`${schema.fraudAuditLog.details}->'userB'->>'id' = ${userB}`
            ),
            and(
              eq(schema.fraudAuditLog.userId, userB),
              sql`${schema.fraudAuditLog.details}->'userB'->>'id' = ${userA}`
            )
          )
        )
      );

    if (Number(existingFlags[0]?.count) > 0) {
      // Already flagged — skip
      continue;
    }

    // Fetch votes by both users
    const [votesA, votesB] = await Promise.all([
      db
        .select({
          impulseId: schema.votes.impulseId,
          vote: schema.votes.vote,
        })
        .from(schema.votes)
        .where(eq(schema.votes.userId, userA)),
      db
        .select({
          impulseId: schema.votes.impulseId,
          vote: schema.votes.vote,
        })
        .from(schema.votes)
        .where(eq(schema.votes.userId, userB)),
    ]);

    // Map for fast lookup
    const votesByImpulseA = new Map(votesA.map(v => [v.impulseId, v.vote]));
    const votesByImpulseB = new Map(votesB.map(v => [v.impulseId, v.vote]));

    // Find common impulses (both users voted)
    const commonImpulseIds = [...votesByImpulseA.keys()]
      .filter(id => votesByImpulseB.has(id));

    if (commonImpulseIds.length < CROSS_GROUP_MIN_SHARED_IMPULSES) continue;

    // Verify these impulses belong to shared groups
    const sharedImpulses: Array<{
      impulseId: string;
      voteA: string;
      voteB: string;
      match: boolean;
    }> = [];

    // Fetch impulses to check group affiliation
    const impulsesForShared = await db
      .select({
        id: schema.impulses.id,
        groupId: schema.impulses.groupId,
      })
      .from(schema.impulses)
      .where(inArray(schema.impulses.id, commonImpulseIds));

    const impulseGroupMap = new Map(impulsesForShared.map(i => [i.id, i.groupId]));

    for (const impulseId of commonImpulseIds) {
      // Only count impulses belonging to shared groups
      const groupId = impulseGroupMap.get(impulseId);
      if (!groupId || !sharedGroupIds.includes(groupId)) continue;

      const voteA = votesByImpulseA.get(impulseId)!;
      const voteB = votesByImpulseB.get(impulseId)!;
      sharedImpulses.push({
        impulseId,
        voteA,
        voteB,
        match: voteA === voteB,
      });
    }

    if (sharedImpulses.length < CROSS_GROUP_MIN_SHARED_IMPULSES) continue;

    const identicalVotes = sharedImpulses.filter(s => s.match).length;
    const agreementRatio = identicalVotes / sharedImpulses.length;

    if (agreementRatio >= CROSS_GROUP_AGREEMENT_THRESHOLD) {
      // Fetch usernames for the audit record
      const [userARecord, userBRecord] = await Promise.all([
        db.query.users.findFirst({
          where: (u, { eq }) => eq(u.id, userA),
        }),
        db.query.users.findFirst({
          where: (u, { eq }) => eq(u.id, userB),
        }),
      ]);

      await db.insert(schema.fraudAuditLog).values({
        action: "cross_group_flag",
        userId: userA, // Primary user in the pair
        groupId: null,
        details: {
          userA: { id: userA, username: userARecord?.username },
          userB: { id: userB, username: userBRecord?.username },
          sharedGroups: sharedGroupIds,
          sharedImpulses: sharedImpulses.length,
          agreementRatio,
          identicalVotes,
          totalVotesOnShared: sharedImpulses.length,
          voteDetails: sharedImpulses.map(s => ({
            impulseId: s.impulseId,
            match: s.match,
          })),
        },
      });

      log(
        `CROSS-GROUP FLAG: ${userARecord?.username ?? userA.slice(0, 8)}` +
        ` & ${userBRecord?.username ?? userB.slice(0, 8)}` +
        ` — ${sharedGroupIds.length} shared groups, ` +
        `${identicalVotes}/${sharedImpulses.length} identical votes ` +
        `(${(agreementRatio * 100).toFixed(0)}% agreement)`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 3. Behavioral Heuristics — Same-Vote Blocs
// ═══════════════════════════════════════════════════════════

/**
 * Detect blocs of users who vote identically across a significant
 * number of common impulses. A "bloc" is a set of users where every
 * pair agrees ≥ SAME_VOTE_BLOC_AGREEMENT_THRESHOLD of the time.
 *
 * Algorithm:
 *   - Fetch all votes grouped by impulse.
 *   - For each impulse, create a vote-signature per user.
 *   - For each pair of users that voted on the same impulse,
 *     track whether their votes matched.
 *   - Flag any pair whose agreement ratio exceeds the threshold
 *     across ≥ SAME_VOTE_BLOC_MIN_COMMON_IMPULSES.
 */
async function detectSameVoteBlocs(db: ReturnType<typeof drizzle<typeof schema>>) {
  // Fetch all non-abstain votes with timestamps
  const allVotes = await db
    .select({
      impulseId: schema.votes.impulseId,
      userId: schema.votes.userId,
      vote: schema.votes.vote,
    })
    .from(schema.votes);

  if (allVotes.length < 4) {
    log("same-vote bloc scan: not enough votes");
    return;
  }

  // Group votes by impulse
  const votesByImpulse = new Map<string, typeof allVotes>();
  for (const v of allVotes) {
    if (!votesByImpulse.has(v.impulseId)) {
      votesByImpulse.set(v.impulseId, []);
    }
    votesByImpulse.get(v.impulseId)!.push(v);
  }

  // For each pair of users, track agreement
  const pairAgreement = new Map<string, { total: number; matches: number; firstUserId: string; secondUserId: string }>();

  for (const [, impulseVotes] of votesByImpulse) {
    const uniqueVoters = [...new Set(impulseVotes.map((v) => v.userId))];
    if (uniqueVoters.length < SAME_VOTE_BLOC_MIN_USERS) continue;

    // Build per-user vote map for this impulse
    const userVoteMap = new Map<string, string>();
    for (const v of impulseVotes) {
      userVoteMap.set(v.userId, v.vote);
    }

    // Compare every pair
    for (let i = 0; i < uniqueVoters.length; i++) {
      for (let j = i + 1; j < uniqueVoters.length; j++) {
        const uA = uniqueVoters[i];
        const uB = uniqueVoters[j];
        const vA = userVoteMap.get(uA);
        const vB = userVoteMap.get(uB);
        if (!vA || !vB || vA === "abstain" || vB === "abstain") continue;

        const pairKey = uA < uB ? `${uA}:${uB}` : `${uB}:${uA}`;
        if (!pairAgreement.has(pairKey)) {
          pairAgreement.set(pairKey, { total: 0, matches: 0, firstUserId: uA < uB ? uA : uB, secondUserId: uA < uB ? uB : uA });
        }
        const entry = pairAgreement.get(pairKey)!;
        entry.total++;
        if (vA === vB) entry.matches++;
      }
    }
  }

  if (pairAgreement.size === 0) {
    log("same-vote bloc scan: no voter pairs found");
    return;
  }

  // Filter pairs that meet the threshold
  const flaggedPairs = [...pairAgreement.values()]
    .filter((p) => p.total >= SAME_VOTE_BLOC_MIN_COMMON_IMPULSES && p.matches / p.total >= SAME_VOTE_BLOC_AGREEMENT_THRESHOLD);

  if (flaggedPairs.length === 0) {
    log("same-vote bloc scan: no suspicious pairs found");
    return;
  }

  log(`same-vote bloc scan: ${flaggedPairs.length} suspicious pairs found`);

  for (const pair of flaggedPairs) {
    // Check for existing flag between this pair
    const existingFlags = await db
      .select({ count: count() })
      .from(schema.fraudAuditLog)
      .where(
        and(
          eq(schema.fraudAuditLog.action, "same_vote_bloc_flag"),
          or(
            and(
              eq(schema.fraudAuditLog.userId, pair.firstUserId),
              sql`${schema.fraudAuditLog.details}->>'pairedWith' = ${pair.secondUserId}`
            ),
            and(
              eq(schema.fraudAuditLog.userId, pair.secondUserId),
              sql`${schema.fraudAuditLog.details}->>'pairedWith' = ${pair.firstUserId}`
            )
          )
        )
      );

    if (Number(existingFlags[0]?.count) > 0) continue;

    const agreementRatio = pair.matches / pair.total;

    // Fetch usernames
    const [userARecord, userBRecord] = await Promise.all([
      db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, pair.firstUserId) }),
      db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, pair.secondUserId) }),
    ]);

    await db.insert(schema.fraudAuditLog).values({
      action: "same_vote_bloc_flag",
      userId: pair.firstUserId,
      groupId: null,
      details: {
        userA: { id: pair.firstUserId, username: userARecord?.username },
        userB: { id: pair.secondUserId, username: userBRecord?.username },
        identicalVotes: pair.matches,
        totalCommonVotes: pair.total,
        agreementRatio,
      },
    });

    log(
      `SAME-VOTE BLOC FLAG: ${userARecord?.username ?? pair.firstUserId.slice(0, 8)}` +
      ` & ${userBRecord?.username ?? pair.secondUserId.slice(0, 8)}` +
      ` — ${pair.matches}/${pair.total} identical votes ` +
      `(${(agreementRatio * 100).toFixed(0)}% agreement)`
    );
  }
}

// ═══════════════════════════════════════════════════════════
// 4. Behavioral Heuristics — Coordinated Timing
// ═══════════════════════════════════════════════════════════

/**
 * Detect coordinated voting patterns — multiple users casting
 * votes on the same impulse within a very short time window,
 * suggesting scripted or orchestrated voting.
 *
 * Algorithm:
 *   - Fetch all votes with their cast_at timestamps.
 *   - Group votes by impulse.
 *   - Within each impulse, find clusters of votes cast within
 *     COORDINATED_TIMING_WINDOW_MS of each other.
 *   - Flag any impulse where a cluster of ≥ COORDINATED_TIMING_MIN_COHORT_SIZE
 *     distinct users appears, and this pattern repeats across
 *     ≥ COORDINATED_TIMING_MIN_INSTANCES impulses.
 */
async function detectCoordinatedTiming(db: ReturnType<typeof drizzle<typeof schema>>) {
  // Fetch all votes with timestamps — include the user table for username
  const allVotes = await db
    .select({
      impulseId: schema.votes.impulseId,
      userId: schema.votes.userId,
      castAt: schema.votes.castAt,
    })
    .from(schema.votes);

  if (allVotes.length < 4) {
    log("coordinated timing scan: not enough votes");
    return;
  }

  // Group votes by impulse, sorted by time
  const votesByImpulse = new Map<string, typeof allVotes>();
  for (const v of allVotes) {
    if (!votesByImpulse.has(v.impulseId)) {
      votesByImpulse.set(v.impulseId, []);
    }
    votesByImpulse.get(v.impulseId)!.push(v);
  }

  // Track clusters per user pair across impulses
  const pairCoordinationCount = new Map<string, {
    count: number;
    firstUserId: string;
    secondUserId: string;
    impulses: string[];
  }>();

  for (const [impulseId, impulseVotes] of votesByImpulse) {
    if (impulseVotes.length < COORDINATED_TIMING_MIN_COHORT_SIZE) continue;

    // Sort by cast time
    impulseVotes.sort((a, b) => new Date(a.castAt).getTime() - new Date(b.castAt).getTime());

    // Sliding window: find clusters of votes within the timing window
    for (let i = 0; i < impulseVotes.length; i++) {
      const windowStart = new Date(impulseVotes[i].castAt).getTime();
      const cluster: typeof allVotes = [];

      for (let k = i; k < impulseVotes.length; k++) {
        const diff = new Date(impulseVotes[k].castAt).getTime() - windowStart;
        if (diff <= COORDINATED_TIMING_WINDOW_MS) {
          cluster.push(impulseVotes[k]);
        } else {
          break; // votes are sorted, no need to continue
        }
      }

      // Need at least MIN_COHORT_SIZE distinct users in the window
      const uniqueInCluster = [...new Set(cluster.map((v) => v.userId))];
      if (uniqueInCluster.length < COORDINATED_TIMING_MIN_COHORT_SIZE) continue;

      // Record coordination for each pair in this cluster
      for (let a = 0; a < uniqueInCluster.length; a++) {
        for (let b = a + 1; b < uniqueInCluster.length; b++) {
          const uA = uniqueInCluster[a];
          const uB = uniqueInCluster[b];
          const pairKey = uA < uB ? `${uA}:${uB}` : `${uB}:${uA}`;

          if (!pairCoordinationCount.has(pairKey)) {
            pairCoordinationCount.set(pairKey, {
              count: 0,
              firstUserId: uA < uB ? uA : uB,
              secondUserId: uA < uB ? uB : uA,
              impulses: [],
            });
          }
          const entry = pairCoordinationCount.get(pairKey)!;
          // Avoid double-counting the same impulse
          if (!entry.impulses.includes(impulseId)) {
            entry.count++;
            entry.impulses.push(impulseId);
          }
        }
      }
    }
  }

  if (pairCoordinationCount.size === 0) {
    log("coordinated timing scan: no coordinated pairs found");
    return;
  }

  // Filter pairs that show coordination across enough impulses
  const flaggedPairs = [...pairCoordinationCount.values()]
    .filter((p) => p.count >= COORDINATED_TIMING_MIN_INSTANCES);

  if (flaggedPairs.length === 0) {
    log("coordinated timing scan: no suspicious timing patterns found");
    return;
  }

  log(`coordinated timing scan: ${flaggedPairs.length} suspicious pairs found`);

  for (const pair of flaggedPairs) {
    // Check for existing flag
    const existingFlags = await db
      .select({ count: count() })
      .from(schema.fraudAuditLog)
      .where(
        and(
          eq(schema.fraudAuditLog.action, "timing_flag"),
          or(
            and(
              eq(schema.fraudAuditLog.userId, pair.firstUserId),
              sql`${schema.fraudAuditLog.details}->>'pairedWith' = ${pair.secondUserId}`
            ),
            and(
              eq(schema.fraudAuditLog.userId, pair.secondUserId),
              sql`${schema.fraudAuditLog.details}->>'pairedWith' = ${pair.firstUserId}`
            )
          )
        )
      );

    if (Number(existingFlags[0]?.count) > 0) continue;

    const [userARecord, userBRecord] = await Promise.all([
      db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, pair.firstUserId) }),
      db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, pair.secondUserId) }),
    ]);

    await db.insert(schema.fraudAuditLog).values({
      action: "timing_flag",
      userId: pair.firstUserId,
      groupId: null,
      details: {
        userA: { id: pair.firstUserId, username: userARecord?.username },
        userB: { id: pair.secondUserId, username: userBRecord?.username },
        coordinatedImpulses: pair.count,
        timingWindowMs: COORDINATED_TIMING_WINDOW_MS,
        impulseIds: pair.impulses,
      },
    });

    log(
      `TIMING FLAG: ${userARecord?.username ?? pair.firstUserId.slice(0, 8)}` +
      ` & ${userBRecord?.username ?? pair.secondUserId.slice(0, 8)}` +
      ` — ${pair.count} impulses with coordinated timing ` +
      `(within ${COORDINATED_TIMING_WINDOW_MS / 1000}s window)`
    );
  }
}
