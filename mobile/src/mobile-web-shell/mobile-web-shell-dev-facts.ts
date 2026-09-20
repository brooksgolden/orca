/** Enough of the build id to tell two generations apart, and never enough to be one. */
const BUILD_ID_PREFIX_LENGTH = 12

export type MobileWebShellDevFacts = {
  buildId: string
  totalBytes: number
  elapsedMs: number
  /** Screencast frames this session's bridge host could not carry, running total. */
  droppedBinaryFrames: number
}

/**
 * The line the shell paints over a development build, and the only place a dropped screencast frame
 * is visible on a device.
 *
 * The drop rule keeps a stream alive by shedding a frame the envelope will not carry, and the
 * diagnostic beside it prints once per host — so without this number a browser pane shedding a
 * frame a second and one that shed a single frame look identical from the outside. The suffix is
 * absent at zero rather than reading `0 dropped`, because a count that is always on screen is one
 * nobody notices changing.
 *
 * Never the generation directory, never the whole build id, never the host id: this renders on a
 * device someone may be screen-sharing, and none of those tell them anything a prefix does not.
 */
export function formatMobileWebShellDevFacts(facts: MobileWebShellDevFacts): string {
  const line = `${facts.buildId.slice(0, BUILD_ID_PREFIX_LENGTH)} · ${facts.totalBytes} B · ${facts.elapsedMs} ms`
  if (facts.droppedBinaryFrames === 0) {
    return line
  }
  const frames = facts.droppedBinaryFrames === 1 ? 'frame' : 'frames'
  return `${line} · ${facts.droppedBinaryFrames} ${frames} dropped`
}
