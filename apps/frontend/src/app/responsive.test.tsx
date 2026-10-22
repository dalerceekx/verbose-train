import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import { setViewportWidth } from '@/test/viewport';

/**
 * The widths the QA report checks. jsdom has no layout engine: this covers
 * what changes in the DOM with the width (tables become cards below 768 px)
 * and that every action stays reachable; the visual check is done in a browser.
 */
const WIDTHS = [360, 390, 612, 768, 1280] as const;

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

describe.each(WIDTHS)('at %i px', (width) => {
  it('the warehouse keeps every feed and its actions', async () => {
    setViewportWidth(width);
    renderApp('/feed');
    expect(await screen.findAllByRole('button', { name: 'Xarid' })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Kirim (xaridsiz)' })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Arpa: arxivlash' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Asosiy menyu' })).toBeInTheDocument();
  });

  it('the dashboard keeps its figures, quick actions and the tab bar', async () => {
    setViewportWidth(width);
    renderApp('/dashboard');
    const stats = await screen.findByRole('region', { name: 'Asosiy ko‘rsatkichlar' });
    expect(await within(stats).findByText('12')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tezkor amallar' })).getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('region', { name: 'Xarajatlar' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Asosiy menyu' })).toBeInTheDocument();
  });
});

describe.each(WIDTHS.filter((width) => width < 768))('phone width %i px', (width) => {
  it('shows the feeds as cards, not as a wide table', async () => {
    setViewportWidth(width);
    renderApp('/feed');
    expect(await screen.findByRole('list', { name: 'Yem mahsulotlari' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe.each(WIDTHS.filter((width) => width >= 768))('wide screen %i px', (width) => {
  it('shows the feeds as a table with the days column', async () => {
    setViewportWidth(width);
    renderApp('/feed');
    const table = await screen.findByRole('table', { name: 'Yem mahsulotlari' });
    expect(within(table).getByRole('columnheader', { name: 'Necha kunga' })).toBeInTheDocument();
  });
});
