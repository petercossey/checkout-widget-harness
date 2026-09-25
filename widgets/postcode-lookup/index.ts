// Postcode lookup above the shipping address form.
// A hard-coded AU list is enough: pick a suburb and checkout fills city, state, and postcode
// through the stock form, so auto-save and shipping quotes behave as if the shopper typed them.

import { registerWidget } from '../../src/harness/index.ts';

interface Suburb {
  city: string;
  stateOrProvinceCode: string;
}

/** Postcode → suburbs. State is the select code checkout uses for Australia. */
const POSTCODES: Record<string, Suburb[]> = {
  '2000': [
    { city: 'Sydney', stateOrProvinceCode: 'NSW' },
    { city: 'Barangaroo', stateOrProvinceCode: 'NSW' },
    { city: 'Haymarket', stateOrProvinceCode: 'NSW' },
    { city: 'The Rocks', stateOrProvinceCode: 'NSW' },
  ],
  '3000': [{ city: 'Melbourne', stateOrProvinceCode: 'VIC' }],
  '4000': [{ city: 'Brisbane', stateOrProvinceCode: 'QLD' }],
};

registerWidget({
  name: 'postcode-lookup',
  slot: 'shipping.address.before',

  mount({ host, checkout, log, signal }) {
    host.innerHTML = `
      <style>
        .cwh-pc { margin: 0 0 1rem; font-size: .95rem; }
        .cwh-pc label { display: block; margin-bottom: .35rem; font-weight: 600; }
        .cwh-pc input { width: 8rem; padding: .4rem .5rem; border: 1px solid #ccc; border-radius: 4px; }
        .cwh-pc ul { list-style: none; margin: .5rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: .4rem; }
        .cwh-pc button { padding: .35rem .7rem; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; }
        .cwh-pc button:disabled { opacity: .5; cursor: progress; }
        .cwh-pc [role=status] { display: block; margin-top: .4rem; font-size: .85em; color: #555; }
      </style>
      <div class="cwh-pc">
        <label for="cwh-pc-input">Find your suburb</label>
        <input id="cwh-pc-input" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="e.g. 2000">
        <ul></ul>
        <span role="status"></span>
      </div>`;

    const input = host.querySelector('input')!;
    const list = host.querySelector('ul')!;
    const status = host.querySelector('[role=status]')!;

    // The host sits inside checkout's <form>. Enter in this input must not submit it.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault();
    }, { signal });

    const render = () => {
      const code = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value !== code) input.value = code;
      list.replaceChildren();
      const matches = POSTCODES[code];
      if (!code) {
        status.textContent = '';
        return;
      }
      if (!matches) {
        status.textContent = code.length === 4 ? 'No suburbs for that postcode.' : '';
        return;
      }
      status.textContent = matches.length === 1 ? '1 suburb' : `${matches.length} suburbs`;
      for (const suburb of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${suburb.city} ${suburb.stateOrProvinceCode}`;
        button.addEventListener('click', () => pick(suburb, code), { signal });
        list.append(button);
      }
    };

    async function pick(suburb: Suburb, postalCode: string) {
      const buttons = [...list.querySelectorAll('button')];
      buttons.forEach((b) => (b.disabled = true));
      status.textContent = 'Filling…';
      // Partial update: name, street, and anything else already typed stay, including when a
      // saved address is selected (the harness starts the new address from it).
      // Country is set so the state dropdown has Australian codes.
      const result = await checkout.fillShippingAddress(
        { countryCode: 'AU', city: suburb.city, stateOrProvinceCode: suburb.stateOrProvinceCode, postalCode },
        { waitForSave: true },
      );
      log.info('fill', JSON.stringify(result));
      if (!host.isConnected) return;
      buttons.forEach((b) => (b.disabled = false));
      const picked = `${suburb.city} ${suburb.stateOrProvinceCode} ${postalCode}`;
      status.textContent = !result.ok ? `Couldn't fill: ${result.error ?? result.missing.join(', ')}`
        : result.saved ? `${picked} saved. Shipping options are updated below.`
        : result.notSaved === 'unchanged' ? `${picked} is already selected.`
        : result.notSaved === 'incomplete' ? `${picked} filled. Complete the rest of the address to see shipping options.`
        : `${picked} filled, but checkout didn't save it. Please check the address.`;
    }

    input.addEventListener('input', render, { signal });
  },
});
