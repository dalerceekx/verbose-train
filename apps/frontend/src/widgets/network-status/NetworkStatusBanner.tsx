import { CloudOff, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatSavedTime } from '@/shared/lib/format';
import { useNetworkStore } from '@/shared/network/network-status';

const RESTORED_VISIBLE_MS = 6_000;

function lastUpdate(lastResponseAt: number | null): string {
  return lastResponseAt === null
    ? 'Ma’lumotlar bu safar hali yangilanmadi.'
    : `Ma’lumotlar oxirgi marta ${formatSavedTime(lastResponseAt)} da yangilangan.`;
}

/**
 * Below the header on every page: no internet, or no answer from the
 * server, and when the data on screen was last refreshed — so a page never
 * looks frozen and old numbers are never mistaken for current ones. A short
 * note follows when the connection is back. `children`: e.g. the queue of
 * unsent records.
 */
export function NetworkStatusBanner({ children }: { children?: ReactNode }) {
  const online = useNetworkStore((state) => state.online);
  const unreachable = useNetworkStore((state) => state.unreachable);
  const lastResponseAt = useNetworkStore((state) => state.lastResponseAt);
  const restoredAt = useNetworkStore((state) => state.restoredAt);
  // The "restored" note of this moment has been shown long enough.
  const [shownUntilGone, setShownUntilGone] = useState<number | null>(null);

  useEffect(() => {
    if (restoredAt === null) return undefined;
    const timer = window.setTimeout(() => setShownUntilGone(restoredAt), RESTORED_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [restoredAt]);

  const restored = restoredAt !== null && shownUntilGone !== restoredAt;

  let content: ReactNode = null;
  if (!online) {
    content = (
      <>
        <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Internet yo‘q</p>
          <p className="text-ink-secondary">
            {lastUpdate(lastResponseAt)} Ko‘rish mumkin; yangi yozuvlar saytga yuborilmaydi — formalardagi kiritganlaringiz shu
            qurilmada qoralama sifatida saqlanadi.
          </p>
          {children}
        </div>
      </>
    );
  } else if (unreachable) {
    content = (
      <>
        <CloudOff aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Aloqa uzildi</p>
          <p className="text-ink-secondary">
            So‘rovlarga javob kelmayapti. {lastUpdate(lastResponseAt)} Saqlash tugmasini bosgan bo‘lsangiz, yozuv saqlangan
            bo‘lishi mumkin — tarixni tekshiring.
          </p>
          {children}
        </div>
      </>
    );
  } else if (restored || children) {
    content = (
      <>
        <Wifi aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          {restored ? <p className="font-semibold text-ink">Internet tiklandi — ma’lumotlar yangilanmoqda</p> : null}
          {children}
        </div>
      </>
    );
  }

  return (
    <div
      role="status"
      aria-label="Internet holati"
      className={cn(
        'sticky top-16 z-10 border-b text-sm',
        content === null && 'sr-only',
        !online
          ? 'border-danger/30 bg-danger-light'
          : unreachable
            ? 'border-warning/30 bg-warning-light'
            : 'border-success/30 bg-success-light',
      )}
    >
      {content === null ? null : (
        <div className="mx-auto flex w-full max-w-[1240px] items-start gap-3 px-4 py-2.5 sm:px-6 lg:px-7">{content}</div>
      )}
    </div>
  );
}
