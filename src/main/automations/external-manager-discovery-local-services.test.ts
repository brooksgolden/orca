import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFile: vi.fn(),
  runProcess: vi.fn(),
  readHermesServiceJobs: vi.fn(),
  isExternalAutomationCommandOnPath: vi.fn(async () => true)
}))

vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.runProcess }))
vi.mock('../../relay/hermes-service-catalog', () => ({
  readHermesServiceJobs: mocks.readHermesServiceJobs
}))
vi.mock('./external-manager-local-command', () => ({
  isExternalAutomationCommandOnPath: mocks.isExternalAutomationCommandOnPath
}))
vi.mock('./hermes-cron-output', () => ({
  readHermesCronOutputRunsPage: vi.fn()
}))
vi.mock('../ssh/ssh-target-registry', () => ({
  getActiveMultiplexer: vi.fn()
}))

import { listLocalManager } from './external-manager-discovery'

beforeEach(() => {
  mocks.existsSync.mockReturnValue(false)
  mocks.readFile.mockReset()
  mocks.runProcess.mockReset()
  mocks.readHermesServiceJobs.mockReset()
  mocks.isExternalAutomationCommandOnPath.mockResolvedValue(true)
})

it('includes locally registered Hermes services and Windows scheduled tasks', async () => {
  mocks.runProcess.mockResolvedValue({
    code: 0,
    signal: null,
    stdout: 'task state',
    stderr: '',
    timedOut: false
  })
  mocks.readHermesServiceJobs.mockImplementation(async (runCommand) => {
    const result = await runCommand('schtasks.exe', ['/Query'], {
      encoding: 'utf-8',
      timeout: 5000
    })
    expect(result).toMatchObject({ stdout: 'task state' })
    return [
      {
        id: 'task:hermes-workspace-mirror',
        name: 'Hermes workspace mirror',
        schedule_display: 'Every 15 minutes',
        enabled: true,
        state: 'scheduled',
        last_status: 'completed',
        manageable: false
      }
    ]
  })

  const manager = await listLocalManager('hermes')

  expect(mocks.runProcess).toHaveBeenCalledWith({
    program: 'schtasks.exe',
    args: ['/Query'],
    timeoutMs: 5000
  })
  expect(manager?.jobs).toEqual([
    expect.objectContaining({
      id: 'task:hermes-workspace-mirror',
      name: 'Hermes workspace mirror',
      schedule: 'Every 15 minutes',
      enabled: true,
      state: 'scheduled',
      lastStatus: 'completed',
      manageable: false
    })
  ])
})
