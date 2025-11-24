import { writable } from 'svelte/store';

export type AppState = {
	text: string;
	mode: 'paragraph' | 'sentence' | 'word';
	data: any | null; // D3 hierarchy data output from worker
	isProcessing: boolean;
	error: string | null;
};

export const appState = writable<AppState>({
	text: '',
	mode: 'sentence', // Default mode
	data: null,
	isProcessing: false,
	error: null
});