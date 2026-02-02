import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://keyhook.world',
  output: 'static',
  build: {
    assets: '_assets'
  }
});
