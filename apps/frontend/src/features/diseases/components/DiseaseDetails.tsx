import { ArrowLeft, BookOpenText, Stethoscope } from 'lucide-react';
import { useLocation } from 'react-router';
import { Alert, AsyncContent, Badge, ButtonLink, Card, CardBody, CardHeader } from '@/shared/ui';
import type { DiseaseDetails as Disease } from '../api/diseases.api';
import { ANIMAL_LABELS, SAFETY_NOTICE, SOURCE_STATUS_LABEL } from '../lib/labels';
import { isEmergency, isIntravenous, isSchemeApproved, splitDiseaseLines } from '../lib/safety';
import { useDisease } from '../model/diseases.queries';
import { EmergencyAlert, SchemeProvenance, UnapprovedScheme, VetOnlyBadge } from './DiseaseSafety';
import { TreatmentStock } from './TreatmentStock';

const SYMPTOMS_LABEL = /^Xalq tilida belgilari:\s*/;
/** "Dori nomi: …" — the part before the first colon is set in bold; the text stays the same. */
const LABELLED = /^([^:]{1,90}):\s(.+)$/;

/** Source lines in order; headings only make it easier to read. Injections into a vein are marked. */
function DiseaseLines({ lines }: { lines: Disease['lines'] }) {
  return (
    <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-ink">
      {lines.map((line, index) => {
        if (line.kind === 'symptoms') {
          return (
            <section key={index} className="rounded-[12px] bg-background p-3.5">
              <h3 className="font-semibold">Xalq tilida belgilari:</h3>
              <p className="mt-1">{line.text.replace(SYMPTOMS_LABEL, '')}</p>
            </section>
          );
        }
        if (line.kind === 'scheme') {
          return (
            <h3 key={index} className="mt-3 text-base font-semibold">
              {line.text}
            </h3>
          );
        }
        if (line.kind === 'subheading') {
          return (
            <p key={index} className="mt-1 font-semibold">
              {line.text}
            </p>
          );
        }
        const labelled = LABELLED.exec(line.text);
        return (
          <div key={index} className="border-l-2 border-primary/50 pl-3">
            <p>
              {labelled ? (
                <>
                  <strong>{labelled[1]}:</strong> {labelled[2]}
                </>
              ) : (
                line.text
              )}
            </p>
            {isIntravenous(line.text) ? (
              <p className="mt-1">
                <VetOnlyBadge />
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One disease: the warnings first (an urgent one at the very top), the
 * description, where the text comes from and that no vet approved it, and
 * the treatment scheme folded behind an explicit step — never a diagnosis
 * or a computed dose.
 */
export function DiseaseDetails({ number }: { number: number }) {
  const disease = useDisease(number);
  // Back to the list with the filters it was opened from.
  const back = (useLocation().state as { back?: string } | null)?.back ?? '/diseases';
  const urgent = isEmergency({ number });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink to={back} variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
          Kasalliklar ro‘yxati
        </ButtonLink>
      </div>
      {urgent ? <EmergencyAlert /> : null}
      <Alert tone="warning" title="Diqqat">
        {SAFETY_NOTICE}
      </Alert>
      <AsyncContent query={disease}>
        {(data) => {
          const approved = isSchemeApproved(data);
          const { description, scheme } = splitDiseaseLines(data.lines);
          const original = (
            <details className="rounded-[12px] border border-line p-3.5">
              <summary className="cursor-pointer font-semibold text-ink">Asl matn (o‘zgartirilmagan)</summary>
              <pre className="mt-3 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
                {data.fullText}
              </pre>
            </details>
          );
          return (
            <Card>
              <CardHeader
                title={data.lines[0]?.text ?? data.title}
                description={data.group.heading}
                icon={<Stethoscope className="size-5" />}
              />
              <CardBody className="flex flex-col gap-5">
                <div className="flex flex-wrap gap-1.5">
                  {urgent ? <Badge tone="danger">Shoshilinch</Badge> : null}
                  <Badge tone="warning">{SOURCE_STATUS_LABEL}</Badge>
                  {data.animals.map((animal) => (
                    <Badge key={animal} tone="neutral">
                      {ANIMAL_LABELS[animal]}
                    </Badge>
                  ))}
                </div>
                <DiseaseLines lines={description} />
                <SchemeProvenance approved={approved} />
                {scheme.length > 0 || !approved ? (
                  approved ? (
                    <>
                      <DiseaseLines lines={scheme} />
                      {original}
                    </>
                  ) : (
                    <UnapprovedScheme intravenous={scheme.some((line) => isIntravenous(line.text))}>
                      <DiseaseLines lines={scheme} />
                      {original}
                    </UnapprovedScheme>
                  )
                ) : null}
                <TreatmentStock lines={data.lines} />
                <section aria-label="Qisqartmalar" className="rounded-[12px] border border-line p-3.5 text-sm">
                  <h3 className="font-semibold text-ink">Qisqartmalar</h3>
                  <p className="mt-1 text-ink-secondary">{data.abbreviations}</p>
                </section>
                <div>
                  <ButtonLink
                    to="/diseases/source"
                    variant="secondary"
                    size="sm"
                    icon={<BookOpenText aria-hidden className="size-4" />}
                  >
                    Butun manba matni
                  </ButtonLink>
                </div>
              </CardBody>
            </Card>
          );
        }}
      </AsyncContent>
    </div>
  );
}
