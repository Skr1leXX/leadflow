/** LeadFlow mark: three inputs merging into one stream, the idea of the product. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="LeadFlow">
      <defs>
        <linearGradient id="lf-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.55 0.2 262)" />
          <stop offset="1" stopColor="oklch(0.5 0.24 292)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lf-mark)" />
      <path
        d="M8 9.5h5.5c2.5 0 3.5 1.2 4.5 3.2M8 22.5h5.5c2.5 0 3.5-1.2 4.5-3.2M8 16h10M18 16h6m-2.5-2.5L24 16l-2.5 2.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
