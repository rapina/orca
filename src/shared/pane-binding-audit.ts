/**
 * Finds agent statuses that are bound to the wrong terminal.
 *
 * Why this exists: a hook reports the pane key its process was born with. An
 * agent started as a background job keeps the environment of whichever terminal
 * launched it, so its turns can land on a terminal that is not the one showing
 * the session. The pane key alone cannot reveal that - it agrees with itself.
 * What does reveal it is the terminal's own recorded output: the session id
 * appears in the terminal that is actually running it.
 */

/** Recorded output of one terminal, tail first - only the tail is scanned. */
export type PaneOutputSample = {
  paneKey: string
  tail: string
}

export type PaneBindingStatusInput = {
  paneKey: string
  sessionId: string
  /** A distinctive line from the turn, used to break ties between panes. */
  evidence?: string | undefined
}

export type PaneBindingFinding = {
  /** Where the status is bound today. */
  paneKey: string
  sessionId: string
  /** The terminal whose output actually carries this session. */
  candidatePaneKey: string
  candidateHits: number
  runnerUpHits: number
}

/** Why: one stray mention (a path echoed in a shell, a log line) is not a session. */
const MIN_CANDIDATE_HITS = 3
/** Why: a clear winner only. A near tie means two terminals mention the session. */
const WINNER_MARGIN = 2
/** Why: an evidence line is far rarer than an id, so it outweighs raw id hits. */
const EVIDENCE_WEIGHT = 5
const EVIDENCE_MIN_LENGTH = 24
const EVIDENCE_MAX_LENGTH = 120

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0
  }
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Why trimmed: the recorded output wraps and re-paints lines, so only a short
 * run of characters survives verbatim. Too short a run matches anything.
 */
function evidenceNeedle(evidence: string | undefined): string | null {
  const collapsed = evidence?.replace(/\s+/g, ' ').trim()
  if (!collapsed || collapsed.length < EVIDENCE_MIN_LENGTH) {
    return null
  }
  return collapsed.slice(0, EVIDENCE_MAX_LENGTH)
}

type PaneScore = { paneKey: string; idHits: number; evidenceHits: number; total: number }

function scorePane(sample: PaneOutputSample, status: PaneBindingStatusInput): PaneScore {
  const idHits = countOccurrences(sample.tail, status.sessionId)
  const needle = evidenceNeedle(status.evidence)
  const evidenceHits = needle ? countOccurrences(sample.tail, needle) : 0
  return {
    paneKey: sample.paneKey,
    idHits,
    evidenceHits,
    total: idHits + evidenceHits * EVIDENCE_WEIGHT
  }
}

/**
 * The one terminal the recording points at, or null when it points at none or
 * at several.
 *
 * Why two tiers: a line the agent itself printed is far stronger than the id,
 * which shells and greps echo freely. When exactly one terminal carries that
 * line it decides on its own; otherwise a terminal has to out-mention every
 * other by a clear margin.
 */
function pickWinner(
  scored: readonly PaneScore[]
): { best: PaneScore; runnerUpHits: number } | null {
  const withEvidence = scored.filter((score) => score.evidenceHits > 0)
  if (withEvidence.length === 1) {
    const best = withEvidence[0]!
    const runnerUp = scored.find((score) => score.paneKey !== best.paneKey)
    return { best, runnerUpHits: runnerUp?.total ?? 0 }
  }
  if (withEvidence.length > 1) {
    return null
  }
  const best = scored[0]
  if (!best || best.total < MIN_CANDIDATE_HITS) {
    return null
  }
  const runnerUpHits = scored[1]?.total ?? 0
  if (best.total < runnerUpHits * WINNER_MARGIN + 1) {
    return null
  }
  return { best, runnerUpHits }
}

/**
 * One finding per status that looks misbound. A status whose own terminal shows
 * any trace of the session is left alone, and so is one no terminal claims.
 */
export function auditPaneBindings(
  statuses: readonly PaneBindingStatusInput[],
  samples: readonly PaneOutputSample[]
): PaneBindingFinding[] {
  const findings: PaneBindingFinding[] = []
  for (const status of statuses) {
    if (!status.sessionId) {
      continue
    }
    const own = samples.find((sample) => sample.paneKey === status.paneKey)
    // Why: no recording for the bound pane means no evidence either way. Calling
    // that a misbinding would move statuses on nothing but a missing file.
    if (!own || scorePane(own, status).total > 0) {
      continue
    }
    const scored = samples
      .filter((sample) => sample.paneKey !== status.paneKey)
      .map((sample) => scorePane(sample, status))
      .sort((a, b) => b.total - a.total)
    const winner = pickWinner(scored)
    if (!winner) {
      continue
    }
    findings.push({
      paneKey: status.paneKey,
      sessionId: status.sessionId,
      candidatePaneKey: winner.best.paneKey,
      candidateHits: winner.best.total,
      runnerUpHits: winner.runnerUpHits
    })
  }
  return findings
}
