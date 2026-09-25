// Click a preset and check checkout saved it. Clicking it again must report "already filled" straight away.
import type { WidgetSmoke } from '../../scripts/lib/widget-smoke.ts';

export default (async ({ host, expectSavedAddress }) => {
  const preset = host.getByRole('button', { name: 'Melbourne warehouse' });
  await preset.click();
  await expectSavedAddress({ company: 'Supply Yard', address1: '1 Spring St', city: 'Melbourne', postalCode: '3000' });
  await host.getByText('Saved ✓').waitFor({ timeout: 15000 });
  await preset.click();
  await host.getByText('Already filled').waitFor({ timeout: 1000 });
  return 'preset saved; repeat click answered at once';
}) satisfies WidgetSmoke;
