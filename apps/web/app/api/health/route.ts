// Liveness for load balancers and uptime monitors. The VRF node has its own health
// endpoint inside the vrf-node container (HEALTH_PORT).
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ web: 'ok' })
}
