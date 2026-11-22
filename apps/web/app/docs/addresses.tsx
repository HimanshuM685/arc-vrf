'use client'
import { chains, deployments } from '@arc-vrf/sdk'
import type { Deployment } from '@arc-vrf/sdk'

export function Addresses() {
  const all = Object.entries(deployments as Record<string, Deployment>)
  if (!all.length) return <p>No deployments recorded yet.</p>
  return (
    <>
      {all.map(([id, d]) => (
        <div key={id}>
          <h3>{chains.find((c) => String(c.id) === id)?.name ?? `Chain ${id}`}</h3>
          <table>
            <tbody>
              {(
                [
                  ['Coordinator', d.coordinator],
                  ['Wrapper', d.wrapper],
                  ['Key hash', d.keyHash],
                  ['BlockhashStore', d.blockhashStore],
                  ['Batch helper', d.batchCoordinator],
                  ['HiLoGame sample', d.hiLoGame],
                  ['DiceDirect sample', d.diceDirect],
                ] as const
              ).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td><code className="break-all">{v}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
