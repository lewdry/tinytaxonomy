import type { Config } from 'tailwindcss';

const config = {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
            // Define the 'Inter' font or other custom fonts here
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
        },
	},
	plugins: [],
} satisfies Config;

export default config;