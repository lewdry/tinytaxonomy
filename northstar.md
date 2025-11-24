Project Blueprint: Tiny Taxonomy
1. Executive Summary
Tiyn Taxonomy is a client-side, static web application designed for the Information & Library Science (ILS) community. It analyzes raw text input and generates an interactive hierarchical visualization (taxonomy) to reveal the semantic structure of the document.
Unlike word clouds which show frequency, this tool uses hierarchical clustering to show relationships, grouping similar concepts, sentences, or sections together.
Key Constraints:

Zero Backend: All processing must happen in the user's browser (Privacy & Cost).
Static Hosting: Must be deployable to GitHub Pages or Cloudflare Pages.
Reactive UI: Built with Svelte/SvelteKit.
2. Technical Stack
ComponentTechnologyReasoningFrameworkSvelteKitHigh performance, small bundle size, built-in state management.Deployment@sveltejs/adapter-staticCompiles app to static HTML/JS for serverless hosting.NLPwink-nlpLightweight, browser-native NLP (better than natural for client-side).Math/MLml-matrix, ml-hclustEfficient matrix operations and clustering algorithms in JS.VisualizationD3.js (d3-hierarchy)The industry standard for rendering complex trees and dendrograms.StylesTailwind CSSRapid UI development.ConcurrencyWeb WorkersCRITICAL. Offloads heavy math to a background thread to prevent UI freezing.
Export to Sheets
3. Functional Requirements
3.1. User Interface
Input Area: A large text area for pasting raw text (support for 500–5,000 words).
Mode Toggle: A control to switch the "Atomic Unit" of analysis:
Sections (Paragraphs): Clusters blocks of text (Table of Contents view).
Statements (Sentences): Clusters specific claims (Argument mapping).
Keywords (Words): Clusters vocabulary (Thesaurus/Ontology generation).
Visualization Canvas: An interactive SVGs area.
Zoomable and Pannable.
Collapsible nodes (click to expand/hide branches).
Tooltip on hover showing the full text of the node.
3.2. Analysis Logic (The Pipeline)
The application acts as a pipeline that transforms Text → Vectors → Distance Matrix → Tree.
4. Architecture & Data Flow
4.1. Directory Structure
Plaintext

src/
├── lib/
│ ├── components/
│ │ ├── TaxonomyTree.svelte (D3 Visualization)
│ │ ├── InputPanel.svelte (Text area & Toggles)
│ │ └── Controls.svelte (Threshold sliders)
│ ├── workers/
│ │ └── cluster.worker.ts (The "Brain" - NLP & Math)
│ └── stores/
│ └── appState.ts (Manages data flow)
├── routes/
│ └── +page.svelte (Main layout)
└── app.html
4.2. The Web Worker Pipeline (cluster.worker.ts)
The worker listens for a message: { text: string, mode: 'word'|'sentence'|'paragraph' }.
Step 1: Segmentation & Cleaning
Use wink-nlp to parse the doc.

If Mode = Paragraph: Split by \n\n.
If Mode = Sentence: Use doc.sentences().out().
If Mode = Word: Use doc.sentences().out() (we still need sentences to establish context for word similarity).
Cleaning: Remove stop-words, punctuation, and apply stemming (Snowball stemmer recommended).
Step 2: Vectorization (TF-IDF)
Convert segments into numerical vectors.

Build a Vocabulary: List of all unique stemmed words.
Build the Term-Document Matrix:
Rows = Segments.
Cols = Unique Words.
Values = TF-IDF Score.
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
5. Implementation Details (Key Code Snippets)
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
6. Risks & Mitigations
RiskMitigation StrategyPerformance: Calculating N2
 distance matrix on large text will freeze the browser.1. Strict input limit (e.g., max 500 segments). 

2. Web Workers (Mandatory). 

3. Progress bar in UI during calculation.
Visualization Clutter: Tree becomes unreadable with long sentences as nodes.Truncate labels in the tree (e.g., "The quick brown fox...") but show full text in a Tooltip or side panel on hover.Cluster Naming: The algorithm groups items but doesn't name the group.Implement a "Representative Keyword" extractor. For every branch, find the top 3 high TF-IDF words and use them as the branch label.
Export to Sheets
7. Development Roadmap
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
Phase 4: Polish (Day 7)
Add the "Word/Sentence/Paragraph" toggle logic.
Add Zoom/Pan support.
Deploy to GitHub Pages.
📝 Note for the Developer
Testing: Use the "Lorem Ipsum" generator for performance testing, but use distinct wikipedia articles (e.g., one paragraph on Cats, one on Cars) to test the accuracy of the clustering.
Wink-NLP: Ensure you load the model correctly. It requires an async load step winkNLP(model).