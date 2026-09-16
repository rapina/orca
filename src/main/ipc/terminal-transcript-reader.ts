import {
  closeTranscriptHandle,
  wslGatedOpen,
  wslGatedRead,
  wslGatedStat
} from '../native-chat/wsl-transcript-fs-access'
import {
  consumeTerminalTranscriptLine,
  createTerminalTranscriptContext,
  type TerminalTranscriptContext
} from '../../shared/terminal-transcript-context'

type Scan = {
  offset: number
  identity: string
  context: TerminalTranscriptContext
  skipLine: boolean
}
const scans = new Map<string, Scan>()
const inFlight = new Map<string, Promise<TerminalTranscriptContext | null>>()
const CHUNK_BYTES = 64 * 1024
const MAX_LINE_BYTES = 16 * 1024 * 1024

async function scanTranscript(path: string): Promise<TerminalTranscriptContext | null> {
  if (!path.toLowerCase().endsWith('.jsonl')) {
    return null
  }
  const handle = await wslGatedOpen(path, 'exact').catch(() => null)
  if (!handle) {
    return null
  }
  try {
    const stats = await wslGatedStat(path, 'exact')
    const identity = `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`
    const previous = scans.get(path)
    const scan =
      previous && previous.identity === identity && previous.offset <= stats.size
        ? previous
        : { offset: 0, identity, context: createTerminalTranscriptContext(), skipLine: false }
    let position = scan.offset
    let pending: Buffer[] = []
    let pendingBytes = 0
    while (position < stats.size) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, stats.size - position))
      const { bytesRead } = await wslGatedRead(
        handle,
        path,
        chunk,
        0,
        chunk.length,
        position,
        'exact'
      )
      if (!bytesRead) {
        break
      }
      position += bytesRead
      let start = 0
      let end: number
      while ((end = chunk.indexOf(10, start)) !== -1 && end < bytesRead) {
        if (!scan.skipLine) {
          pending.push(chunk.subarray(start, end))
          consumeTerminalTranscriptLine(scan.context, Buffer.concat(pending).toString('utf8'))
        }
        pending = []
        pendingBytes = 0
        scan.skipLine = false
        start = end + 1
        scan.offset = position - bytesRead + start
      }
      if (start < bytesRead && !scan.skipLine) {
        pending.push(chunk.subarray(start, bytesRead))
        pendingBytes += bytesRead - start
        if (pendingBytes > MAX_LINE_BYTES) {
          pending = []
          pendingBytes = 0
          scan.skipLine = true
        }
      }
      if (scan.skipLine) {
        scan.offset = position
      }
    }
    // Keep the unfinished record on disk until its terminating newline arrives.
    scans.delete(path)
    scans.set(path, scan)
    if (scans.size > 200) {
      scans.delete(scans.keys().next().value!)
    }
    return scan.context
  } finally {
    await closeTranscriptHandle(handle, path)
  }
}

export function readTerminalTranscriptContext(
  path: string
): Promise<TerminalTranscriptContext | null> {
  const pending = inFlight.get(path)
  if (pending) {
    return pending
  }
  const result = scanTranscript(path)
    .catch(() => null)
    .finally(() => inFlight.delete(path))
  inFlight.set(path, result)
  return result
}
