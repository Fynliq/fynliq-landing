import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    /**
     * Editor tooling checks out full worktrees under `.kilo/`, source tree and
     * all. The default globs reach into them and collect every suite a second
     * time: 406 tests where there are 203, and a single real failure printed
     * twice, from two paths, as if two things were broken.
     */
    exclude: [...configDefaults.exclude, '.kilo/**'],
  },
});
