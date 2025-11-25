import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

export default defineConfig({
    base: process.env.NODE_ENV === 'production' ? '/tinytaxonomy/' : '/',
    plugins: [sveltekit()],

    worker: {
        format: 'es',
    },

    resolve: {
        alias: {
            'util': fileURLToPath(new URL('node_modules/util/util.js', import.meta.url))
        }
    },

    optimizeDeps: {
        include: ['wink-nlp', 'wink-eng-lite-web-model', 'ml-hclust']
    },

    build: {
        minify: false,       // disable minification
        sourcemap: true,     // optional: makes debugging easier
        rollupOptions: {
            treeshake: false, // disable tree-shaking
        },
        commonjsOptions: {
            include: [/node_modules\/(wink-nlp|wink-eng-lite-web-model|ml-hclust)/, /node_modules/]
        }
    },

});
