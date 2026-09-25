// Example widget: preset addresses shown above the shipping address form.
// Clicking one fills the stock form, so checkout validates, saves, and quotes shipping as if the shopper typed it.

import { registerWidget, type Address } from '../../src/harness/index.ts';

const PRESETS: { label: string; address: Address }[] = [
  {
    label: 'Sydney office',
    address: { countryCode: 'AU', firstName: 'Test', lastName: 'Shopper', address1: '175 Pitt St', city: 'Sydney', stateOrProvinceCode: 'NSW', postalCode: '2000', phone: '0400000000' },
  },
  {
    label: 'Melbourne warehouse',
    address: { countryCode: 'AU', firstName: 'Test', lastName: 'Shopper', company: 'Supply Yard', address1: '1 Spring St', city: 'Melbourne', stateOrProvinceCode: 'VIC', postalCode: '3000', phone: '0400000000' },
  },
];

registerWidget({
  name: 'example-address-picker',
  slot: 'shipping.address.before',

  mount({ host, checkout, log, signal }) {
    host.innerHTML = `
      <style>
        .cwh-presets { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: 0 0 1rem; }
        .cwh-presets button { padding: .4rem .8rem; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; }
        .cwh-presets button:disabled { opacity: .5; cursor: progress; }
        .cwh-presets [role=status] { font-size: .85em; color: #555; }
      </style>
      <div class="cwh-presets"><span>Quick fill:</span><span role="status"></span></div>`;

    const row = host.querySelector('.cwh-presets')!;
    const status = host.querySelector('[role=status]')!;
    const buttons = PRESETS.map(({ label }, i) => {
      const button = document.createElement('button');
      button.type = 'button'; // this sits inside checkout's <form>, so the default "submit" type would submit it
      button.textContent = label;
      button.dataset.preset = String(i);
      row.insertBefore(button, status);
      return button;
    });

    host.addEventListener('click', async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]');
      if (!button) return;
      buttons.forEach((b) => (b.disabled = true));
      status.textContent = 'Filling…';
      const result = await checkout.fillShippingAddress(PRESETS[Number(button.dataset.preset)].address, { replace: true, waitForSave: true });
      log.info('fill result', JSON.stringify(result));
      if (!host.isConnected) return; // checkout re-rendered while we waited
      status.textContent = !result.ok ? `Couldn't fill: ${result.error ?? result.missing.join(', ')}`
        : result.saved ? 'Saved ✓'
        : result.notSaved === 'unchanged' ? 'Already filled'
        : result.notSaved === 'incomplete' ? 'Filled. Checkout needs more details before it saves.'
        : "Filled, but checkout didn't save it";
      buttons.forEach((b) => (b.disabled = false));
    }, { signal });

    // Optional: react to checkout's own saves, including ones made by the shopper typing.
    const off = checkout.onConsignmentsChange((consignments) => {
      const recommended = consignments[0]?.availableShippingOptions?.find((o) => o.isRecommended);
      log.debug('consignments changed; recommended option:', recommended?.description ?? 'none');
    });
    return off;
  },
});
