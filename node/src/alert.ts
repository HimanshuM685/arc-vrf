// Operator alerts to a Discord or Slack incoming webhook (ALERT_WEBHOOK_URL). No-op when unset.
// Each alert kind is rate-limited so a long outage produces one message, not thousands.
import { log } from './chain.ts'

const COOLDOWN_MS = 30 * 60_000
const lastSent = new Map<string, number>()

/** Returns true when the webhook accepted the message. A failed delivery doesn't start the
 * cooldown, so the next trigger tries again. */
export async function alert(kind: string, message: string, now = Date.now()): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return false
  const last = lastSent.get(kind)
  if (last !== undefined && now - last < COOLDOWN_MS) return false
  // Drop kinds whose cooldown has passed, so per-request kinds can't grow the map forever.
  for (const [k, t] of lastSent) if (now - t >= COOLDOWN_MS) lastSent.delete(k)
  lastSent.set(kind, now)
  const text = `[Arc VRF node] ${message}`
  try {
    // Discord reads `content`, Slack reads `text`; each ignores the other.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text, text }),
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) return true
    log(`alert webhook returned HTTP ${res.status}`)
  } catch (e) {
    log(`alert webhook failed: ${(e as Error).message}`) // never let alerting break the node
  }
  lastSent.delete(kind)
  return false
}

/** Allows the next alert of this kind immediately (used when a problem clears). */
export function resetAlert(kind: string) {
  lastSent.delete(kind)
}
