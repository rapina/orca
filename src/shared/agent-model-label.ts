/**
 * The short name a person calls a model by, from the id a provider reports.
 *
 * Why here: three rows show the same field — the terminal list, the worktree
 * card, the dashboard — and a Claude id arrives as `claude-fable-5-1`, which is
 * not how anyone says it. An id this does not recognise is shown as it came.
 */

// `claude-opus-4-1-20250805`, `claude-3-5-sonnet-20241022`, `claude-fable-5-1`,
// `anthropic.claude-sonnet-4-5-20250929-v1:0`, `claude-opus-4-8[1m]`.
const CLAUDE_MODEL_ID =
  /(?:^|[./])claude-([a-z0-9-]+?)(?:-\d{8})?(?:-v\d+(?::\d+)?)?(?:\[[^\]]*\])?$/i
// What Claude Code accepts as a bare `--model` alias.
const CLAUDE_MODEL_ALIAS = /^(opus|sonnet|haiku|fable|mythos)$/i

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/** `Fable 5.1` for `claude-fable-5-1`; `gpt-5.6-sol` stays `gpt-5.6-sol`. */
export function formatAgentModelLabel(model: string | undefined): string {
  const raw = model?.trim() ?? ''
  if (!raw) {
    return ''
  }
  if (CLAUDE_MODEL_ALIAS.test(raw)) {
    return capitalize(raw)
  }
  const match = CLAUDE_MODEL_ID.exec(raw)
  if (!match?.[1]) {
    return raw
  }
  // Why split rather than positional: the family sat after the version once
  // (`3-5-sonnet`) and before it now (`sonnet-4-5`).
  const tokens = match[1].split('-')
  const family = tokens.find((token) => /^[a-z]+$/i.test(token))
  if (!family) {
    return raw
  }
  const version = tokens
    .filter((token) => /^\d+$/.test(token))
    .slice(0, 2)
    .join('.')
  return version ? `${capitalize(family)} ${version}` : capitalize(family)
}
