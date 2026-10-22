import { Eye, EyeOff, Siren } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert, Badge, Button, DescriptionList } from '@/shared/ui';

/** Top of an urgent disease's page: call the vet now — never self-treat first. */
export function EmergencyAlert() {
  return (
    <div role="alert" className="flex gap-3 rounded-[12px] border-2 border-danger bg-danger-light px-4 py-3.5">
      <Siren aria-hidden className="mt-0.5 size-6 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-base font-bold text-danger">Shoshilinch: darhol veterinar chaqiring</p>
        <p className="mt-1 text-sm text-ink">
          Bu holat hayot uchun xavfli bo‘lishi mumkin. O‘zingiz davolashga urinib vaqt yo‘qotmang — veterinarga hoziroq qo‘ng‘iroq
          qiling. Quyidagi matn faqat ma’lumot uchun.
        </p>
      </div>
    </div>
  );
}

/** Next to a treatment line that injects into a vein. */
export function VetOnlyBadge() {
  return <Badge tone="danger">Faqat veterinar yuboradi</Badge>;
}

/**
 * Who wrote and approved the scheme — exactly what the API knows. Today it
 * only knows the source text; author, approving vet, date and version are
 * not given and are shown as such, never filled in.
 */
export function SchemeProvenance({ approved }: { approved: boolean }) {
  return (
    <section aria-label="Manba va tasdiq" className="rounded-[12px] border border-line p-3.5">
      <h3 className="mb-2.5 font-semibold text-ink">Manba va tasdiq</h3>
      <DescriptionList
        items={[
          { label: 'Manba', value: 'Ilova qilingan manba matni (kasalliklar ma’lumotnomasi)' },
          {
            label: 'Holati',
            value: approved ? <Badge tone="success">Tasdiqlangan</Badge> : <Badge tone="warning">Tasdiqlanmagan</Badge>,
          },
          { label: 'Tuzuvchi', value: 'Ko‘rsatilmagan' },
          { label: 'Tasdiqlagan veterinar', value: approved ? 'Ko‘rsatilmagan' : 'Yo‘q' },
          { label: 'Tasdiq sanasi', value: '—' },
          { label: 'Versiya', value: '—' },
        ]}
      />
    </section>
  );
}

/**
 * Doses no veterinarian approved stay folded until the farmer asks for them,
 * under a warning that says so (and that injections into a vein are for the
 * vet alone).
 */
export function UnapprovedScheme({
  intravenous,
  label = 'Sxemani ko‘rsatish (tasdiqlanmagan)',
  children,
}: {
  intravenous: boolean;
  label?: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <section aria-label="Davolash sxemasi" className="flex flex-col gap-3">
      <Alert tone="warning" title="Bu sxema veterinar tomonidan tasdiqlanmagan">
        <p>
          Dori nomlari va dozalar manba matnidan olingan — ularni hech qaysi veterinar tekshirmagan. Dozani o‘zingiz qo‘llamang:
          sxemani faqat veterinar bilan maslahatlashish uchun oching.
        </p>
        {intravenous ? (
          <p className="mt-1 font-medium text-danger">
            Sxemada vena ichiga yuboriladigan dori bor — uni faqat veterinar yuboradi.
          </p>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          className="mt-2.5"
          aria-expanded={shown}
          icon={shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          onClick={() => setShown((value) => !value)}
        >
          {shown ? 'Sxemani yashirish' : label}
        </Button>
      </Alert>
      {shown ? children : null}
    </section>
  );
}
