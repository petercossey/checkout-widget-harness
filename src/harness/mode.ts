// Runtime switch, set per browser by URL or localStorage:
//   ?cwh=off    disable all widgets (sticky)
//   ?cwh=debug  verbose logging and network logging (sticky)
//   ?cwh=on     back to normal
// Script Manager `enabled: false` is the store-wide switch. This one is for a single browser.

export type Mode = 'on' | 'off' | 'debug';

export function readMode(): Mode {
  try {
    const fromUrl = new URLSearchParams(location.search).get('cwh');
    if (fromUrl) localStorage.setItem('cwh', fromUrl);
    const value = fromUrl ?? localStorage.getItem('cwh');
    return value === 'off' || value === 'debug' ? value : 'on';
  } catch {
    return 'on';
  }
}
