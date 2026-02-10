import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://klawhook.xyz',
  output: 'static',
  build: {
    assets: '_assets'
  }
});
