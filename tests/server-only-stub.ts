/**
 * Stands in for the `server-only` marker package during tests.
 *
 * That package throws unless a bundler selects its `react-server` export
 * condition. The modules under test are server modules by definition, so the
 * marker has nothing to protect here.
 */
export {};
