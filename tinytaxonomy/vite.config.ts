import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

export default defineConfig({
	plugins: [sveltekit()],
    // Configure worker to use standard ES modules for browser compatibility
    worker: {
        format: 'es',
        // CRITICAL FIX: Add rollup options to force certain dependencies external
        // This ensures the necessary CJS shims (like 'require' polyfill) are correctly 
        // injected into the worker bundle for libraries like wink-nlp.
        rollupOptions: {
            external: ['util']
        }
    },
    resolve: {
        alias: {
            // FIX: Changed file path from 'util.js' to the correct entry point 'index.js' 
            // for the browser polyfill package. This resolves `util.inherits` errors.
            'util': fileURLToPath(new URL('node_modules/util/index.js', import.meta.url))
        }
    },
    // CRITICAL FIX: Exclude complex Node-based dependencies from Vite's optimization
    // to prevent the persistent 504 (Outdated Optimize Dep) errors.
    optimizeDeps: {
        exclude: ['ml-hclust', 'wink-nlp', 'wink-eng-lite-web-model']
    }
});