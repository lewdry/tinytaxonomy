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
}

declare const self: Worker;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { text, mode } = e.data;

    try {
        const doc = nlp.readDoc(text); 
        let segments: string[] = [];
        let contextSegments: string[] = []; 

        if (mode === 'paragraph') {
            segments = text.split(/\n\n+/).filter((s) => s.trim().length > 0);
        } else if (mode === 'sentence') {
            segments = doc.sentences().out();
        } else if (mode === 'word') {
            // Build both stems (used for matching/clustering) and human-friendly labels
            // (choose the most common original token for each stem). This keeps
            // clustering accurate while ensuring the UI shows original words.
            const tokenCollection = doc.tokens().filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag));

            // arrays in same order for mapping
            const stemsAll: string[] = tokenCollection.out(its.stem);
            const normalsAll: string[] = tokenCollection.out(its.normal);

            // tabulate the most common normal form per stem
            const stemToCounts = new Map<string, Map<string, number>>();
            for (let i = 0; i < stemsAll.length; i++) {
                const s = stemsAll[i];
                const n = normalsAll[i];
                const inner = stemToCounts.get(s) ?? new Map<string, number>();
                inner.set(n, (inner.get(n) ?? 0) + 1);
                stemToCounts.set(s, inner);
            }

            const uniqueStems = [...new Set(stemsAll)];

            // For display choose the most frequent normal for each stem
            const labelsForDisplay = uniqueStems.map((s) => {
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
            
            // We'll use labelsForDisplay later by special-casing the call site below.
            
        }

        if (segments.length < 2) {
            self.postMessage({ type: 'error', error: 'Not enough data to cluster (need at least 2 segments/words). Try adding more text.' });
            return;
        }

        let matrix: any, labels: string[];
        if (mode === 'word') {
            // when in word mode we created `segments` (stems) and also computed
            // `labelsForDisplay` above. However, `labelsForDisplay` is scoped inside
            // the branch; read it again from tokenization so we can produce user-friendly
            // labels without changing clustering math.
            const tokenCollection = doc.tokens().filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag));
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
            const labelsForDisplay = uniqueStems.map((s) => {
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

            ({ matrix, labels } = calculateWordSimilarityMatrix(segments, contextSegments, labelsForDisplay));
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

        return {
            name: `Cluster (H:${heightValue !== null ? heightValue.toFixed(2) : 'N/A'})`,
            // passed through for UI usage
            height: heightValue,
            // small array of sample leaf labels
            sampleLeaves,
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
        return { name: name, fullText: fullText, value: 1, sampleLeaves: [fullText] };
    }
    
    return { name: '[Malformed Node]', fullText: 'Node structure missing index and children.', value: 1 };
}

// --- END: worker implementation ---
