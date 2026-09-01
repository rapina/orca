/**
 * What a session itself said, read from its own transcript.
 *
 * Why this exists apart from the status a pane holds: a pane holds one status,
 * and its prompt and tool fields carry over from whatever reported there last.
 * Several sessions can report one pane key - every agent a background-job host
 * owns reports the terminal that started that host - so the text on such a
 * status can belong to a different session than the id beside it. A transcript
 * belongs to exactly one session, so showing it to a person names the right one.
 */

/** Why a floor at all: a reply of "ok" tells a person nothing about which session
 *  they are looking at, which is the only thing this text is for. */
const EVIDENCE_MIN_LENGTH = 24
/** Why lower for prompts: what a person typed is short and still theirs to recognise. */
const PROMPT_MIN_LENGTH = 4

/** What one session was asked and last answered, both from its own transcript. */
export type AgentSessionTurn = {
  prompt: string | null
  reply: string | null
}

function userPromptTextsOf(record: unknown): string[] {
  if (!record || typeof record !== 'object') {
    return []
  }
  const row = record as Record<string, unknown>
  // Why skipped: a subagent's prompts were written by the agent, and a meta record
  // is the harness talking to itself; neither is what the person asked.
  if (row.isSidechain === true || row.isMeta === true) {
    return []
  }
  const message = row.message
  if (!message || typeof message !== 'object') {
    return []
  }
  const body = message as Record<string, unknown>
  if (body.role !== 'user') {
    return []
  }
  const texts: string[] = []
  if (typeof body.content === 'string') {
    texts.push(body.content)
  } else if (Array.isArray(body.content)) {
    for (const part of body.content) {
      if (part && typeof part === 'object') {
        const block = part as Record<string, unknown>
        if (block.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text)
        }
      }
    }
  }
  // Why the angle bracket: slash commands and injected context arrive as user
  // records wrapped in tags (`<command-name>`, `<system-reminder>`), not as words typed.
  return texts.filter((text) => !text.trimStart().startsWith('<'))
}

/** The newest prompts the person typed into a transcript tail, newest first. */
export function userPromptTextsFromTranscriptTail(tail: string, limit: number): string[] {
  const lines = tail.split('\n')
  lines.shift()
  const texts: string[] = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) {
      continue
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    for (const text of userPromptTextsOf(record)) {
      const trimmed = text.trim()
      if (trimmed.length >= PROMPT_MIN_LENGTH) {
        texts.push(trimmed)
      }
    }
    if (texts.length >= limit) {
      return texts.slice(0, limit)
    }
  }
  return texts
}

function assistantTextsOf(record: unknown): string[] {
  if (!record || typeof record !== 'object') {
    return []
  }
  const row = record as Record<string, unknown>
  // Why skipped: a subagent's turns are its own, not this session's, so showing
  // one would name a conversation the person never had with this agent.
  if (row.isSidechain === true) {
    return []
  }
  const message = row.message
  if (!message || typeof message !== 'object') {
    return []
  }
  const body = message as Record<string, unknown>
  if (body.role !== 'assistant' || !Array.isArray(body.content)) {
    return []
  }
  const texts: string[] = []
  for (const part of body.content) {
    if (part && typeof part === 'object') {
      const block = part as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text)
      }
    }
  }
  return texts
}

/**
 * The newest assistant turns in a transcript tail, newest first.
 *
 * Why a tail and not the file: transcripts run to megabytes and only the newest
 * turns say what this session is doing now. The first line is dropped because
 * reading from an offset cuts a record in half.
 */
export function assistantTextsFromTranscriptTail(tail: string, limit: number): string[] {
  const lines = tail.split('\n')
  lines.shift()
  const texts: string[] = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) {
      continue
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      // Why tolerated: a rotated or concurrently written transcript can hold a
      // torn line, and one unreadable record says nothing about the rest.
      continue
    }
    for (const text of assistantTextsOf(record)) {
      const trimmed = text.trim()
      if (trimmed.length >= EVIDENCE_MIN_LENGTH) {
        texts.push(trimmed)
      }
    }
    if (texts.length >= limit) {
      return texts.slice(0, limit)
    }
  }
  return texts
}
