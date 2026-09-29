import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ming-iman.github.io',
  trailingSlash: 'always',
  integrations: [react(), sitemap()],
  markdown: { shikiConfig: { theme: 'github-light' } },
});
