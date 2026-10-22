import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Badge } from './Badge';
import { Skeleton } from './Skeleton';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  secondary?: ReactNode;
  loading?: boolean;
  /** Metric not provided by the backend: shows "—" and a label, never 0. */
  unavailable?: boolean;
  /** Metric failed to load. */
  failed?: boolean;
  to?: string;
  /** Small horizontal card (icon beside the numbers) — two fit side by side on a phone. */
  compact?: boolean;
}

export function StatCard({ icon, label, value, secondary, loading, unavailable, failed, to, compact = false }: StatCardProps) {
  const shown = loading ? <Skeleton className={compact ? 'h-6 w-16' : 'h-8 w-24'} /> : unavailable || failed ? '—' : value;
  // The full card says "Tez orada" with its badge; the compact one (no badge) in the note.
  const note = unavailable ? (compact ? 'Tez orada' : null) : failed ? 'Ma’lumot yuklanmadi' : loading ? null : secondary;

  const body = compact ? (
    <div className="flex items-center gap-2.5">
      {/* The icon gives its room to the numbers on a phone (two cards per row). */}
      <span
        aria-hidden
        className="hidden size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-ink sm:inline-flex [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-tight font-medium text-ink-secondary">{label}</p>
        <div className="mt-0.5 text-[16px] leading-tight font-semibold break-words text-ink tabular">{shown}</div>
        {note ? <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">{note}</p> : null}
      </div>
    </div>
  ) : (
    <>
      {/* Smaller on a phone, where two cards share a row. */}
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-[10px] bg-primary-light text-ink sm:size-11 sm:rounded-[12px] [&_svg]:size-[18px] sm:[&_svg]:size-5"
        >
          {icon}
        </span>
        {unavailable ? <Badge tone="warning">Tez orada</Badge> : null}
      </div>
      <p className="mt-2.5 text-[13px] leading-tight font-medium text-ink-secondary sm:mt-4 sm:text-sm">{label}</p>
      <div className="mt-1 text-[22px] leading-tight font-semibold break-words text-ink tabular sm:text-[28px]">{shown}</div>
      <div className="mt-1 text-[12px] leading-snug text-ink-secondary sm:min-h-5 sm:text-[13px]">{note}</div>
    </>
  );

  const className = cn(
    'block min-w-0 rounded-[14px] border border-line bg-card shadow-card',
    compact ? 'px-3 py-2.5' : 'p-3.5 sm:p-5',
    to && 'transition-colors hover:border-primary-hover',
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
