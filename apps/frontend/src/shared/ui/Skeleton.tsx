import { cn } from '@/shared/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-[8px] bg-neutral-light', className)} />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3 p-5">
      <span className="sr-only">Yuklanmoqda…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * The outline of the app (top bar, page title, cards, tab bar) shown while
 * the first page loads or the session is restored — instead of a blank
 * screen with a spinner, so nothing jumps when the real page appears.
 */
export function AppShellSkeleton({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div role="status" className="min-h-dvh bg-background">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="border-b border-line">
        <div className="mx-auto flex min-h-16 w-full max-w-[1240px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-7">
          <Skeleton className="size-10 rounded-[12px]" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex-1" />
          <Skeleton className="size-10 rounded-full" />
        </div>
      </div>
      <div aria-hidden className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pt-5 sm:px-6 sm:pt-6 lg:px-7">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-[12px]" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-[12px]" />
      </div>
      <div aria-hidden className="fixed inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom))] flex justify-center px-4">
        <Skeleton className="h-16 w-full max-w-[420px] rounded-full" />
      </div>
    </div>
  );
}
