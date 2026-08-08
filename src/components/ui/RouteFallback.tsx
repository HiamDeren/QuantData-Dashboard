export default function RouteFallback({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="bg-plane flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Spinner />
        <span className="text-ink-2 text-sm">{label}</span>
      </div>
    </div>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  )
}
