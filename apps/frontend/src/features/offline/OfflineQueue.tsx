import { useQueryClient } from '@tanstack/react-query';
import { ListChecks, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { useSessionStore } from '@/features/auth/model/session.store';
import { formatSavedTime } from '@/shared/lib/format';
import { useNetworkStore } from '@/shared/network/network-status';
import { Badge, Button, Modal } from '@/shared/ui';
import { NetworkStatusBanner } from '@/widgets/network-status/NetworkStatusBanner';
import { flushQueue } from './flush';
import { useOfflineQueue, type QueuedOperation } from './queue';

const STATE_LABELS: Record<QueuedOperation['state'], { tone: 'warning' | 'danger' | 'neutral' | 'primary'; label: string }> = {
  pending: { tone: 'warning', label: 'Yuborilishi kutilmoqda' },
  sending: { tone: 'primary', label: 'Yuborilmoqda…' },
  failed: { tone: 'danger', label: 'Sayt qabul qilmadi' },
  'needs-review': { tone: 'neutral', label: 'Tekshirish kerak' },
};

/** The queue of records made without internet: each can be cancelled; held ones can be sent anyway. */
function QueueDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const ops = useOfflineQueue((state) => state.ops);
  const remove = useOfflineQueue((state) => state.remove);
  const online = useNetworkStore((state) => state.online);
  const authenticated = useSessionStore((state) => state.status === 'authenticated');

  return (
    <Modal
      open
      onClose={onClose}
      title="Yuborilmagan yozuvlar"
      description="Bular faqat shu qurilmada saqlangan — saytga hali yetib bormagan."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Yopish
          </Button>
          <Button
            icon={<Send aria-hidden className="size-4" />}
            disabled={!online || !authenticated || !ops.some((op) => op.state === 'pending')}
            onClick={() => void flushQueue(queryClient)}
          >
            Hozir yuborish
          </Button>
        </>
      }
    >
      {ops.length === 0 ? (
        <p className="py-6 text-center text-ink-secondary">Hamma yozuvlar yuborildi.</p>
      ) : (
        <ul aria-label="Navbatdagi yozuvlar" className="divide-y divide-line">
          {ops.map((op) => (
            <li key={op.id} className="flex flex-col gap-1.5 py-3">
              <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                {op.label}
                <Badge tone={STATE_LABELS[op.state].tone}>{STATE_LABELS[op.state].label}</Badge>
              </p>
              <p className="text-[13px] text-ink-secondary">Kiritilgan: {formatSavedTime(op.createdAt)}</p>
              {op.error ? <p className="text-[13px] text-danger">{op.error}</p> : null}
              <div className="flex flex-wrap gap-2">
                {op.state === 'failed' || op.state === 'needs-review' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!online || !authenticated}
                    icon={<Send aria-hidden className="size-4" />}
                    onClick={() => void flushQueue(queryClient, { force: [op.id] })}
                  >
                    Baribir yuborish
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={op.state === 'sending'}
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onClick={() => void remove(op.id)}
                >
                  Bekor qilish
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * The connection bar under the header, with the queue of unsent records
 * ("Yuborilishi kutilmoqda: 2") when there is one.
 */
export function ConnectionBanner() {
  const ops = useOfflineQueue((state) => state.ops);
  const [open, setOpen] = useState(false);
  const waiting = ops.filter((op) => op.state === 'pending' || op.state === 'sending').length;
  const held = ops.length - waiting;
  return (
    <>
      <NetworkStatusBanner>
        {ops.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className="text-ink">
              {waiting > 0 ? `Yuborilishi kutilmoqda: ${waiting} ta yozuv (hali saytga saqlanmagan)` : null}
              {waiting > 0 && held > 0 ? ' · ' : null}
              {held > 0 ? `${held} tasi sizning qaroringizni kutmoqda` : null}
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={<ListChecks aria-hidden className="size-4" />}
              onClick={() => setOpen(true)}
            >
              Ko‘rish
            </Button>
          </div>
        ) : null}
      </NetworkStatusBanner>
      {open ? <QueueDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Loads this account's queue and sends it whenever the session and the connection allow. */
export function OfflineQueueRunner() {
  const queryClient = useQueryClient();
  const status = useSessionStore((state) => state.status);
  const { data: user } = useCurrentUser();
  const online = useNetworkStore((state) => state.online);
  const load = useOfflineQueue((state) => state.load);
  const loadedFor = useOfflineQueue((state) => state.userId);
  const pending = useOfflineQueue((state) => state.ops.filter((op) => op.state === 'pending').length);
  const userId = status === 'anonymous' ? undefined : user?.id;

  useEffect(() => {
    if (userId) void load(userId);
  }, [userId, load]);

  useEffect(() => {
    if (status === 'authenticated' && online && pending > 0 && loadedFor === userId) void flushQueue(queryClient);
  }, [status, online, pending, loadedFor, userId, queryClient]);

  return null;
}
