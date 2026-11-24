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
        const menu = e.currentTarget.closest('details')
        menu?.removeAttribute('open')
        // The focused link is now hidden: hand focus back to the menu button so Tab starts from a visible spot.
        menu?.querySelector('summary')?.focus()
        props.onClick?.(e)
      }}
    />
  )
}
