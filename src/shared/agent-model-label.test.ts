import { describe, expect, it } from 'vitest'
import { formatAgentModelLabel } from './agent-model-label'

describe('formatAgentModelLabel', () => {
  it('names a Claude id the way a person says it', () => {
    expect(formatAgentModelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(formatAgentModelLabel('claude-opus-5')).toBe('Opus 5')
    expect(formatAgentModelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
    expect(formatAgentModelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  it('reads the older order, where the version came before the family', () => {
    expect(formatAgentModelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(formatAgentModelLabel('claude-3-opus-20240229')).toBe('Opus 3')
  })

  it('drops a cloud vendor prefix and a context-window suffix', () => {
    expect(formatAgentModelLabel('anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
    expect(formatAgentModelLabel('us.anthropic.claude-opus-4-1-20250805-v1:0')).toBe('Opus 4.1')
    expect(formatAgentModelLabel('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  })

  it('capitalizes a bare alias', () => {
    expect(formatAgentModelLabel('opus')).toBe('Opus')
  })

  it('leaves what it does not recognise as it came', () => {
    expect(formatAgentModelLabel('gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(formatAgentModelLabel('claude-2')).toBe('claude-2')
    expect(formatAgentModelLabel('  o3  ')).toBe('o3')
  })

  it('is empty for nothing', () => {
    expect(formatAgentModelLabel(undefined)).toBe('')
    expect(formatAgentModelLabel('   ')).toBe('')
  })
})
