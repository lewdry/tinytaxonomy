<script lang="ts">
	import { onMount } from 'svelte';
	import { appState, type AppState } from '$lib/stores/appState';
	import TaxonomyTree from '$lib/components/TaxonomyTree.svelte';
	// This import syntax tells Vite to treat the file as a Web Worker
	import ClusterWorker from '$lib/workers/cluster.worker?worker'; 

	let worker: Worker;
	
    // Placeholder text to get the user started
	let textAreaValue = `TinyTaxonomy is a client-side, static web app built to model text quickly.

It analyzes raw text input and generates an interactive hierarchical visualisation (taxonomy) to reveal the semantic structure of the document.

Unlike word clouds which show frequency, this tool uses hierarchical clustering to show relationships, grouping similar concepts, sentences or sections together.

So what? Let Wikipedia explain...

In linguistics, semantic analysis is the process of relating syntactic structures, from the levels of words, phrases, clauses, sentences and paragraphs to the level of the writing as a whole, to their language-independent meanings. It also involves removing features specific to particular linguistic and cultural contexts, to the extent that such a project is possible. The elements of idiom and figurative speech, being cultural, are often also converted into relatively invariant meanings in semantic analysis. Semantics, although related to pragmatics, is distinct in that the former deals with word or sentence choice in any given context, while pragmatics considers the unique or particular meaning derived from context or tone. To reiterate in different terms, semantics is about universally coded meaning, and pragmatics, the meaning encoded in words that is then interpreted by an audience.

Semantic analysis can begin with the relationship between individual words. This requires an understanding of lexical hierarchy, including hyponymy and hypernymy, meronomy, polysemy, synonyms, antonyms, and homonyms.[2] It also relates to concepts like connotation (semiotics) and collocation, which is the particular combination of words that can be or frequently are surrounding a single word. This can include idioms, metaphor, and simile, like, "white as a ghost."

With the availability of enough material to analyze, semantic analysis can be used to catalog and trace the style of writing of specific authors.[
`;

    // Explicitly define the array of modes using the strict type to fix the TS error
    const modes: AppState['mode'][] = ['paragraph', 'sentence', 'word'];

	// Small filtering options exposed to the user
	let nounOnly = true;
	let minWordFreq = 1; // default to 1 — keep rare tokens by default

	// Input limits
	const maxWordLimit = 5000; // prevent runaway processing

	// reactive word count for the textarea
	let wordCount = 0;
	$: wordCount = textAreaValue.split(/\s+/).filter(w => w.length > 0).length;
	// layout & levels controls for visualization
	// Default to radial layout — radial better preserves semantic grouping and reduces cross-overs
	let layoutType: 'tree' | 'radial' = 'radial';
	let maxVisibleLevels: number = 3;

	onMount(() => {
		// Initialize the worker
		worker = new ClusterWorker();
		
		// Setup the worker message listener
		worker.onmessage = (e) => {
			$appState.isProcessing = false;
			if (e.data.type === 'success') {
				$appState.data = e.data.data;
			} else {
				$appState.error = e.data.error;
				console.error('Worker Error:', e.data.error); 
			}
		};
	});

	function runAnalysis() {
		if (!textAreaValue.trim()) return;

		const wordCount = textAreaValue.split(/\s+/).filter(w => w.length > 0).length;
		if (wordCount > maxWordLimit) {
			$appState.error = `Input too large — ${wordCount} words (limit ${maxWordLimit}). Reduce input or split into parts.`;
			$appState.isProcessing = false;
			return;
		}

		$appState.error = null;
		$appState.isProcessing = true;
		$appState.text = textAreaValue;
		$appState.data = null; // Clear previous data

		// Send data to the Web Worker — include filter options for word mode
		worker.postMessage({
			text: $appState.text,
			mode: $appState.mode,
			options: {
				nounOnly: $appState.mode === 'word' ? nounOnly : false,
				minWordFreq: $appState.mode === 'word' ? minWordFreq : undefined
			}
		});
	}
</script>

<div class="flex h-screen w-full bg-gray-100 font-sans">
	<!-- Sidebar -->
	<aside class="w-1/3 min-w-[350px] max-w-[500px] flex flex-col bg-white shadow-xl z-10">
		<div class="p-6 border-b">
			<h1 class="text-2xl font-bold text-gray-800">TinyTaxonomy</h1>
			<p class="text-sm text-gray-500">An 'Aboutness Visualiser' (or Semantic Structure Analyzer)</p>
		</div>

		<div class="flex-1 p-6 flex flex-col gap-6 overflow-y-auto">
			<!-- Input -->
			<div class="flex flex-col gap-2">
				<label for="input" class="text-xs font-bold uppercase text-gray-400">Raw Text Input</label>
				<textarea 
					bind:value={textAreaValue}
					id="input"
					class="w-full h-64 p-3 text-sm border rounded-md focus:ring-2 focus:ring-blue-500 outline-none resize-y"
					placeholder="Paste your text here (500-5000 words)..."
				></textarea>
				<div class="text-xs text-right text-gray-400">
					Word Count: {wordCount}
					{#if wordCount > maxWordLimit}
						<span class="ml-2 text-red-500 font-semibold">Exceeded max words ({maxWordLimit}) — reduce input</span>
					{/if}
				</div>
			</div>

			<!-- Controls -->
			<div class="flex flex-col gap-2">
				<div class="text-xs font-bold uppercase text-gray-400">Atomic Unit (Mode)</div>
				<div class="flex bg-gray-100 rounded-lg p-1">
					{#each modes as m}
						<button 
							class="flex-1 py-1.5 text-sm capitalize rounded-md transition-all { $appState.mode === m ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}"
							on:click={() => $appState.mode = m}
						>
							{m}
						</button>
					{/each}
				</div>
				<p class="text-xs text-gray-500 mt-1">
					{#if $appState.mode === 'paragraph'}
						Clusters text blocks (Sections). Best for Table of Contents view.
					{:else if $appState.mode === 'sentence'}
						Clusters claims (Statements). Best for Argument mapping.
					{:else}
						Clusters stemmed vocabulary. Best for Thesaurus/Ontology generation.
					{/if}
				</p>
			</div>

			{#if $appState.mode === 'word'}
				<div class="mt-2 p-3 rounded-md bg-gray-50 border">
					<div class="flex items-center gap-3 text-xs">
						<input type="checkbox" id="nounOnly" bind:checked={nounOnly} class="w-4 h-4" />
						<label for="nounOnly">Keep nouns only (POS filter)</label>
					</div>
					<div class="flex items-center gap-3 mt-2 text-xs">
                		<label class="text-xs" for="minWordFreq">Min token frequency:</label>
                		<input id="minWordFreq" type="number" min="1" bind:value={minWordFreq} class="w-16 p-1 border rounded text-sm" />
						<span class="text-gray-400">(hide very rare tokens)</span>
					</div>
				</div>
			{/if}

			<!-- Process Button (Error source is here) -->
			<button 
				on:click={runAnalysis}
				disabled={$appState.isProcessing || !textAreaValue.trim() || wordCount > maxWordLimit}
				class="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold rounded-lg shadow transition-colors flex justify-center items-center gap-2"
			>
				{#if $appState.isProcessing}
					<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					Processing...
				{:else}
					Generate Taxonomy
				{/if}
			</button>

			<!-- Error Display -->
			{#if $appState.error}
				<div class="p-3 bg-red-100 text-red-700 text-sm rounded-lg border border-red-300">
					<strong class="font-semibold">Analysis Error:</strong> {$appState.error}
				</div>
			{/if}
            
            <div class="prose text-sm mt-4 p-2">
                <h2>About the Tool</h2>
                <p>TinyTaxonomy uses Natural Language Processing (NLP), Term Frequency-Inverse Document Frequency (TF-IDF), and Agglomerative Hierarchical Clustering (AGNES) to discover the underlying semantic relationships in your text.</p>
				<p>TinyTaxonomy by <a href="https://lewisdryburgh.com" target="_blank" rel="noopener noreferrer">Lewis Dryburgh</a></p>

            </div>
		</div>
	</aside>

	<!-- Main Canvas -->
	<main class="flex-1 p-4 relative overflow-hidden">
		{#if $appState.data}
			<div class="flex items-center gap-3 mb-2">
				<div class="text-xs text-gray-500">Layout:</div>
				<select bind:value={layoutType} class="text-sm p-1 border rounded">
					<option value="tree">Tree (left-right)</option>
					<option value="radial">Radial</option>
				</select>
				<div class="text-xs text-gray-500 ml-4">Show levels:</div>
				<input type="number" min="1" bind:value={maxVisibleLevels} class="w-16 p-1 border rounded text-sm" />
			</div>
			<TaxonomyTree data={$appState.data} layout={layoutType} maxDepth={maxVisibleLevels} />
		{:else}
			<div class="w-full h-full border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400">
				<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3m-4 4h8M5 16h14M8 10l-4 6h12l-4-6M12 3c-1.105 0-2 .895-2 2s.895 2 2 2 2-.895 2-2-.895-2-2-2z"/></svg>
				<p class="mt-4">Enter text and click generate to visualize the semantic structure.</p>
			</div>
		{/if}
	</main>
</div>