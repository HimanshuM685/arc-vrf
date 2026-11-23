// Server-safe building blocks (no 'use client'), usable from server and client components alike.

/** Thick rule ending in a small bordered square: the system's punctuation mark. */
export function Rule({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center ${className}`} aria-hidden="true">
      <span className="h-1 flex-1 bg-ink" />
      <span className="size-3 border-2 border-ink" />
    </div>
  )
}

export type Variant = 'primary' | 'quiet' | 'danger' | 'inverse'

/** Shared button look, also for links that act as buttons. */
export function buttonClass(variant: Variant = 'primary') {
  const styles = {
    primary: 'border-ink bg-ink text-paper not-disabled:hover:bg-paper not-disabled:hover:text-ink',
    quiet: 'border-ink bg-transparent text-ink not-disabled:hover:bg-ink not-disabled:hover:text-paper',
    danger: 'border-ink border-dashed bg-transparent text-ink not-disabled:hover:border-solid not-disabled:hover:bg-ink not-disabled:hover:text-paper',
    // For use on black bands.
    inverse: 'border-paper bg-paper text-ink hover:bg-ink hover:text-paper focus-visible:outline-paper',
  }[variant]
  return `label inline-flex min-h-11 items-center justify-center gap-2 border-2 px-6 py-3 text-center font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40 ${styles}`
}

