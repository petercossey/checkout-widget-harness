// Starts from a saved Sydney 2000 address: look up 3000, pick Melbourne, and check that
// checkout saved the new city, state and postcode while keeping the street.
import type { WidgetSmoke } from '../../scripts/lib/widget-smoke.ts';

export default (async ({ host, address, expectSavedAddress }) => {
  await host.getByLabel('Find your suburb').fill('3000');
  await host.getByRole('button', { name: 'Melbourne VIC' }).click();
  await expectSavedAddress({ city: 'Melbourne', stateOrProvinceCode: 'VIC', postalCode: '3000', address1: address.address1 });
  return 'picked Melbourne VIC 3000, street kept';
}) satisfies WidgetSmoke;
