// Implementation moved here so the top-level `cluster.worker.ts` can setup
// a small browser-compatible `process` shim before this file runs.

export {};

// --- BEGIN: worker implementation (moved) ---
import * as winkModule from 'wink-nlp'; 
import * as modelModule from 'wink-eng-lite-web-model';
// FIX 1: Change to wildcard import for ml-hclust to resolve 'Importing binding name agnes is not found.'
// @ts-ignore: Could not find declaration file for module 'ml-hclust'. This module is CJS and lacks modern types.
import * as hclustModule from 'ml-hclust'; 

// Use 'import type' for type-only imports
import type { WinkMethods } from 'wink-nlp'; 

// --- FIXES FOR CJS IMPORTS (Kept for wink-nlp/model) ---

const cjsInterop = (module: any) => {
    if (typeof module === 'function') return module;
    if (module && typeof module === 'object' && typeof module.default !== 'undefined') {
        return module.default;
    }
    return module;
};

const winkFactory: any = cjsInterop(winkModule);
const model: any = cjsInterop(modelModule);
const _hclust = cjsInterop(hclustModule);
// ml-hclust exports an object { agnes, diana } rather than being a function
// itself. Pick the `agnes` export if present, otherwise fallback to default.
const agnes: any = typeof _hclust === 'function' ? _hclust : (_hclust.agnes ?? _hclust.default ?? _hclust);

const nlp: any = (winkFactory as Function)(model);
const its = nlp.its; 

type Mode = 'paragraph' | 'sentence' | 'word';
interface WorkerMessage {
    text: string;
    mode: Mode;
    options?: {
        // word-mode filters
        nounOnly?: boolean;
        minWordFreq?: number; // minimum count across document to keep a word
        // segment-mode controls
        minTfIdf?: number; // not yet used — placeholder for future filtering
    };
}

declare const self: Worker;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { text, mode, options = {} } = e.data;

    try {
        const doc = nlp.readDoc(text); 
        let segments: string[] = [];
        let contextSegments: string[] = []; 
        // persistent display labels for word-mode (respect filters) — used by later stages
        let labelsForDisplayGlobal: string[] | undefined = undefined;

        if (mode === 'paragraph') {
            segments = text.split(/\n\n+/).filter((s) => s.trim().length > 0);
        } else if (mode === 'sentence') {
            segments = doc.sentences().out();
        } else if (mode === 'word') {
            // Build both stems (used for matching/clustering) and human-friendly labels
            // (choose the most common original token for each stem). This keeps
            // clustering accurate while ensuring the UI shows original words.
            // collect tokens but apply base filters (non-stop words, words only)
            const tokenCollection = doc.tokens().filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag));

            // arrays in same order for mapping
            let stemsAll: string[] = tokenCollection.out(its.stem);
            let normalsAll: string[] = tokenCollection.out(its.normal);
            const posAll: string[] = tokenCollection.out(its.pos);

            // tabulate the most common normal form per stem
            const stemToCounts = new Map<string, Map<string, number>>();
            for (let i = 0; i < stemsAll.length; i++) {
                const s = stemsAll[i];
                const n = normalsAll[i];
                const inner = stemToCounts.get(s) ?? new Map<string, number>();
                inner.set(n, (inner.get(n) ?? 0) + 1);
                stemToCounts.set(s, inner);
            }

            // optionally filter by POS (keep nouns only) or by global frequency
            if (options.nounOnly) {
                const nounFiltered: string[] = [];
                const normalsFiltered: string[] = [];
                for (let i = 0; i < stemsAll.length; i++) {
                    const pos = posAll[i] ?? '';
                    // keep token if POS appears to be noun-like (POS string starting with N)
                    if (/^N/i.test(pos)) {
                        nounFiltered.push(stemsAll[i]);
                        normalsFiltered.push(normalsAll[i]);
                    }
                }
                stemsAll = nounFiltered;
                normalsAll = normalsFiltered;
            }

            // count stems and optionally enforce minWordFreq
            const stemCounts = new Map<string, number>();
            for (const s of stemsAll) stemCounts.set(s, (stemCounts.get(s) ?? 0) + 1);

            const minFreq = typeof options.minWordFreq === 'number' ? Math.max(1, options.minWordFreq) : 1;
            const uniqueStems = [...new Set(stemsAll)].filter((s) => (stemCounts.get(s) ?? 0) >= minFreq);

            // For display choose the most frequent normal for each stem
            labelsForDisplayGlobal = uniqueStems.map((s) => {
                const counts = stemToCounts.get(s)!;
                let best = '';
                let bestCount = -1;
                for (const [normal, c] of counts) {
                    if (c > bestCount) {
                        best = normal;
                        bestCount = c;
                    }
                }
                return best;
            });
                        // For word mode we keep a persistently-scoped display labels array so
                        // later stages can use the exact labels that respected filtering.

            // segments will hold the stems (for matching) but we keep labelsForDisplay
            // and pass contexts so we can compute co-occurrence vectors
            segments = uniqueStems; 
            contextSegments = doc.sentences().out();

            // store a helper mapping on the doc for downstream use (return labels along with matrix)
            // We'll attach temporarily to the worker message flow via a short tuple returned
            // from calculateWordSimilarityMatrix later.
            // keep a small in-scope variable to pass labels to calculateWordSimilarityMatrix
            // by wrapping the call where needed — done below.
            // Using a closure variable here requires changing how calculateWordSimilarityMatrix is called.
            // We'll instead keep a reference in this scope (labelsForDisplay) and branch where used.
            
            // We'll use labelsForDisplayGlobal later by special-casing the call site below.
            
        }

        if (segments.length < 2) {
            self.postMessage({ type: 'error', error: 'Not enough data to cluster (need at least 2 segments/words). Try adding more text.' });
            return;
        }

        let matrix: any, labels: string[];
        if (mode === 'word') {
            // Use the previously computed `segments` and `labelsForDisplay` which
            // respect the noun-only and min-frequency filters. Avoid re-tokenizing
            // the whole doc here (that previously reintroduced verbs).
            // `segments` already contains the stems we will use for matching, and
            // the surrounding `labelsForDisplay` (if created in the branch above)
            // should be present; otherwise fall back to a sensible default.
            const tokenCollection = doc.tokens().filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag));
            // If a labelsForDisplay array was created earlier in the branch scope it will be available
            // as the computed variable; but to be safe, fall back to using the unique stems derived
            // from the current tokenization only when labelsForDisplay isn't present.
            let labelsForDisplayFallback: string[] | undefined = undefined;
            try {
                const stemsAll: string[] = tokenCollection.out(its.stem);
                const normalsAll: string[] = tokenCollection.out(its.normal);
                const stemToCounts = new Map<string, Map<string, number>>();
                for (let i = 0; i < stemsAll.length; i++) {
                    const s = stemsAll[i];
                    const n = normalsAll[i];
                    const inner = stemToCounts.get(s) ?? new Map<string, number>();
                    inner.set(n, (inner.get(n) ?? 0) + 1);
                    stemToCounts.set(s, inner);
                }
                const uniqueStems = [...new Set(stemsAll)];
                labelsForDisplayFallback = uniqueStems.map((s) => {
                    const counts = stemToCounts.get(s)!;
                    let best = '';
                    let bestCount = -1;
                    for (const [normal, c] of counts) {
                        if (c > bestCount) {
                            best = normal;
                            bestCount = c;
                        }
                    }
                    return best;
                });
            } catch (err) {
                // fallback: if anything goes wrong, use the stem strings themselves
                labelsForDisplayFallback = segments.slice();
            }

            // Prefer the earlier labelsForDisplay (if computed in the word branch
            // above) — otherwise use the fallback we just constructed.
            const labelsToUse = typeof labelsForDisplayGlobal !== 'undefined' ? labelsForDisplayGlobal : labelsForDisplayFallback!;

            ({ matrix, labels } = calculateWordSimilarityMatrix(segments, contextSegments, labelsToUse));
        } else {
            ({ matrix, labels } = calculateSegmentSimilarityMatrix(segments));
        }

        const clusterResult = agnes(matrix, { 
            method: 'average',
            isDistanceMatrix: true
        });
        
        const tree = convertToD3(clusterResult, labels);

        self.postMessage({ type: 'success', data: tree });
    } catch (err) {
        self.postMessage({ type: 'error', error: err instanceof Error ? err.message : 'Unknown clustering or NLP error' });
    }
};

function calculateSegmentSimilarityMatrix(segments: string[]) {
    const tokenizedSegments = segments.map((seg) => {
        const doc = nlp.readDoc(seg); 
        return doc
            .tokens()
            .filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag))
            .out(its.stem);
    });

    const vocabulary = [...new Set(tokenizedSegments.flat())];

    const vectors = tokenizedSegments.map((segTokens: string[]) => calculateTfIdfVector(segTokens, tokenizedSegments, vocabulary));

    const matrix = calculateDistanceMatrix(vectors);

    return { matrix, labels: segments };
}

function calculateWordSimilarityMatrix(words: string[], contexts: string[], labelsForDisplay?: string[]) {
    // `words` contains stems that should be used for matching. `labelsForDisplay`
    // is an optional array of user-friendly labels (same order as `words`) to use in
    // the UI. If not provided, fall back to showing the stem itself.
    const tokenizedContexts = contexts.map((ctx) => {
        const doc = nlp.readDoc(ctx); 
        return doc.tokens().filter((t: any) => t.out(its.type) === 'word').out(its.stem); 
    });

    const vectors = words.map((word) => {
        return tokenizedContexts.map((ctxTokens) => (ctxTokens.includes(word) ? 1 : 0));
    });

    const matrix = calculateDistanceMatrix(vectors);
    return { matrix, labels: labelsForDisplay ?? words };
}

function calculateTfIdfVector(tokens: string[], allDocs: string[][], vocab: string[]): number[] {
    const N = allDocs.length;
    if (tokens.length === 0) return vocab.map(() => 0); 
    
    return vocab.map((term) => {
        const tf = tokens.filter((t) => t === term).length / tokens.length;
        if (tf === 0) return 0;

        const docsWithTerm = allDocs.filter((d) => d.includes(term)).length;
        const idf = Math.log10(N / (1 + docsWithTerm)); 

        return tf * idf;
    });
}

function calculateDistanceMatrix(vectors: number[][]): number[][] {
    const n = vectors.length;
    const matrix = Array(n).fill(0).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            if (i === j) {
                matrix[i][j] = 0;
            } else {
                const sim = cosineSimilarity(vectors[i], vectors[j]);
                const dist = Math.max(0, 1 - sim); 
                matrix[i][j] = dist;
                matrix[j][i] = dist;
            }
        }
    }
    return matrix;
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0; 
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// global, worker-local node id counter used to give each node a stable id
let __worker_node_id_counter = 0;
function nextWorkerNodeId() {
    return ++__worker_node_id_counter;
}

function convertToD3(node: any, labels: string[]): any {
    // Helper to build a sample list of leaf labels under a node (bounded size)
    function collectSampleLeaves(n: any, out: string[], limit = 5) {
        if (out.length >= limit) return;
        if (n.children && n.children.length > 0) {
            for (const c of n.children) {
                collectSampleLeaves(c, out, limit);
                if (out.length >= limit) break;
            }
        } else if (n.index !== undefined && n.index >= 0 && n.index < labels.length) {
            out.push(labels[n.index]);
        }
    }

    if (node.children && node.children.length > 0) {
        const childrenConverted = node.children.map((child: any) => convertToD3(child, labels));

        // Prefer an explicit numeric height if present; fall back to other common names.
        const rawHeight = node.height ?? node.distance ?? node.dist ?? null;
        const heightValue = typeof rawHeight === 'number' ? rawHeight : null;

        // Sample up to 5 leaf labels contained in this cluster so the UI can preview members
        const sampleLeaves: string[] = [];
        collectSampleLeaves(node, sampleLeaves, 5);

        // Collect all leaf texts (no sample limit) to compute representative keywords
        const allLeaves: string[] = [];
        (function collectAll(n2: any) {
            if (n2.children && n2.children.length) return n2.children.forEach((c: any) => collectAll(c));
            if (n2.index !== undefined && n2.index >= 0 && n2.index < labels.length) allLeaves.push(labels[n2.index]);
        })(node);

        // compute representative keywords for this cluster using a lightweight TextRank
        // implementation. We prefer noun/adjective candidates; if none exist we fall
        // back to other tokens and add a small hint in the UI for non-noun tokens.
        const tokenBuckets: string[][] = [];
        const tokenPosByLeaf: string[][] = [];
        for (const leafText of allLeaves) {
            try {
                const doc = nlp.readDoc(leafText);
                const toks = doc.tokens().filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag));
                const normals: string[] = toks.out(its.normal);
                const poses: string[] = toks.out(its.pos);
                // collect per-node sequence and pos-array so we can build co-occurrence
                // graphs and prefer nouns/adjectives when building the label
                tokenBuckets.push(normals.filter((n: string) => n && n.length > 1));
                tokenPosByLeaf.push(poses);
            } catch (err) {
                // ignore tokenization errors for any given leaf
                tokenBuckets.push([]);
                tokenPosByLeaf.push([]);
            }
        }

        // Simple TextRank implementation — build co-occurrence graph over tokens
        function textRank(tokensList: string[][], posLists: string[][], windowSize = 3, d = 0.85, iterations = 20) {
            // build vocabulary
            const vocab = new Map<string, number>();
            for (const seq of tokensList) for (const t of seq) if (t && t.length > 1) if (!vocab.has(t)) vocab.set(t, vocab.size);
            const keys = [...vocab.keys()];
            const n = keys.length;
            if (!n) return [];

            // adjacency lists
            const adj = Array.from({ length: n }, () => new Set<number>());

            // fill co-occurrence edges using a sliding window per sequence
            for (const seq of tokensList) {
                for (let i = 0; i < seq.length; i++) {
                    const a = vocab.get(seq[i]);
                    if (a === undefined) continue;
                    for (let j = i + 1; j < Math.min(seq.length, i + 1 + windowSize); j++) {
                        const b = vocab.get(seq[j]);
                        if (b === undefined) continue;
                        if (a === b) continue;
                        adj[a].add(b);
                        adj[b].add(a);
                    }
                }
            }

            // initialize scores
            let scores = new Array(n).fill(1);

            for (let it = 0; it < iterations; it++) {
                const next = new Array(n).fill(1 - d);
                for (let i = 0; i < n; i++) {
                    if (adj[i].size === 0) continue;
                    let sum = 0;
                    for (const j of adj[i]) sum += scores[j] / (adj[j].size || 1);
                    next[i] += d * sum;
                }
                scores = next;
            }

            // map back to tokens with scores
            const scored = keys.map((k, i) => ({ token: k, score: scores[i] }));
            scored.sort((a, b) => b.score - a.score);
            return scored;
        }

        // Prefer noun/adjective candidates first for user-facing labels
        let candidates = textRank(tokenBuckets, tokenPosByLeaf, 3, 0.85, 18).map((s) => s.token);

        // Filter to nouns/adjectives when possible
        const nounCandidates: string[] = [];
        if (candidates.length) {
            for (const c of candidates) {
                // scan each leaf's tokens to find a matching pos for the candidate
                let foundPos: string | undefined = undefined;
                for (let li = 0; li < tokenBuckets.length; li++) {
                    const idx = (tokenBuckets[li] || []).indexOf(c);
                    if (idx >= 0) {
                        const pos = (tokenPosByLeaf[li] || [])[idx] ?? '';
                        foundPos = pos;
                        break;
                    }
                }
                if (foundPos && (/^N|^A/i).test(foundPos)) nounCandidates.push(c);
            }
        }

        const finalCandidates = nounCandidates.length ? nounCandidates : candidates;

        const keywords = finalCandidates.slice(0, 3);

        // If we didn't find noun-like candidates, add a small hint per token about POS
        const clusterLabel = keywords.length ? keywords.map((k) => {
            // find one occurrence and its pos
            let foundPos = '';
            for (let li = 0; li < tokenBuckets.length; li++) {
                const idx = (tokenBuckets[li] || []).indexOf(k);
                if (idx >= 0) { foundPos = (tokenPosByLeaf[li] || [])[idx] ?? ''; break; }
            }
            if (foundPos && !/^N/i.test(foundPos)) {
                // verbs -> show "to protect" style hint, adjectives -> mark (adj)
                if (/^V/i.test(foundPos)) return `${k} (to ${k})`;
                if (/^A/i.test(foundPos)) return `${k} (adj)`;
                return `${k} (${foundPos})`;
            }
            return k;
        }).join(' / ') : null;

        return {
            id: nextWorkerNodeId(),
            name: `Cluster (H:${heightValue !== null ? heightValue.toFixed(2) : 'N/A'})`,
            // passed through for UI usage
            height: heightValue,
            // small array of sample leaf labels
            sampleLeaves,
            // computed representative keywords (may be null)
            clusterKeywords: keywords,
            clusterLabel: clusterLabel,
            children: childrenConverted
        };
    }
    
    if (node.index !== undefined) {
        if (node.index < 0 || node.index >= labels.length) {
            return { 
                name: `[Error: Index ${node.index}]`,
                fullText: `Invalid index from clustering. Data may be too sparse or uniform.`, 
                value: 1 
            };
        }
        
        const rawText = labels[node.index];
        const fullText = rawText !== undefined && rawText !== null ? rawText : `[Missing Label for Index ${node.index}]`;
        
        const name = fullText.length > 40 ? fullText.substring(0, 37) + '...' : fullText;
        // Leaves are given a small sampleLeaves array so UI handling is uniform
        return { id: nextWorkerNodeId(), name: name, fullText: fullText, value: 1, sampleLeaves: [fullText] };
    }
    
    return { name: '[Malformed Node]', fullText: 'Node structure missing index and children.', value: 1 };
}

// --- END: worker implementation ---
