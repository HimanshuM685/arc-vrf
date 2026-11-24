'use client'
import Link from 'next/link'
import type { ComponentProps } from 'react'

/** A Link that closes the <details> menu it sits in. Same-page hash links (/#pricing) don't remount the
 * header, so without this the open menu would cover the section the user just jumped to. */
export function MenuLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        e.currentTarget.closest('details')?.removeAttribute('open')
        props.onClick?.(e)
      }}
    />
  )
}
