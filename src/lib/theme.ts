export type Theme = "light" | "dark";

const STORAGE_KEY = "vara5-theme";

/**
 * Tiny external store for the colour theme.
 *
 * The document element is the source of truth (it is set before first paint by
 * the inline script in the root layout), and components subscribe to it with
 * useSyncExternalStore. That avoids the setState-inside-effect pattern and the
 * cascading render it causes.
 */
const listeners = new Set<() => void>();

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The server has no document; light matches the inline script's default. */
export function getServerTheme(): Theme {
  return "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing or blocked storage: the choice simply will not persist.
  }
  for (const listener of listeners) listener();
}

/**
 * Runs before the first paint, inlined into the document head, so the page
 * never flashes light before switching to dark.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var dark = stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;
