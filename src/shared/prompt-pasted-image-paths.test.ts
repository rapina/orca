import { describe, expect, it } from 'vitest'
import { stripPastedImagePaths } from './prompt-pasted-image-paths'

describe('stripPastedImagePaths', () => {
  it("drops the job launcher's pasted image path in front of the words", () => {
    expect(
      stripPastedImagePaths(
        'C:\\Users\\PJH\\.claude\\jobs\\d8ade130\\pasted-1.png 지금 이렇게 shell이 뜬 상태에서도 아이콘이 가려'
      )
    ).toBe('지금 이렇게 shell이 뜬 상태에서도 아이콘이 가려')
  })

  it("drops Orca's terminal paste path wherever it sits, even under a folder with a space", () => {
    expect(
      stripPastedImagePaths(
        '이 아이콘은 뭐야? C:\\Users\\John Doe\\AppData\\Local\\Temp\\orca-paste-1787733860858-c0222a1e.png'
      )
    ).toBe('이 아이콘은 뭐야?')
  })

  it('drops any whitespace-free image path token and keeps the rest', () => {
    expect(stripPastedImagePaths('/tmp/shot.png /home/me/pic.jpeg 왜 이렇게 보여?')).toBe(
      '왜 이렇게 보여?'
    )
  })

  it('keeps words around a folder that is merely mentioned', () => {
    expect(stripPastedImagePaths('경로는 /tmp 이고 그림은 shot.png 야')).toBe(
      '경로는 /tmp 이고 그림은 shot.png 야'
    )
  })

  it('keeps a prompt that is nothing but the path', () => {
    expect(stripPastedImagePaths('C:\\Users\\me\\.claude\\jobs\\abc\\pasted-1.png')).toBe(
      'C:\\Users\\me\\.claude\\jobs\\abc\\pasted-1.png'
    )
  })

  it('leaves prompts without an image untouched', () => {
    expect(stripPastedImagePaths('fix the build on C:\\repo\\src\\main.ts')).toBe(
      'fix the build on C:\\repo\\src\\main.ts'
    )
  })
})
