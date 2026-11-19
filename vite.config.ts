import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file output so the playable build is one HTML page that can be hosted anywhere.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022' },
});
