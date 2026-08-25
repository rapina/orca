import { win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getWindowsManagedLifecycleHook } from './hook-settings'

const SCRIPT_PATH = win32.join('C:\\Users\\alice', '.orca', 'agent-hooks', 'claude-hook.cmd')

describe('windows managed lifecycle hook', () => {
  // Why: this hook was installed as `conhost.exe --headless cmd /d /c script`.
  // conhost hands the script a brand-new console, so Claude's payload on stdin
  // never reached it: every hook posted nothing and no pane ever showed a turn.
  it('runs cmd.exe directly instead of hosting the script under conhost', () => {
    const hook = getWindowsManagedLifecycleHook(SCRIPT_PATH)

    expect(hook.command.toLowerCase()).toContain('cmd.exe')
    expect(hook.command.toLowerCase()).not.toContain('conhost')
    expect(hook.args).toEqual([
      '/d',
      '/c',
      win32.join('%USERPROFILE%', '.orca', 'agent-hooks', 'claude-hook.cmd')
    ])
    expect(hook.args?.join(' ')).not.toContain('--headless')
  })
})
