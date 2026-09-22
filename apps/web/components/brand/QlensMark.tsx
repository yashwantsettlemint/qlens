export function QlensMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="#2A55D1" />
      <circle cx="15.3" cy="14.8" r="7.3" stroke="#EAEEFA" strokeWidth="2.3" />
      <path d="M20.1 19.7 L24.7 24.3" stroke="#EAEEFA" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="15.3" cy="14.8" r="2.6" fill="#B7C7F5" />
    </svg>
  );
}
