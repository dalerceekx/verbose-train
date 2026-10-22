import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '@/shared/api/errors';
import type { Paginated } from '@/shared/types/api';
import { guestSignInRequired } from './guest-mode';
import { createSampleFarm, type SampleFarm } from './sample-farm';

type Params = Record<string, unknown>;
type Handler = (match: RegExpExecArray, params: Params) => unknown;

export interface SampleBackend {
  handle(config: InternalAxiosRequestConfig): Promise<AxiosResponse>;
}

function param(params: Params, key: string): string | undefined {
  const value = params[key];
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function paginate<T>(rows: T[], params: Params): Paginated<T> {
  const page = Math.max(1, Number(param(params, 'page') ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(param(params, 'limit') ?? 20) || 20));
  return { items: rows.slice((page - 1) * limit, page * limit), page, limit, total: rows.length };
}

/** `sort` like the API: a field name, `-` prefix for descending. */
function sorted<T>(
  rows: T[],
  sort: string | undefined,
  fields: Record<string, (row: T) => string | number | null>,
  fallback: string,
): T[] {
  const value = sort && fields[sort.replace(/^-/, '')] ? sort : fallback;
  const direction = value.startsWith('-') ? -1 : 1;
  const get = fields[value.replace(/^-/, '')] ?? (() => null);
  return [...rows].sort((a, b) => {
    const left = get(a) ?? '';
    const right = get(b) ?? '';
    return left < right ? -direction : left > right ? direction : 0;
  });
}

function notFound(): ApiError {
  return new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Topilmadi' });
}

function byId<T extends { id: string }>(rows: T[], id: string | undefined): T {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw notFound();
  return row;
}

/**
 * Answers the farmer app's reads from the sample farm, in the backend's
 * response shapes (filters, sorting, pagination). Anything else needs an
 * account: the guest is asked to sign in.
 */
export function createSampleBackend(sample: SampleFarm = createSampleFarm()): SampleBackend {
  const ownFarm = (params: Params) => {
    const farmId = param(params, 'farmId');
    return !farmId || farmId === sample.farm.id;
  };
  const visible = (archivedAt: string | null, params: Params) => param(params, 'includeArchived') === 'true' || !archivedAt;

  // Static segments before `/:id`.
  const routes: Array<[RegExp, Handler]> = [
    [/^\/auth\/me$/, () => sample.user],
    [
      /^\/farms$/,
      (_, params) =>
        paginate(
          sorted([sample.farm], param(params, 'sort'), { createdAt: (f) => f.createdAt, name: (f) => f.name }, '-createdAt'),
          params,
        ),
    ],
    [
      /^\/animals$/,
      (_, params) => {
        const species = param(params, 'species');
        const rows = sample.animals.filter(
          (animal) => ownFarm(params) && (!species || animal.species === species) && visible(animal.archivedAt, params),
        );
        return paginate(
          sorted(
            rows,
            param(params, 'sort'),
            { createdAt: (a) => a.createdAt, tagNumber: (a) => a.tagNumber, name: (a) => a.name },
            '-createdAt',
          ),
          params,
        );
      },
    ],
    [/^\/animals\/([^/]+)$/, ([, id]) => ({ ...byId(sample.animals, id), activeWithdrawal: null })],
    [
      /^\/inventory\/items$/,
      (_, params) => {
        const category = param(params, 'category');
        const rows = sample.items.filter(
          (item) => ownFarm(params) && (!category || item.category === category) && visible(item.archivedAt, params),
        );
        return paginate(
          sorted(
            rows,
            param(params, 'sort'),
            { createdAt: (i) => i.createdAt, name: (i) => i.name, expiresOn: (i) => i.expiresOn },
            '-createdAt',
          ),
          params,
        );
      },
    ],
    [
      /^\/inventory\/items\/([^/]+)\/movements$/,
      ([, id], params) => {
        const item = byId(sample.items, id);
        const rows = sample.movements.filter((movement) => movement.itemId === item.id);
        return paginate(sorted(rows, param(params, 'sort'), { createdAt: (m) => m.createdAt }, '-createdAt'), params);
      },
    ],
    [/^\/inventory\/items\/([^/]+)$/, ([, id]) => byId(sample.items, id)],
    [/^\/rations\/profiles$/, () => sample.profiles],
    [/^\/rations\/animal-types$/, (_, params) => (ownFarm(params) ? sample.animalTypes : [])],
    [
      /^\/rations$/,
      (_, params) => {
        const typeId = param(params, 'animalTypeId');
        const rows = sample.rations.filter(
          (ration) => ownFarm(params) && (!typeId || ration.animalTypeId === typeId) && visible(ration.archivedAt, params),
        );
        return paginate(
          sorted(
            rows,
            param(params, 'sort'),
            { createdAt: (r) => r.createdAt, updatedAt: (r) => r.updatedAt, name: (r) => r.name },
            '-updatedAt',
          ),
          params,
        );
      },
    ],
    [
      /^\/rations\/([^/]+)\/issues$/,
      ([, id], params) => {
        const ration = byId(sample.rations, id);
        const rows = sample.rationIssues.filter((issue) => issue.rationId === ration.id);
        return paginate(sorted(rows, undefined, { createdAt: (i) => i.createdAt }, '-createdAt'), params);
      },
    ],
    [/^\/rations\/([^/]+)$/, ([, id]) => byId(sample.rations, id)],
    // A farmer sees approved catalog entries only.
    [/^\/vet\/medicines$/, (_, params) => paginate(sample.medicines, params)],
    [/^\/vet\/medicines\/([^/]+)$/, ([, id]) => byId(sample.medicines, id)],
  ];

  return {
    async handle(config) {
      const path = (config.url ?? '').split('?')[0] ?? '';
      const params = (config.params ?? {}) as Params;
      for (const [pattern, handler] of routes) {
        const match = pattern.exec(path);
        if (!match) continue;
        // Serialized like a network hop: callers never share the sample objects.
        const data = JSON.parse(JSON.stringify(handler(match, params))) as unknown;
        return { data, status: 200, statusText: 'OK', headers: {}, config };
      }
      throw guestSignInRequired();
    },
  };
}
