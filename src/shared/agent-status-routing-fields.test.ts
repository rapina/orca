import { describe, expect, it } from 'vitest'
import { agentStatusRoutingFields } from './agent-status-routing-fields'

describe('agentStatusRoutingFields', () => {
  it('carries what routing needs, and marks the prompt report', () => {
    expect(
      agentStatusRoutingFields({
        processHost: 'background-job',
        cwd: 'D:\\Workspace\\cozy-sandbox',
        hookEventName: 'UserPromptSubmit'
      })
    ).toEqual({
      processHost: 'background-job',
      cwd: 'D:\\Workspace\\cozy-sandbox',
      promptSubmitted: true
    })
  })

  it('marks nothing on any other event', () => {
    expect(
      agentStatusRoutingFields({ processHost: 'terminal', hookEventName: 'PreToolUse' })
    ).toEqual({ processHost: 'terminal' })
  })

  it('leaves out what the hook did not say', () => {
    expect(agentStatusRoutingFields({})).toEqual({})
  })
})
