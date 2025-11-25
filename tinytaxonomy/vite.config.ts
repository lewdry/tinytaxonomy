import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

export default defineConfig({
    // Ensure Vite uses correct base path when deployed to GitHub Pages
    // this keeps worker and chunk URLs consistent with SvelteKit's `paths.base`.
    base: process.env.NODE_ENV === 'production' ? '/tinytaxonomy/' : '/',
	plugins: [sveltekit()],
    // Configure worker to use standard ES modules for browser compatibility
    worker: {
        format: 'es',
        // IMPORTANT: Ensure worker bundle includes all dependencies so CommonJS libraries
        // (eg. wink-nlp) are transformed and bundled correctly for the browser worker.
        // Do NOT mark 'util' as external here — leaving it external would keep
        // runtime `require('util')` calls in the final bundle which blow up in the browser.
        // We intentionally leave rollupOptions alone here to allow Vite/Rollup to
        // include the polyfills into the worker build.
    },
    resolve: {
        alias: {
            // FIX: Point 'util' alias at the actual entry used by the 'util' NPM
            // package in node_modules (util.js). The previous path referenced a
            // non-existent index.js which caused esbuild to fail while
            // pre-bundling dependencies used by the worker.
            'util': fileURLToPath(new URL('node_modules/util/util.js', import.meta.url))
        }
    },
    // CRITICAL FIX: Exclude complex Node-based dependencies from Vite's optimization
    // to prevent the persistent 504 (Outdated Optimize Dep) errors.
    optimizeDeps: {
        // Force Vite's pre-bundler to include these CommonJS-heavy modules so
        // they are converted to ESM and served correctly to the browser worker
        // during dev. This avoids 504 'Outdated Optimize Dep' + runtime `require`.
        include: ['wink-nlp', 'wink-eng-lite-web-model', 'ml-hclust']
    },

    // For production builds (and in some complex dev cases), instruct Rollup's
    // CommonJS handler to process these modules so `require()` is converted
    // properly instead of leaking into the final JS bundle.
    build: {
        commonjsOptions: {
            include: [/node_modules\/(wink-nlp|wink-eng-lite-web-model|ml-hclust)/, /node_modules/]
        }
    }
});