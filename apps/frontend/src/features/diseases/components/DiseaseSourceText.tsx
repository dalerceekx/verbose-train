import { ArrowLeft, BookOpenText } from 'lucide-react';
import { Alert, AsyncContent, Badge, ButtonLink, Card, CardBody, CardHeader } from '@/shared/ui';
import { SAFETY_NOTICE, SOURCE_STATUS_LABEL } from '../lib/labels';
import { isIntravenous } from '../lib/safety';
import { useDiseaseSource } from '../model/diseases.queries';
import { UnapprovedScheme } from './DiseaseSafety';

/** "Asl matn": the whole source, line by line, exactly as supplied. */
export function DiseaseSourceText() {
  const source = useDiseaseSource();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink to="/diseases" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
          Kasalliklar ro‘yxati
        </ButtonLink>
      </div>
      <Alert tone="warning" title="Diqqat">
        {SAFETY_NOTICE}
      </Alert>
      <AsyncContent query={source}>
        {(data) => (
          <Card>
            <CardHeader
              title="Asl matn"
              description={`${data.diseaseCount} ta kasallik · ${data.groupCount} ta bo‘lim · o‘zgartirilmagan`}
              icon={<BookOpenText className="size-5" />}
            />
            <CardBody className="flex flex-col gap-4">
              <div>
                <Badge tone="warning">{SOURCE_STATUS_LABEL}</Badge>
              </div>
              {/* The whole text carries every scheme's doses: the same explicit step as on a disease page. */}
              <UnapprovedScheme intravenous={isIntravenous(data.fullText)} label="Butun matnni ko‘rsatish (tasdiqlanmagan)">
                <pre
                  aria-label="Manba matni"
                  className="font-sans text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink"
                >
                  {data.fullText}
                </pre>
              </UnapprovedScheme>
            </CardBody>
          </Card>
        )}
      </AsyncContent>
    </div>
  );
}
