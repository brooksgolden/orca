import { usePageBridgeClient } from '../transport/client-context.web'

/**
 * PLACEHOLDER. C6.1 owns the shell-side name and had not reported it when this landed, so this one
 * constant stands in for it and is the only line to change when it does. Until then no shipped
 * shell names it, the pane never asks for binary frames on the web, and it says so on screen
 * instead of waiting on frames that cannot come — which is the behaviour this seam exists for.
 */
const BROWSER_BINARY_SCREENCAST_GRANT = 'browser.screencast.binary'

/**
 * Web sibling: the page asks the shell it is running inside, through the grants `init` gave it.
 *
 * Grants rather than a new `init` field, because a shell built before the encoder must not be sent
 * `wantsBinary` and left holding a subscription no frame will ever arrive on. A shell that does not
 * name this one answers no, and the pane renders its stream-error state rather than a black
 * rectangle that never resolves.
 *
 * Read during render rather than per frame: the page entry waits for `init` before it mounts
 * anything, so the session is already there and its grants do not change for the life of the
 * document.
 */
export function useBrowserBinaryScreencastGrant(): boolean {
  const client = usePageBridgeClient()
  return client.getShellSession()?.grants.native.includes(BROWSER_BINARY_SCREENCAST_GRANT) === true
}
