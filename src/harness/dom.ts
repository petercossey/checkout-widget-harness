export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Polls fn until it returns a truthy value, or resolves null on timeout.
// Only use this for short, bounded waits (e.g. during a fill). Long-lived
// watching belongs in the lifecycle observer.
export function waitFor<T>(fn: () => T | null | undefined | false, timeout = 5000, interval = 50): Promise<T | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      let value: T | null | undefined | false = null;
      try {
        value = fn();
      } catch {
        // treat as not ready yet
      }
      if (value) return resolve(value);
      if (performance.now() - started >= timeout) return resolve(null);
      setTimeout(check, interval);
    };
    check();
  });
}
