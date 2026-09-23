import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@stablyai/playwright-test'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { createElectronHomeIsolation } from './helpers/electron-home-isolation'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'

async function clickPrintedFileLink(page: Page, printedPath: string): Promise<void> {
  const pointForPrintedPath = () =>
    page.evaluate((needle) => {
      const rows = [...document.querySelectorAll<HTMLElement>('.xterm-rows > div')]
        .filter((row) => row.getBoundingClientRect().width > 0)
        .toReversed()
      const row = rows.find((candidate) => candidate.textContent?.includes(needle))
      if (!row) {
        return null
      }
      const midpoint = (row.textContent?.indexOf(needle) ?? -1) + Math.floor(needle.length / 2)
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      let offset = 0
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0
        if (midpoint < offset + length) {
          const range = document.createRange()
          range.setStart(node, midpoint - offset)
          range.setEnd(node, midpoint - offset + 1)
          const bounds = range.getBoundingClientRect()
          return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        }
        offset += length
      }
      return null
    }, printedPath)

  await expect.poll(pointForPrintedPath, { timeout: 15_000 }).not.toBeNull()
  const point = await pointForPrintedPath()
  if (!point) {
    throw new Error(`Terminal did not render ${printedPath}`)
  }
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(250)
  await page.mouse.click(point.x, point.y)
  const popover = page.locator('[data-terminal-link-action-popover]')
  await expect(popover).toBeVisible()
  await expect(popover.locator('[data-terminal-link-destination]')).toContainText('linked.md')
  await popover.getByRole('button', { name: /Open file/i }).click()
}

test('packaged file links and folder workspace splits retain their workspace', async (// oxlint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture argument.
{}, testInfo) => {
  const executablePath = process.env.ORCA_SMOKE_EXECUTABLE
  test.skip(!executablePath, 'Set ORCA_SMOKE_EXECUTABLE to the packaged Orca executable')
  test.setTimeout(240_000)
  const userDataDir = testInfo.outputPath('profile')
  const folders = ['a', 'b'].map((name) => path.join(userDataDir, name))
  folders.forEach((folder) => mkdirSync(folder, { recursive: true }))
  writeFileSync(path.join(folders[0], 'linked.md'), '# File link smoke\n')
  writeFileSync(
    path.join(userDataDir, 'orca-data.json'),
    JSON.stringify(getE2ECompletedOnboardingProfile())
  )
  const { ELECTRON_RUN_AS_NODE: _unused, ...inheritedEnv } = process.env
  void _unused
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  const app = await electron.launch({
    executablePath,
    args: [],
    env: { ...isolation.env, ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_HEADLESS: '1' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.api))
    expect(await page.evaluate(() => Boolean(window.__store))).toBe(false)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const ids = await page.evaluate(async (folderPaths) => {
      const group = await window.api.projectGroups.create({
        name: 'File link smoke',
        parentPath: folderPaths[0]
      })
      const ids: string[] = []
      for (const [index, folderPath] of folderPaths.entries()) {
        const folder = await window.api.folderWorkspaces.create({
          projectGroupId: group.id,
          folderPath,
          name: `Link project ${index + 1}`
        })
        ids.push(folder.id)
      }
      return ids
    }, folders)
    await page.reload()
    await page.waitForFunction(() => Boolean(window.api))
    const row = (id: string) => page.locator(`[role="option"][data-worktree-id="folder:${id}"]`)

    await row(ids[0]).locator('[data-worktree-card-surface]').click()
    await expect(row(ids[0])).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm:visible .xterm-helper-textarea')).toBeFocused()
    await page.keyboard.type('echo ./linked.md')
    await page.keyboard.press('Enter')
    await clickPrintedFileLink(page, './linked.md')
    await expect(page.locator('.editor-header-path').first()).toContainText('linked.md')
    await expect(row(ids[0])).toHaveAttribute('aria-current', 'page')

    await row(ids[1]).locator('[data-worktree-card-surface]').click()
    await expect(row(ids[1])).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('Enter')
    await expect(page.locator('.xterm:visible .xterm-helper-textarea')).toBeFocused()
    await page.keyboard.type('echo ../a/linked.md')
    await page.keyboard.press('Enter')
    await clickPrintedFileLink(page, '../a/linked.md')
    await expect(page.locator('.editor-header-path').first()).toContainText('linked.md')
    await expect(row(ids[1])).toHaveAttribute('aria-current', 'page')
    await page.screenshot({ path: testInfo.outputPath('file-in-current-workspace.png') })

    const surface = (id: string) => page.locator(`[data-workspace-surface-id="folder:${id}"]`)
    await row(ids[0]).locator('[data-worktree-card-surface]').click()
    const bounds = await surface(ids[0]).boundingBox()
    expect(bounds).not.toBeNull()
    await row(ids[1])
      .locator('[data-workspace-pane-drag-handle]')
      .dragTo(surface(ids[0]), { targetPosition: { x: 8, y: Math.floor(bounds!.height / 2) } })
    await expect(page.locator('[data-workspace-split="true"]')).toBeVisible()
    await expect(surface(ids[0]).locator('[data-tab-group-body-id]')).toBeVisible()
    await expect(surface(ids[1]).locator('[data-tab-group-body-id]')).toBeVisible()
    await row(ids[1]).locator('[data-worktree-card-surface]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unsplit workspace' }).click()
    await expect(page.locator('[data-workspace-split="true"]')).toHaveCount(0)
    await expect(row(ids[0])).toHaveAttribute('aria-current', 'page')

    await row(ids[1])
      .locator('[data-workspace-pane-drag-handle]')
      .dragTo(surface(ids[0]), { targetPosition: { x: 8, y: Math.floor(bounds!.height / 2) } })
    await page.reload()
    await page.waitForFunction(() => Boolean(window.api))
    await row(ids[0]).locator('[data-worktree-card-surface]').click()
    await expect(page.locator('[data-workspace-split="true"]')).toBeVisible()
    await expect(surface(ids[0])).toBeVisible()
    await expect(surface(ids[1])).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('folder-workspace-split.png') })
    expect(errors).toEqual([])
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  } finally {
    await closeElectronAppForE2E(app)
    await cleanupE2EDaemons(userDataDir)
  }
})
