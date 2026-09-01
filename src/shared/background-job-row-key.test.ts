import { describe, expect, it } from 'vitest'
import { isBackgroundJobRowKey } from './background-job-row-key'
import { makePaneKey } from './stable-pane-id'

const SESSION = 'ec48af73-3b2d-4656-bd74-e95a63762fd2'
const LEAF = '22222222-2222-4222-8222-222222222222'

describe('isBackgroundJobRowKey', () => {
  it("is the row whose leaf is the job's session id", () => {
    expect(isBackgroundJobRowKey(makePaneKey('tab-1', SESSION), SESSION)).toBe(true)
  })

  it('is never a terminal, even one running that session', () => {
    expect(isBackgroundJobRowKey(makePaneKey('tab-1', LEAF), SESSION)).toBe(false)
    expect(isBackgroundJobRowKey(makePaneKey('tab-1', SESSION), undefined)).toBe(false)
    expect(isBackgroundJobRowKey('not-a-pane-key', SESSION)).toBe(false)
  })
})
