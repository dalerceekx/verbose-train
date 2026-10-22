import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import type { Recommendation } from './api/treatments.api';

/** QA-14: a sick animal's treatment is recorded from a vet-approved protocol only. */

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

function cow() {
  const animal = api.server.db.animals.find((candidate) => candidate.tagNumber === 'UZ-001');
  if (!animal) throw new Error('no UZ-001 in the seed');
  return animal;
}

const approvedProtocol: Recommendation = {
  protocolId: 'protocol-1',
  protocolCode: 'MASTIT-1',
  species: 'CATTLE',
  versionId: '00000000-0000-4000-9200-000000000001',
  version: 2,
  title: 'Klinik mastit — test sxemasi',
  condition: 'Mastit',
  instructions: 'Veterinar nazoratida',
  approvedAt: '2026-10-01T00:00:00.000Z',
  drugs: [
    {
      medicineId: 'med-1',
      medicineName: 'Test antibiotik',
      activeIngredient: 'Modda',
      dosePerKg: '0.1',
      doseUnit: 'ML',
      maxSingleDose: null,
      route: 'IM',
      frequencyPerDay: 1,
      durationDays: 3,
      withdrawalMeatDays: 28,
      withdrawalMilkDays: 4,
    },
    {
      medicineId: 'med-2',
      medicineName: 'Test eritma',
      activeIngredient: 'Modda',
      dosePerKg: '0.5',
      doseUnit: 'ML',
      maxSingleDose: '200',
      route: 'IV',
      frequencyPerDay: 1,
      durationDays: 1,
      withdrawalMeatDays: 0,
      withdrawalMilkDays: 0,
    },
  ],
};

describe('animal treatment', () => {
  it('without an approved protocol nothing can be started — the site never suggests a dose itself', async () => {
    const view = renderApp(`/animals/${cow().id}`);
    await view.user.click(await screen.findByRole('button', { name: 'Davolashni boshlash' }));
    const dialog = await screen.findByRole('dialog', { name: /^Davolashni boshlash: UZ-001/ });
    expect(await within(dialog).findByText('Tasdiqlangan davolash sxemalari hali yo‘q')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Davolashni boshlash' })).toBeDisabled();
  });

  it('starts from an approved protocol, shows the doses the server computed, and can be completed', async () => {
    api.server.db.recommendations = [approvedProtocol];
    const view = renderApp(`/animals/${cow().id}`);
    await view.user.click(await screen.findByRole('button', { name: 'Davolashni boshlash' }));
    const dialog = await screen.findByRole('dialog', { name: /^Davolashni boshlash: UZ-001/ });
    const protocol = await within(dialog).findByRole('radio', { name: 'Klinik mastit — test sxemasi' });
    // Injections into a vein are marked for the vet.
    expect(within(dialog).getByText('Faqat veterinar yuboradi')).toBeInTheDocument();
    await view.user.click(protocol);
    expect(within(dialog).getByLabelText(/Hayvon vazni/)).toHaveValue('480.5');
    await view.user.click(within(dialog).getByRole('button', { name: 'Davolashni boshlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const post = api.requests.find((request) => request.method === 'POST' && request.path === '/vet/treatments');
    expect(post?.body).toEqual({ animalId: cow().id, protocolVersionId: approvedProtocol.versionId, animalWeightKg: '480.5' });
    expect(post?.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);

    const list = await screen.findByRole('list', { name: 'Davolashlar' });
    expect(within(list).getByText('Davom etmoqda')).toBeInTheDocument();
    // 0.1 ml/kg × 480.5 kg; the IV dose is capped by its maximum (200 ml).
    expect(within(list).getByText(/48,05 ml · mushak ichiga \(m\/i\) · kuniga 1 marta · 3 kun/)).toBeInTheDocument();
    expect(within(list).getByText(/200 ml · vena ichiga \(v\/i\)/)).toBeInTheDocument();
    expect(within(list).getByText(/^Diqqat: go‘sht .* sotilmasin/)).toBeInTheDocument();

    await view.user.click(within(list).getByRole('button', { name: 'Tugallash' }));
    const confirm = await screen.findByRole('dialog', { name: 'Davolashni tugallash' });
    await view.user.click(within(confirm).getByRole('button', { name: 'Tugallash' }));
    expect(await within(list).findByText('Tugallangan')).toBeInTheDocument();
  });
});
