import { describe, expect, it } from 'vitest'
import { promptMatchesTypedText } from './agent-prompt-terminal-claim'

describe('promptMatchesTypedText', () => {
  it('matches the same words however the whitespace fell', () => {
    expect(
      promptMatchesTypedText(
        'quest_banner_input_test 테스트가 실패한다는데 확인해줘',
        'quest_banner_input_test  테스트가 실패한다는데 확인해줘 '
      )
    ).toBe(true)
  })

  it('ignores the pasted image path each side carries differently', () => {
    expect(
      promptMatchesTypedText(
        'C:\\Users\\me\\.claude\\jobs\\abcd\\pasted-1.png 이 아이콘은 뭐야?',
        'C:\\Users\\me\\AppData\\Local\\Temp\\orca-paste-1787733860858-c0222a1e.png 이 아이콘은 뭐야?'
      )
    ).toBe(true)
  })

  it('accepts one text inside the other once it is long enough', () => {
    expect(promptMatchesTypedText('fix the failing build', 'fix the failing build please')).toBe(
      true
    )
    expect(promptMatchesTypedText('please fix the failing build', 'fix the failing build')).toBe(
      true
    )
  })

  it('accepts a long shared opening', () => {
    expect(
      promptMatchesTypedText(
        'refactor the terminal list model so rows sort by question first',
        'refactor the terminal list model so rows sort by question first, then unread'
      )
    ).toBe(true)
  })

  it('rejects different words, short texts and nothing', () => {
    expect(promptMatchesTypedText('fix the build', 'run the tests')).toBe(false)
    expect(promptMatchesTypedText('y', 'y')).toBe(false)
    expect(promptMatchesTypedText('fix the build', '')).toBe(false)
    expect(promptMatchesTypedText(undefined, 'fix the build')).toBe(false)
  })
})
