export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
        <path
          d="M8 21.5 13 14l4.5 5L24 9.5"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="9.5" r="2.4" fill="#fff" />
      </svg>
      <span className="text-[15px] font-bold tracking-tight">
        Quant<span className="text-brand">AM</span>
      </span>
    </span>
  )
}
