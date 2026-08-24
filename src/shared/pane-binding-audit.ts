/**
 * Finds agent statuses that are bound to the wrong terminal.
 *
 * Why this exists: a hook reports the pane key its process was born with. An
 * agent started as a background job keeps the environment of whichever terminal
 * launched that job host, so its turns land on a terminal that is not the one
 * showing the session - and every background session reports the same one. The
 * pane key alone cannot reveal that: it agrees with itself.
 *
 * What does reveal it is the terminal's own recorded output. The terminal that
 * renders a session carries the text of that session's turns, and no other
 * terminal does. The session id does NOT work for this - agents do not print
 * their own id, so searching for it finds nothing at all (measured: 3 of 5 live
 * terminals held no id anywhere in their recording).
 */

/** Recorded output of one terminal - only the tail is scanned. */
export type PaneOutputSample = {
  paneKey: string
  tail: string
}

export type PaneBindingStatusInput = {
  paneKey: string
  sessionId: string
  /** Distinctive text this turn put on screen: assistant output, the prompt, a
   *  tool argument. Any single one that lands decides. */
  evidence?: readonly string[]
}

export type PaneBindingFinding = {
  /** Where the status is bound today. */
  paneKey: string
  sessionId: string
  /** The terminal whose output actually carries this session. */
  candidatePaneKey: string
  candidateHits: number
  runnerUpHits: number
  /** The run of text that decided it, so the suggestion can be checked before it is taken. */
  matchedText?: string
}

/** Why: one stray mention (a path echoed in a shell, a log line) is not a session. */
const MIN_CANDIDATE_HITS = 3
/** Why: a clear winner only. A near tie means two terminals mention the session. */
const WINNER_MARGIN = 2
/** Why: a line the agent printed is far rarer than an id, which shells echo freely. */
const EVIDENCE_WEIGHT = 5
/** Why: shorter runs than this match by accident once whitespace is gone. Korean
 *  and CJK pack far more meaning per character, so this is counted after squashing. */
const EVIDENCE_MIN_LENGTH = 16
/** Why sliced into windows instead of searched whole: a TUI breaks a long line
 *  across rows and may repaint a gutter into the break, so no single run of the
 *  original survives end to end. A window short enough to sit between two breaks
 *  does, and one landing is all the audit needs. */
const EVIDENCE_WINDOW_LENGTH = 20
/** Why capped: evidence is bounded already, but a status carries four fields and
 *  every window costs a scan of every terminal's tail. */
const EVIDENCE_MAX_WINDOWS = 24
/** Why more than one turn has to land: a terminal that renders a session shows
 *  turn after turn of it, while a job list shows one summary line per session -
 *  so a single matching turn is exactly what a list of *other* sessions looks
 *  like. Measured: one session's newest turn appeared in six terminals at once,
 *  and only the terminal actually running it carried a second turn. */
const MIN_MATCHED_TURNS = 2

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
/** Why built from char codes: a literal escape byte in a regex trips no-control-regex. */
const ANSI_SEQUENCE = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*${BEL}|${ESC}[@-Z_]`,
  'g'
)
const WHITESPACE = /\s+/g

/**
 * Strips a terminal recording down to what a needle can be compared against.
 *
 * Why whitespace goes entirely, not collapsed: a TUI hard-wraps its output at the
 * terminal width, and for text without spaces at the wrap column (Korean, CJK,
 * long paths) that break falls mid-word. Collapsing leaves a space the needle
 * does not have; removing leaves both sides comparable.
 */
export function squashForBindingMatch(text: string): string {
  return text.replace(ANSI_SEQUENCE, '').replace(WHITESPACE, '')
}

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

/** One searchable window, and which turn it came from. */
type EvidenceNeedle = { needle: string; turn: number }

/** The searchable windows of each evidence string, dropping runs too short to mean anything. */
function evidenceNeedles(evidence: readonly string[] | undefined): EvidenceNeedle[] {
  const needles: EvidenceNeedle[] = []
  const seen = new Set<string>()
  const turns = evidence ?? []
  for (let turn = 0; turn < turns.length; turn += 1) {
    const squashed = squashForBindingMatch(turns[turn] ?? '')
    for (
      let start = 0;
      start + EVIDENCE_MIN_LENGTH <= squashed.length;
      start += EVIDENCE_WINDOW_LENGTH
    ) {
      const needle = squashed.slice(start, start + EVIDENCE_WINDOW_LENGTH)
      if (!seen.has(needle)) {
        seen.add(needle)
        needles.push({ needle, turn })
      }
      if (needles.length >= EVIDENCE_MAX_WINDOWS) {
        return needles
      }
    }
  }
  return needles
}

type PaneScore = {
  paneKey: string
  idHits: number
  evidenceHits: number
  /** How many distinct turns of this session the terminal carries. */
  matchedTurns: number
  total: number
  matchedNeedle: string | null
}

function scorePane(
  tail: string,
  sessionId: string,
  needles: readonly EvidenceNeedle[]
): Omit<PaneScore, 'paneKey'> {
  const idHits = countOccurrences(tail, sessionId)
  let evidenceHits = 0
  let matchedNeedle: string | null = null
  const matchedTurns = new Set<number>()
  for (const entry of needles) {
    const hits = countOccurrences(tail, entry.needle)
    if (hits > 0) {
      matchedTurns.add(entry.turn)
      if (matchedNeedle === null) {
        matchedNeedle = entry.needle
      }
    }
    evidenceHits += hits
  }
  return {
    idHits,
    evidenceHits,
    matchedTurns: matchedTurns.size,
    total: idHits + evidenceHits * EVIDENCE_WEIGHT,
    matchedNeedle
  }
}

/**
 * The one terminal the recording points at, or null when it points at none or
 * at several.
 *
 * Why two tiers that never mix: a terminal running a session prints turn after
 * turn of it, so carrying two of them is what tells a running session apart from
 * a job list that shows one summary line each for many. Only when nothing carries
 * two turns does the session id get a say, and then on its own count alone - a
 * single matching turn must not be able to win by borrowing the id tier's
 * threshold, which is exactly how a job list would win.
 */
function pickWinner(
  scored: readonly PaneScore[]
): { best: PaneScore; runnerUpHits: number } | null {
  const carriers = scored.filter((score) => score.matchedTurns >= MIN_MATCHED_TURNS)
  if (carriers.length === 1) {
    const best = carriers[0]!
    const runnerUp = scored.find((score) => score.paneKey !== best.paneKey)
    return { best, runnerUpHits: runnerUp?.total ?? 0 }
  }
  if (carriers.length > 1) {
    return null
  }
  const byId = [...scored].sort((a, b) => b.idHits - a.idHits)
  const best = byId[0]
  if (!best || best.idHits < MIN_CANDIDATE_HITS) {
    return null
  }
  const runnerUpHits = byId[1]?.idHits ?? 0
  if (best.idHits < runnerUpHits * WINNER_MARGIN + 1) {
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
  const squashedByPaneKey = new Map<string, string>()
  for (const sample of samples) {
    squashedByPaneKey.set(sample.paneKey, squashForBindingMatch(sample.tail))
  }
  const findings: PaneBindingFinding[] = []
  for (const status of statuses) {
    const needles = evidenceNeedles(status.evidence)
    if (!status.sessionId && needles.length === 0) {
      continue
    }
    const own = squashedByPaneKey.get(status.paneKey)
    // Why: no recording for the bound pane means no evidence either way. Calling
    // that a misbinding would move statuses on nothing but a missing file.
    if (own === undefined || scorePane(own, status.sessionId, needles).total > 0) {
      continue
    }
    const scored: PaneScore[] = []
    for (const [paneKey, tail] of squashedByPaneKey) {
      if (paneKey === status.paneKey) {
        continue
      }
      scored.push({ paneKey, ...scorePane(tail, status.sessionId, needles) })
    }
    scored.sort((a, b) => b.total - a.total)
    const winner = pickWinner(scored)
    if (!winner) {
      continue
    }
    findings.push({
      paneKey: status.paneKey,
      sessionId: status.sessionId,
      candidatePaneKey: winner.best.paneKey,
      candidateHits: winner.best.total,
      runnerUpHits: winner.runnerUpHits,
      ...(winner.best.matchedNeedle ? { matchedText: winner.best.matchedNeedle } : {})
    })
  }
  return findings
}
