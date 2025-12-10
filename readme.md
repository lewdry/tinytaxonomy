# TinyTaxonomy

TinyTaxonomy is a privacy-first, client-side, static web app for exploring the semantic structure of text. It turns raw text into an interactive hierarchical visualization (a taxonomy/dendrogram) using client-side NLP and hierarchical clustering, all without needing a backend.

Highlights
- Browser-only processing (no backend required) — good for privacy and cost savings
- Interactive hierarchical visualizations (zoom/pan/collapse, tooltips)
- Built with SvelteKit, D3, Web Workers and lightweight NLP & clustering libraries

## Tech stack
- Framework: SvelteKit
- Styling: Tailwind CSS
- NLP: wink-nlp (lightweight browser-friendly models) + compromise.js (lemmatization & noun phrases)
- Math / Clustering: ml-hclust (+ supporting matrix utilities)
- Visualization: D3 (hierarchies / dendrograms)
- Worker model: Web Workers to perform expensive calculations off the main thread

Export to Sheets
## What it does
1. Parse and clean text (paragraph/sentence/word modes)
2. Convert segments into TF-IDF vectors
3. Compute pairwise distances (cosine distance)
4. Run agglomerative hierarchical clustering
5. Render an interactive, collapsible taxonomy tree using D3

Key user features
- Paste or load text input
- Choose analysis mode: paragraph, sentence, or keyword (word) view
- Interactive tree: zoom, pan, collapse branches, tooltips for full text
- All heavy work runs inside a Web Worker for a responsive UI
3.2. Analysis Logic (The Pipeline)
The application acts as a pipeline that transforms Text → Vectors → Distance Matrix → Tree.
## Architecture & data flow
4.1. Directory Structure
Plaintext

src/
├── lib/
│ ├── components/        # Svelte components (TaxonomyTree.svelte, controls, inputs)
│ ├── workers/           # Web Worker(s) for clustering & vector calculations
│ └── stores/            # App state and stores
├── routes/              # SvelteKit routes
└── app.html
4.2. The Web Worker Pipeline (cluster.worker.ts)
The worker listens for a message: { text: string, mode: 'word'|'sentence'|'paragraph' }.

The worker also accepts an optional `options` object in its message (useful for pre-filtering in word mode):

```js
// noun-only + min frequency (word mode)
worker.postMessage({ text, mode: 'word', options: { nounOnly: true, minWordFreq: 2 } });

// enhanced pipeline options (paragraph/sentence modes)
worker.postMessage({ text, mode: 'paragraph', options: {
  enableEnhancedPipeline: true,   // Use enhanced NLP (default: true)
  enableLemmatization: true,       // "idioms" → "idiom", "analyses" → "analysis"
  enableNgrams: true,              // Detect bigrams/trigrams like "semantic_analysis"
  minNgramFreq: 2,                 // Min occurrences to keep an n-gram
  nounPhraseBoost: 1.3,            // Weight boost for noun phrases
  glueWordPenalty: 0.5,            // Penalty for over-connecting words
  normalizeVectors: true,          // L2 normalize TF-IDF vectors
  enableAutoCutoff: true,          // Auto-cut dendrogram at natural boundaries
  cutoffPercentile: 0.85           // Percentile for dendrogram cutoff
}});
```
Step 1: Segmentation & Cleaning
Use wink-nlp to parse the doc.

If Mode = Paragraph: Split by \n\n.
If Mode = Sentence: Use doc.sentences().out().
If Mode = Word: Use doc.sentences().out() (we still need sentences to establish context for word similarity).
Cleaning: Remove stop-words, punctuation, and apply stemming (Snowball stemmer recommended).

Step 1.5: Enhanced NLP Pipeline (Optional, enabled by default)
The enhanced pipeline applies additional preprocessing for better semantic grouping:

- **Lemmatization** (via compromise.js): Reduces words to their base form — `"idioms"→"idiom"`, `"analyses"→"analysis"`, `"hierarchical"→"hierarchy"`. This pulls related word forms together.
- **N-gram detection**: Identifies significant multi-word phrases (bigrams/trigrams) that appear ≥2 times across the text. For example, `"semantic analysis"` becomes a single token `"semantic_analysis"` instead of two separate words.
- **Noun phrase extraction**: Detects noun phrases like `"hierarchical clustering"` and boosts their weight (default 1.3×).
- **Glue word penalty**: Reduces the influence of over-connecting words like `"process"`, `"level"`, `"relationship"`, `"structure"` (default 0.5× penalty).

Step 2: Vectorization (TF-IDF)
Convert segments into numerical vectors.

Build a Vocabulary: List of all unique stemmed/lemmatized words (plus detected n-grams).
Build the Term-Document Matrix:
Rows = Segments.
Cols = Unique Words.
Values = TF-IDF Score (optionally weighted by noun phrase boost / glue word penalty).

**Vector Normalization** (optional, enabled by default): L2 normalize each vector to unit length. This prevents long paragraphs from dominating the similarity calculations purely due to their length.
Step 3: The "Matrix Logic" (The Toggle Implementation)
Paragraph/Sentence Mode: Use the matrix as is. We are comparing Rows (Segments) against each other.
Word Mode: Transpose the matrix. Rows become Words, Cols become Segments. We are comparing Words based on the contexts (segments) they appear in.
Step 4: Distance Calculation
Compute the Cosine Distance (1−CosineSimilarity) between every pair of rows.

Output: A symmetric Distance Matrix (Size N×N).
Step 5: Hierarchical Clustering
Input the Distance Matrix into ml-hclust.

Algorithm: Agglomerative.
Linkage Method: average (UPGMA) or complete.
Output: A linkage object.
Step 6: Tree Generation
Convert the linkage object into a recursive JSON structure compatible with D3:
JSON

{
"name": "root",
"children": [
{ "name": "Cluster A", "children": [...] },
{ "name": "Leaf Node (The Sentence or Word)", "value": 1 }
]
}

Step 6.5: Dendrogram Cutoff (Optional, enabled by default)
Instead of forcing a single root that merges all clusters at arbitrarily high distances:

- **Compute the merge height distribution** across all internal nodes
- **Auto-select a cutoff** at the 85th percentile (configurable) or at the first significant "gap" in the height distribution
- **Produce multiple top-level clusters** when nodes above the cutoff would otherwise weakly connect unrelated branches

This gives a cleaner, more interpretable taxonomy where unrelated concepts remain separate instead of being artificially merged.
## Implementation details (high level)

The main pipeline implemented in a worker is:

- Tokenize & clean segments (wink-nlp)
- Build vocabulary and TF-IDF vectors
- Compute distance matrix (1 - cosine similarity)
- Run hierarchical clustering (ml-hclust)
- Convert the linkage to a D3-compatible hierarchy and render

See `src/lib/workers/cluster.worker.ts` for the current worker implementation.

### Recent visualization & UX improvements

The app now includes the following quality-of-life and readability improvements (implemented in the UI + worker):

- Consistent branch colors: top-level branches are mapped to distinct categorical colours so related items keep the same colour across the graph.
- Cluster labels: internal cluster nodes now expose a short human-friendly label (top 2–3 representative keywords) instead of a generic "Cluster (H:...)" name. Tooltips still show example members.
- Shapes for node types: leaves use small circles; clusters use a diamond glyph so clusters immediately stand out.
- Collapsible branches: double-click a cluster (diamond) to fold/unfold that branch and reduce visual clutter.
- Distance indicators: internal nodes show a small horizontal bar that visualizes merge distance (H) and links vary slightly in stroke width by merge strength.
- Radial layout: a radial dendrogram option (Layout dropdown) lets you arrange the taxonomy in rings from the root → leaves, which reduces cross-overs and better preserves semantic grouping.
- Noise reduction controls: the UI exposes a "noun-only" toggle and a minimum token frequency filter in word mode so stopwords, function words and rare tokens can be hidden before clustering.

### Enhanced NLP Pipeline

The app includes an upgraded NLP pipeline (enabled by default) that significantly improves clustering quality:

| Feature | What it does | Why it helps |
|---------|--------------|--------------|
| **Lemmatization** | `"idioms"→"idiom"`, `"analyses"→"analysis"` | Related word forms cluster together |
| **N-gram detection** | `"semantic analysis"` → `"semantic_analysis"` | Multi-word concepts treated as single units |
| **Noun phrase boost** | Weight × 1.3 for detected noun phrases | Important concepts get higher influence |
| **Glue word penalty** | Weight × 0.5 for generic words (`process`, `level`, etc.) | Reduces spurious connections |
| **Vector normalization** | L2 normalize TF-IDF vectors | Long paragraphs don't dominate |
| **Dendrogram cutoff** | Auto-cut at 85th percentile or first gap | Cleaner multi-root taxonomy |

The enhanced pipeline uses [compromise.js](https://github.com/spencermountain/compromise) for lightweight client-side lemmatization and noun phrase extraction.

Default behavior and input limits
- The default Min Token Frequency in the UI is now 1 (so very-low-frequency tokens are kept by default). You can raise this to remove noise during word-mode clustering.
- Input safety: to prevent slow or runaway client processing the UI enforces a 5,000-word limit. If your input exceeds this the app will show an error and refuse to start processing — split large text into smaller parts or summarize first.

These changes are aimed at shifting the visualization away from a sea of unlabeled dots into a readable, explorable taxonomy with meaningful labels and interaction.
5.1. Handling TF-IDF (Client-Side)
Since we don't have Python's scikit-learn, we implement a lightweight vectorizer.
TypeScript

// Helper to calculate TF-IDFfunction calculateTfIdf(docs: string[][], vocabulary: string[]): number[][] {
const N = docs.length;
const matrix: number[][] = [];

// 1. Calculate IDF for each word in vocab
const idfMap = new Map<string, number>();
vocabulary.forEach(term => {
const docsWithTerm = docs.filter(d => d.includes(term)).length;
idfMap.set(term, Math.log10(N / (1 + docsWithTerm)));
});

// 2. Calculate TF-IDF Vectors
docs.forEach(doc => {
const vector = vocabulary.map(term => {
const tf = doc.filter(t => t === term).length / doc.length;
const idf = idfMap.get(term) || 0;
return tf * idf;
});
matrix.push(vector);
});

return matrix;
}
5.2. Svelte D3 Action
Use a Svelte Action to bind D3 to a DOM element lifecycle.
JavaScript

// lib/actions/dendrogram.jsimport * as d3 from 'd3';export function dendrogram(node, data) {
function update(hierarchyData) {
// Clear SVG
d3.select(node).selectAll('*').remove();
// Setup D3 Tree
const root = d3.hierarchy(hierarchyData);
const cluster = d3.cluster().size([height, width]); // or d3.tree()
// ... Render nodes and links ...
}

update(data);

return {
update(newData) {
update(newData); // Re-render when data prop changes
}
};
}
## Performance & practical limits
Processing and clustering are O(N^2) in the number of input segments (distance matrix). The app uses these mitigations:

- Limit the number of segments for client processing (e.g., use sampling or truncation)
- Offload expensive computation to Web Workers
- Display progress and allow cancellation
Visualization Clutter: Tree becomes unreadable with long sentences as nodes.Truncate labels in the tree (e.g., "The quick brown fox...") but show full text in a Tooltip or side panel on hover.Cluster Naming: The algorithm groups items but doesn't name the group.Implement a "Representative Keyword" extractor. For every branch, find the top 3 high TF-IDF words and use them as the branch label.
Export to Sheets
## Getting started
This repository contains the TinyTaxonomy app. The working SvelteKit app lives under the `tinytaxonomy/` folder.

Quick start (app directory: `tinytaxonomy`)

```bash
# from the repository root
cd tinytaxonomy/tinytaxonomy
npm install
npm run dev
```

Common scripts

- `npm run dev` — start the dev server (Vite)
- `npm run build` — build a production bundle
- `npm run preview` — locally preview the production build
- `npm run check` — run TypeScript / svelte-check
- `npm run lint` — run Prettier + ESLint checks
- `npm run format` — auto-format the codebase
Phase 1: Skeleton (Day 1-2)
Set up SvelteKit + Tailwind.
Set up the Web Worker boilerplate.
Get wink-nlp running to simply log tokenized output to the console.
Phase 2: The Math (Day 3-4)
Implement TF-IDF and Distance Matrix in the worker.
Integrate ml-hclust.
Verify logic by checking if similar sentences actually group together in the console logs.
Phase 3: Visualization (Day 5-6)
Build the TaxonomyTree.svelte component.
Connect the Worker output to the D3 render.
## Contributing
Contributions are welcome! If you'd like to help:

1. Open an issue to discuss feature ideas or bugs
2. Create a branch: `git checkout -b feat/your-feature`
3. Add tests / lint + format your code
4. Open a PR when ready

## License

This project is licensed under the MIT License — see the `LICENSE` file for details.

Copyright (c) 2025 Lewis Dryburgh

Tips
- Keep heavy processing out of the main thread (use a Worker)
- Add small sample text inputs for reproducible testing
## Where to look next
- Worker: `src/lib/workers/cluster.worker.ts` (main worker entry)
- Worker implementation: `src/lib/workers/cluster.worker.impl.ts` (clustering logic)
- Enhanced NLP utilities: `src/lib/utils/nlpEnhanced.ts` (lemmatization, n-grams, weighting)
- Math utilities: `src/lib/utils/math.ts` (TF-IDF, distance matrix, vector normalization)
- Main visualization component: `src/lib/components/TaxonomyTree.svelte`
- App state: `src/lib/stores/appState.ts`