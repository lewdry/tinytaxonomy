import adapter from '@sveltejs/adapter-static'; 
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// Uses adapter-static to generate a static site that can be served by GitHub Pages.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
        
        // Define the base path for your application.
        paths: {
            base: process.env.NODE_ENV === 'production' ? '/tinytaxonomy' : '',
        }
	}
};

export default config;