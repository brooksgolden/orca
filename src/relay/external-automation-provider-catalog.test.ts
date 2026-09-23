import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('ExternalAutomationProviderCatalog', () => {
  let hermesHome: string
  let previousHermesHome: string | undefined

  beforeEach(async () => {
    previousHermesHome = process.env.HERMES_HOME
    hermesHome = await mkdtemp(join(tmpdir(), 'relay-hermes-catalog-'))
    process.env.HERMES_HOME = hermesHome
    await mkdir(join(hermesHome, 'cron'), { recursive: true })
    vi.resetModules()
  })

  afterEach(async () => {
    if (previousHermesHome === undefined) {
      delete process.env.HERMES_HOME
    } else {
      process.env.HERMES_HOME = previousHermesHome
    }
    await rm(hermesHome, { recursive: true, force: true })
    vi.resetModules()
  })

  it('returns readable jobs when the remote CLI is unavailable', async () => {
    await writeFile(
      join(hermesHome, 'cron', 'jobs.json'),
      JSON.stringify({ jobs: [{ id: 'job-1', name: 'Monitor' }] }),
      'utf-8'
    )
    const { ExternalAutomationProviderCatalog } =
      await import('./external-automation-provider-catalog')
    const catalog = new ExternalAutomationProviderCatalog(
      vi.fn().mockRejectedValue(new Error('not found')),
      vi.fn().mockResolvedValue({ total: 3, runs: [] })
    )

    await expect(catalog.listJobs({ provider: 'hermes' })).resolves.toEqual({
      jobs: [{ id: 'job-1', name: 'Monitor', run_count: 3, runs: [] }],
      hermesAvailable: false,
      openclawAvailable: false,
      error: null
    })
  })

  it('discovers continuously running Hermes systemd services', async () => {
    await writeFile(
      join(hermesHome, 'services.json'),
      JSON.stringify({
        services: [
          {
            id: 'tradepilot-hermes-bot',
            name: 'TradePilot Hermes bot',
            units: ['tradepilot-meta-webhook.service', 'tradepilot-meta-draft-worker.service'],
            workdir: '/home/hermes/.hermes/skills/tradepilot-dm-setter'
          }
        ]
      }),
      'utf-8'
    )
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'systemctl') {
        return {
          stdout: [
            `Id=${args[1]}`,
            'LoadState=loaded',
            'ActiveState=active',
            'SubState=running',
            'ActiveEnterTimestamp=2026-09-21T12:00:00Z'
          ].join('\n')
        }
      }
      return undefined
    })
    const { ExternalAutomationProviderCatalog } =
      await import('./external-automation-provider-catalog')
    const catalog = new ExternalAutomationProviderCatalog(runCommand, vi.fn())

    const result = await catalog.listJobs({ provider: 'hermes' })

    expect(result.jobs).toEqual([
      expect.objectContaining({
        id: 'service:tradepilot-hermes-bot',
        name: 'TradePilot Hermes bot',
        schedule_display: 'Always on',
        enabled: true,
        state: 'running',
        last_status: 'running',
        manageable: false,
        continuous: true
      })
    ])
    expect(runCommand).toHaveBeenCalledWith(
      'systemctl',
      expect.arrayContaining(['show', 'tradepilot-meta-webhook.service']),
      { encoding: 'utf-8', timeout: 5000 }
    )
  })

  it('discovers an existing Windows scheduled task without making it manageable', async () => {
    await writeFile(
      join(hermesHome, 'services.json'),
      JSON.stringify({
        scheduled_tasks: [
          {
            id: 'hermes-workspace-mirror',
            name: 'Hermes workspace mirror',
            task_name: 'HermesWorkspaceMirror',
            schedule: 'Every 15 minutes',
            workdir: 'C:\\Users\\brook\\dev\\claude'
          }
        ]
      }),
      'utf-8'
    )
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'schtasks.exe') {
        return {
          stdout:
            '"HOST","\\\\HermesWorkspaceMirror","9/22/2026 11:47:24 PM","Ready","Interactive only","9/22/2026 11:32:25 PM","0"'
        }
      }
      return undefined
    })
    const { ExternalAutomationProviderCatalog } =
      await import('./external-automation-provider-catalog')
    const catalog = new ExternalAutomationProviderCatalog(runCommand, vi.fn())

    const result = await catalog.listJobs({ provider: 'hermes' })

    expect(result.jobs).toEqual([
      expect.objectContaining({
        id: 'task:hermes-workspace-mirror',
        name: 'Hermes workspace mirror',
        schedule_display: 'Every 15 minutes',
        enabled: true,
        state: 'scheduled',
        last_status: 'completed',
        manageable: false,
        continuous: false,
        scheduled_task: 'HermesWorkspaceMirror'
      })
    ])
    expect(runCommand).toHaveBeenCalledWith(
      'schtasks.exe',
      ['/Query', '/TN', 'HermesWorkspaceMirror', '/FO', 'CSV', '/V', '/NH'],
      { encoding: 'utf-8', timeout: 5000 }
    )
  })

  it('projects jobs-file parse failures without hiding command availability', async () => {
    await writeFile(join(hermesHome, 'cron', 'jobs.json'), '{not-json', 'utf-8')
    const { ExternalAutomationProviderCatalog } =
      await import('./external-automation-provider-catalog')
    const catalog = new ExternalAutomationProviderCatalog(
      vi.fn().mockResolvedValue(undefined),
      vi.fn()
    )

    const result = await catalog.listJobs({ provider: 'hermes' })

    expect(result.jobs).toEqual([])
    expect(result.hermesAvailable).toBe(true)
    expect(result.openclawAvailable).toBe(false)
    expect(result.error).toMatch(/^SyntaxError:/)
  })

  it('preserves all-or-nothing Hermes count enrichment failures', async () => {
    await writeFile(
      join(hermesHome, 'cron', 'jobs.json'),
      JSON.stringify([{ id: 'job-1' }, { id: '--invalid' }]),
      'utf-8'
    )
    const { ExternalAutomationProviderCatalog } =
      await import('./external-automation-provider-catalog')
    const catalog = new ExternalAutomationProviderCatalog(
      vi.fn().mockResolvedValue(undefined),
      vi
        .fn()
        .mockResolvedValueOnce({ total: 1, runs: [] })
        .mockRejectedValueOnce(new Error('Invalid external automation job ID.'))
    )

    const result = await catalog.listJobs({ provider: 'hermes' })

    expect(result.jobs).toEqual([])
    expect(result.error).toBe('Error: Invalid external automation job ID.')
  })
})
