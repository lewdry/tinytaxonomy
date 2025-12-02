<script lang="ts">
	import { onMount } from "svelte";
	import { appState } from "$lib/stores/appState";
	import type { AppState } from "$lib/types";
	import TaxonomyTree from "$lib/components/TaxonomyTree.svelte";
	// This import syntax tells Vite to treat the file as a Web Worker
	import ClusterWorker from "$lib/workers/cluster.worker?worker";
	import WordCloud from "$lib/components/WordCloud.svelte";

	let worker: Worker;

	// Placeholder text to get the user started
	let textAreaValue = `TinyTaxonomy is a client-side, static web app built to model text quickly.

It analyzes raw text input and generates an interactive hierarchical visualisation (taxonomy) to reveal the semantic structure of the document.

Unlike word clouds which show frequency, this tool uses hierarchical clustering to show relationships, grouping similar concepts, sentences or sections together.

So what? Let Wikipedia explain...

In linguistics, semantic analysis is the process of relating syntactic structures, from the levels of words, phrases, clauses, sentences and paragraphs to the level of the writing as a whole, to their language-independent meanings. It also involves removing features specific to particular linguistic and cultural contexts, to the extent that such a project is possible. The elements of idiom and figurative speech, being cultural, are often also converted into relatively invariant meanings in semantic analysis. Semantics, although related to pragmatics, is distinct in that the former deals with word or sentence choice in any given context, while pragmatics considers the unique or particular meaning derived from context or tone. To reiterate in different terms, semantics is about universally coded meaning, and pragmatics, the meaning encoded in words that is then interpreted by an audience.

Semantic analysis can begin with the relationship between individual words. This requires an understanding of lexical hierarchy, including hyponymy and hypernymy, meronomy, polysemy, synonyms, antonyms, and homonyms. It also relates to concepts like connotation (semiotics) and collocation, which is the particular combination of words that can be or frequently are surrounding a single word. This can include idioms, metaphor and simile, like, "white as a ghost."

With the availability of enough material to analyze, semantic analysis can be used to catalog and trace the style of writing of specific authors.`;

	// Explicitly define the array of modes using the strict type to fix the TS error
	const modes: AppState["mode"][] = ["paragraph", "sentence", "word"];

	// Set default mode to 'word' on load
	import { get } from "svelte/store";
	if (get(appState).mode !== "word") {
		appState.update((state) => ({ ...state, mode: "word" }));
	}

	// Word cloud state
	let showWordCloud = false;
	let wordCloudWords: { text: string; size: number }[] = [];

	// Small filtering options exposed to the user
	let nounOnly = true;
	let minWordFreq = 1; // default to 1 — keep rare tokens by default
	let customStopwordsText = "";

	// Input limits
	const maxWordLimit = 5000; // prevent runaway processing

	// reactive word count for the textarea
	let wordCount = 0;
	$: wordCount = textAreaValue
		.split(/\s+/)
		.filter((w) => w.length > 0).length;
	// layout & levels controls for visualization
	// Default to radial layout — radial better preserves semantic grouping and reduces cross-overs
	let layoutType: "tree" | "radial" = "radial";
	let maxVisibleLevels: number = 3;
	let progressMessage = "";

	onMount(() => {
		// Initialize the worker
		worker = new ClusterWorker();

		// Setup the worker message listener
		worker.onmessage = (e) => {
			if (e.data.type === "progress") {
				progressMessage = e.data.message;
				return;
			}

			$appState.isProcessing = false;
			progressMessage = "";

			if (e.data.type === "success") {
				$appState.data = e.data.data;
			} else {
				$appState.error = e.data.error;
				console.error("Worker Error:", e.data.error);
			}
		};
	});

	function runAnalysis() {
		if (!textAreaValue.trim()) return;

		const wordCount = textAreaValue
			.split(/\s+/)
			.filter((w) => w.length > 0).length;
		if (wordCount > maxWordLimit) {
			$appState.error = `Input too large — ${wordCount} words (limit ${maxWordLimit}). Reduce input or split into parts.`;
			$appState.isProcessing = false;
			return;
		}

		$appState.error = null;
		$appState.isProcessing = true;
		progressMessage = "Starting...";
		$appState.text = textAreaValue;
		$appState.data = null; // Clear previous data

		// Hide word cloud if visible
		showWordCloud = false;

		const customStopwords = customStopwordsText
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		// Send data to the Web Worker — include filter options for word mode
		worker.postMessage({
			text: $appState.text,
			mode: $appState.mode,
			options: {
				nounOnly: $appState.mode === "word" ? nounOnly : false,
				minWordFreq:
					$appState.mode === "word" ? minWordFreq : undefined,
				customStopwords,
			},
		});
	}

	function generateWordCloud() {
		if (!textAreaValue.trim()) return;
		// Basic word frequency count
		const words = textAreaValue.toLowerCase().match(/\b\w+\b/g) || [];
		// Common English stopwords to ignore
		const stopwords = new Set([
			"the",
			"and",
			"is",
			"to",
			"of",
			"in",
			"a",
			"an",
			"on",
			"for",
			"with",
			"as",
			"by",
			"at",
			"from",
			"it",
			"that",
			"this",
			"be",
			"or",
			"are",
			"was",
			"were",
			"but",
			"not",
			"which",
			"so",
			"if",
			"can",
			"has",
			"have",
			"had",
			"will",
			"would",
			"do",
			"does",
			"did",
			"about",
			"into",
			"than",
			"then",
			"them",
			"they",
			"their",
			"there",
			"these",
			"those",
			"its",
			"also",
			"such",
			"may",
			"more",
			"most",
			"some",
			"any",
			"all",
			"each",
			"other",
			"when",
			"what",
			"who",
			"whom",
			"where",
			"why",
			"how",
			"been",
			"out",
			"up",
			"down",
			"over",
			"under",
			"again",
			"after",
			"before",
			"between",
			"both",
			"during",
			"few",
			"he",
			"she",
			"him",
			"her",
			"his",
			"hers",
			"i",
			"me",
			"my",
			"mine",
			"you",
			"your",
			"yours",
			"we",
			"us",
			"our",
			"ours",
		]);

		// Add custom stopwords to the set
		if (customStopwordsText) {
			customStopwordsText.split(",").forEach((s) => {
				const clean = s.trim().toLowerCase();
				if (clean) stopwords.add(clean);
			});
		}

		const freq: Record<string, number> = {};
		for (const w of words) {
			if (!stopwords.has(w)) {
				freq[w] = (freq[w] || 0) + 1;
			}
		}

		// Convert to array and sort by frequency
		let arr = Object.entries(freq).map(([text, size]) => ({
			text,
			size: Number(size),
		}));
		arr = arr.filter((w) => w.size > 1); // filter out singletons for clarity
		arr.sort((a, b) => b.size - a.size);
		// Scale font size between 18 and 60
		const min = arr.length ? arr[arr.length - 1].size : 1;
		const max = arr.length ? arr[0].size : 1;
		const scale = (n: number) =>
			18 + (max === min ? 0 : ((n - min) * (60 - 18)) / (max - min));
		wordCloudWords = arr.map((w) => ({
			text: w.text,
			size: scale(w.size),
		}));
		showWordCloud = true;
		$appState.data = null; // Hide taxonomy if showing word cloud
	}

	// Save/Share visualisation logic
	function saveVisualisation() {
		// Try to find the first SVG in the main area
		const svg = document.querySelector("main svg");
		if (!svg) return;

		// Clone the SVG to avoid modifying the original
		const svgClone = svg.cloneNode(true) as SVGSVGElement;

		// Convert all CSS classes to inline styles for proper PNG export
		// This ensures colors, strokes, and fills are preserved
		const applyComputedStyles = (element: Element) => {
			const computed = window.getComputedStyle(element);

			// Apply critical styles as inline attributes
			if (element instanceof SVGElement) {
				// Handle fill
				const fill = computed.fill;
				if (fill && fill !== "none" && !element.hasAttribute("fill")) {
					element.setAttribute("fill", fill);
				}

				// Handle stroke
				const stroke = computed.stroke;
				if (
					stroke &&
					stroke !== "none" &&
					!element.hasAttribute("stroke")
				) {
					element.setAttribute("stroke", stroke);
				}

				// Handle stroke-width
				const strokeWidth = computed.strokeWidth;
				if (
					strokeWidth &&
					strokeWidth !== "0px" &&
					!element.hasAttribute("stroke-width")
				) {
					element.setAttribute("stroke-width", strokeWidth);
				}

				// Handle opacity
				const opacity = computed.opacity;
				if (
					opacity &&
					opacity !== "1" &&
					!element.hasAttribute("opacity")
				) {
					element.setAttribute("opacity", opacity);
				}

				// Handle font properties for text elements
				if (element instanceof SVGTextElement) {
					const fontSize = computed.fontSize;
					const fontWeight = computed.fontWeight;
					const fontFamily = computed.fontFamily;
					const textAnchor = computed.textAnchor;

					if (fontSize && !element.hasAttribute("font-size")) {
						element.setAttribute("font-size", fontSize);
					}
					if (
						fontWeight &&
						fontWeight !== "400" &&
						!element.hasAttribute("font-weight")
					) {
						element.setAttribute("font-weight", fontWeight);
					}
					if (fontFamily && !element.hasAttribute("font-family")) {
						element.setAttribute("font-family", fontFamily);
					}
					if (textAnchor && !element.hasAttribute("text-anchor")) {
						element.setAttribute("text-anchor", textAnchor);
					}
				}
			}

			// Recursively apply to children
			Array.from(element.children).forEach(applyComputedStyles);
		};

		applyComputedStyles(svgClone);

		// Serialize the styled SVG clone
		const serializer = new XMLSerializer();
		const svgString = serializer.serializeToString(svgClone);

		// Create an image and draw SVG to canvas
		const img = new window.Image();
		const svg64 = btoa(unescape(encodeURIComponent(svgString)));
		const imageSrc = "data:image/svg+xml;base64," + svg64;

		// Generate filename: tinytaxonomy-yymmdd-hhmmss.png
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, "0");
		const y = now.getFullYear().toString().slice(-2);
		const m = pad(now.getMonth() + 1);
		const d = pad(now.getDate());
		const h = pad(now.getHours());
		const min = pad(now.getMinutes());
		const s = pad(now.getSeconds());
		const filename = `tinytaxonomy-${y}${m}${d}-${h}${min}${s}.png`;

		img.onload = function () {
			const canvas = document.createElement("canvas");
			const svgEl = svg as SVGSVGElement;
			canvas.width = svgEl.width?.baseVal?.value || 400;
			canvas.height = svgEl.height?.baseVal?.value || 300;
			const ctx = canvas.getContext("2d");
			if (!ctx) return;

			// Fill with white background first
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			ctx.drawImage(img, 0, 0);

			canvas.toBlob((blob) => {
				if (!blob) return;
				// Try Web Share API for PNG
				if (
					navigator.canShare &&
					navigator.canShare({
						files: [
							new File([blob], filename, { type: "image/png" }),
						],
					})
				) {
					const file = new File([blob], filename, {
						type: "image/png",
					});
					navigator.share({
						title: "TinyTaxonomy Visualisation",
						text: "Check out this visualisation from TinyTaxonomy!",
						files: [file],
					});
					return;
				}
				// Otherwise, trigger PNG download
				const a = document.createElement("a");
				a.href = URL.createObjectURL(blob);
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(a.href);
			}, "image/png");
		};
		img.src = imageSrc;
	}

	function exportJSON() {
		if (!$appState.data) return;
		const jsonString = JSON.stringify($appState.data, null, 2);
		const blob = new Blob([jsonString], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `tinytaxonomy-export-${new Date().toISOString().slice(0, 10)}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
</script>

<div class="flex h-screen w-full bg-gray-100 font-sans">
	<!-- Sidebar -->
	<aside
		class="w-1/3 min-w-[350px] max-w-[500px] flex flex-col bg-white shadow-xl z-10"
	>
		<div class="p-6 border-b">
			<h1 class="text-2xl font-bold text-gray-800">TinyTaxonomy</h1>
			<p class="text-sm text-gray-500">
				An 'Aboutness Visualiser' (or Semantic Structure Analyzer)
			</p>
		</div>

		<div class="flex-1 p-6 flex flex-col gap-6 overflow-y-auto">
			<!-- Input -->
			<div class="flex flex-col gap-2">
				<label
					for="input"
					class="text-xs font-bold uppercase text-gray-400"
					>Raw Text Input</label
				>
				<textarea
					bind:value={textAreaValue}
					id="input"
					class="w-full h-64 p-3 text-sm border rounded-md focus:ring-2 focus:ring-blue-500 outline-none resize-y"
					placeholder="Paste your text here (500-5000 words)..."
				></textarea>
				<div class="text-xs text-right text-gray-400">
					Word Count: {wordCount}
					{#if wordCount > maxWordLimit}
						<span class="ml-2 text-red-500 font-semibold"
							>Exceeded max words ({maxWordLimit}) — reduce input</span
						>
					{/if}
				</div>
			</div>

			<!-- Controls -->
			<div class="flex flex-col gap-2">
				<div class="text-xs font-bold uppercase text-gray-400">
					Atomic Unit (Mode)
				</div>
				<div class="flex bg-gray-100 rounded-lg p-1">
					{#each modes as m}
						<button
							class="flex-1 py-1.5 text-sm capitalize rounded-md transition-all {$appState.mode ===
							m
								? 'bg-white shadow text-blue-600 font-medium'
								: 'text-gray-500 hover:text-gray-700'}"
							on:click={() => ($appState.mode = m)}
						>
							{m}
						</button>
					{/each}
				</div>
				<p class="text-xs text-gray-500 mt-1">
					{#if $appState.mode === "paragraph"}
						Clusters text blocks (Sections). Best for Table of
						Contents view.
					{:else if $appState.mode === "sentence"}
						Clusters claims (Statements). Best for Argument mapping.
					{:else}
						Clusters stemmed vocabulary. Best for Thesaurus/Ontology
						generation.
					{/if}
				</p>
			</div>

			{#if $appState.mode === "word"}
				<div class="mt-2 p-3 rounded-md bg-gray-50 border">
					<div class="flex items-center gap-3 text-xs">
						<input
							type="checkbox"
							id="nounOnly"
							bind:checked={nounOnly}
							class="w-4 h-4"
						/>
						<label for="nounOnly"
							>Keep nouns only (POS filter)</label
						>
					</div>
					<div class="flex items-center gap-3 mt-2 text-xs">
						<label class="text-xs" for="minWordFreq"
							>Min token frequency:</label
						>
						<input
							id="minWordFreq"
							type="number"
							min="1"
							bind:value={minWordFreq}
							class="w-16 p-1 border rounded text-sm"
						/>
						<span class="text-gray-400"
							>(hide very rare tokens)</span
						>
					</div>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<label
					for="customStopwords"
					class="text-xs font-bold uppercase text-gray-400"
					>Custom Stopwords</label
				>
				<input
					id="customStopwords"
					type="text"
					bind:value={customStopwordsText}
					placeholder="comma, separated, words"
					class="w-full p-2 text-sm border rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
				/>
				<p class="text-xs text-gray-400">
					Words to exclude from analysis.
				</p>
			</div>

			<!-- Process Button (Error source is here) -->
			<button
				on:click={runAnalysis}
				disabled={$appState.isProcessing ||
					!textAreaValue.trim() ||
					wordCount > maxWordLimit}
				class="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold rounded-lg shadow transition-colors flex justify-center items-center gap-2"
			>
				{#if $appState.isProcessing}
					<svg
						class="animate-spin h-5 w-5 text-white"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle
							class="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
					{progressMessage || "Processing..."}
				{:else}
					Generate Taxonomy
				{/if}
			</button>

			<!-- Word Cloud Button -->
			<button
				on:click={generateWordCloud}
				disabled={!textAreaValue.trim() || wordCount > maxWordLimit}
				class="w-full py-3 mt-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold rounded-lg shadow transition-colors flex justify-center items-center gap-2"
			>
				Give me a word cloud
			</button>

			<!-- Error Display -->
			{#if $appState.error}
				<div
					class="p-3 bg-red-100 text-red-700 text-sm rounded-lg border border-red-300"
				>
					<strong class="font-semibold">Analysis Error:</strong>
					{$appState.error}
				</div>
			{/if}

			<div class="prose text-sm mt-4 p-2">
				<h2>About the Tool</h2>
				<p>
					TinyTaxonomy uses Natural Language Processing (NLP), Term
					Frequency-Inverse Document Frequency (TF-IDF), and
					Agglomerative Hierarchical Clustering (AGNES) to discover
					the underlying semantic relationships in your text.
				</p>
				<p>
					TinyTaxonomy by <a
						href="https://lewisdryburgh.com"
						target="_blank"
						rel="noopener noreferrer">Lewis Dryburgh</a
					>
				</p>
			</div>
		</div>
	</aside>

	<!-- Main Canvas -->
	<main class="flex-1 p-4 relative overflow-hidden">
		{#if showWordCloud}
			<div
				class="flex flex-col items-center justify-center w-full h-full"
			>
				<div class="flex items-center gap-3 mb-2 w-full">
					<div class="flex-1"></div>
					<button
						class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded shadow text-sm"
						on:click={saveVisualisation}>Save Image</button
					>
				</div>
				<WordCloud words={wordCloudWords} />
			</div>
		{:else if $appState.data}
			<div class="flex items-center gap-3 mb-2">
				<div class="text-xs text-gray-500">Layout:</div>
				<select
					bind:value={layoutType}
					class="text-sm p-1 border rounded"
				>
					<option value="tree">Tree (left-right)</option>
					<option value="radial">Radial</option>
				</select>
				<div class="text-xs text-gray-500 ml-4">Show levels:</div>
				<input
					type="number"
					min="1"
					bind:value={maxVisibleLevels}
					class="w-16 p-1 border rounded text-sm"
				/>
				<button
					class="ml-auto px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded shadow text-sm"
					on:click={saveVisualisation}>Save Image</button
				>
				<button
					class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded shadow text-sm"
					on:click={exportJSON}>Export JSON</button
				>
			</div>
			<TaxonomyTree
				data={$appState.data}
				layout={layoutType}
				maxDepth={maxVisibleLevels}
			/>
		{:else}
			<div
				class="w-full h-full border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="60"
					height="60"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path
						d="M12 3v3m-4 4h8M5 16h14M8 10l-4 6h12l-4-6M12 3c-1.105 0-2 .895-2 2s.895 2 2 2 2-.895 2-2-.895-2-2-2z"
					/></svg
				>
				<p class="mt-4">
					Enter text and click generate to visualize the semantic
					structure.
				</p>
			</div>
		{/if}
	</main>
</div>
