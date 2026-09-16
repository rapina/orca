export const MAX_TERMINAL_PULL_REQUESTS = 8

const CREATE_COMMAND =
  /\bgh\s+(?:(?:--repo|-R)\s+\S+\s+)?pr\s+create\b|\bglab\s+(?:(?:--repo|-R)\s+\S+\s+)?mr\s+create\b/
const REVIEW_URL =
  /https?:\/\/[\w.-]+(?::\d+)?\/[\w.-]+\/[\w.-]+\/pull\/\d+|https?:\/\/[\w.-]+(?::\d+)?\/[\w./-]+?\/-\/merge_requests\/\d+/g
const MAX_PENDING = 128

export type TerminalTranscriptContext = {
  directory?: { cwd: string; branch?: string }
  urls: string[]
  createCalls: Set<string>
  pendingJobs: Set<string>
}

export function createTerminalTranscriptContext(): TerminalTranscriptContext {
  return { urls: [], createCalls: new Set(), pendingJobs: new Set() }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function remember(set: Set<string>, value: string): void {
  set.delete(value)
  set.add(value)
  if (set.size > MAX_PENDING) {
    set.delete(set.values().next().value!)
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '')
}

function inputObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') {
    return object(value)
  }
  try {
    return object(JSON.parse(value))
  } catch {
    return undefined
  }
}

function consumeCall(state: TerminalTranscriptContext, id: string, input: unknown): void {
  const args = inputObject(input)
  const cwd = args?.workdir ?? args?.cwd
  if (typeof cwd === 'string' && cwd.trim()) {
    state.directory = { cwd: cwd.trim() }
  }
  const job = args?.session_id ?? args?.task_id ?? args?.cell_id
  if (
    CREATE_COMMAND.test(text(input)) ||
    (job !== undefined && state.pendingJobs.has(String(job)))
  ) {
    remember(state.createCalls, id)
  }
}

function consumeResult(state: TerminalTranscriptContext, id: string, output: unknown): void {
  if (!state.createCalls.has(id)) {
    return
  }
  const result = text(output)
  for (const match of result.matchAll(REVIEW_URL)) {
    if (!state.urls.includes(match[0])) {
      state.urls.push(match[0])
    }
  }
  state.urls = state.urls.slice(-MAX_TERMINAL_PULL_REQUESTS)
  // Shell tools can return a job handle before the command prints its URL.
  const job =
    /(?:session ID|cell ID|background with ID:|session_id["']?\s*[:=]|cell_id["']?\s*[:=]|task_id["']?\s*[:=])\s*["']?([\w-]+)/i.exec(
      result
    )
  if (job?.[1]) {
    remember(state.pendingJobs, job[1])
  }
  state.createCalls.delete(id)
}

/** Call identities survive read boundaries and interleaved tool results. */
export function consumeTerminalTranscriptLine(
  state: TerminalTranscriptContext,
  line: string
): void {
  let record: Record<string, unknown> | undefined
  try {
    record = object(JSON.parse(line))
  } catch {
    return
  }
  if (!record || record.isSidechain === true) {
    return
  }
  const directory = parseTranscriptWorkingDirectory(`\n${line}`)
  if (directory) {
    state.directory = directory
  }
  const message = object(record.message)
  if (Array.isArray(message?.content)) {
    for (const raw of message.content) {
      const part = object(raw)
      if (part?.type === 'tool_use' && typeof part.id === 'string') {
        consumeCall(state, part.id, part.input)
      } else if (part?.type === 'tool_result' && typeof part.tool_use_id === 'string') {
        consumeResult(state, part.tool_use_id, [part.content, record.toolUseResult])
      }
    }
  }
  const payload = record.type === 'response_item' ? object(record.payload) : record
  if (!payload) {
    return
  }
  const id = payload.call_id ?? payload.id
  if (typeof id !== 'string') {
    return
  }
  if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(String(payload.type))) {
    consumeCall(state, id, payload.arguments ?? payload.input ?? payload.action)
  } else if (['function_call_output', 'custom_tool_call_output'].includes(String(payload.type))) {
    consumeResult(state, id, payload.output)
  }
}

export function parseTranscriptWorkingDirectory(
  tail: string
): { cwd: string; branch?: string } | null {
  const lines = tail.split('\n')
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    let row: Record<string, unknown> | undefined
    try {
      row = object(JSON.parse(lines[index]!))
    } catch {
      continue
    }
    if (!row || row.isSidechain === true) {
      continue
    }
    const source =
      row.type === 'session_meta' || row.type === 'turn_context' ? object(row.payload) : row
    const cwd = typeof source?.cwd === 'string' ? source.cwd.trim() : ''
    if (!cwd) {
      continue
    }
    const git = object(source?.git)
    const branch = typeof source?.gitBranch === 'string' ? source.gitBranch : git?.branch
    return typeof branch === 'string' && branch.trim() ? { cwd, branch: branch.trim() } : { cwd }
  }
  return null
}

export function extractPullRequestUrlsFromTranscript(text: string): string[] {
  const state = createTerminalTranscriptContext()
  for (const line of text.split('\n')) {
    consumeTerminalTranscriptLine(state, line)
  }
  return state.urls
}
