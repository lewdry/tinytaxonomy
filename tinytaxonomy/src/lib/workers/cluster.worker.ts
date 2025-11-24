import * as winkModule from 'wink-nlp'; 
import * as modelModule from 'wink-eng-lite-web-model';
// FIX 1: Change to wildcard import for ml-hclust to resolve 'Importing binding name agnes is not found.'
// @ts-ignore: Could not find declaration file for module 'ml-hclust'. This module is CJS and lacks modern types.
import * as hclustModule from 'ml-hclust'; 

// Use 'import type' for type-only imports
import type { WinkMethods } from 'wink-nlp'; 

// --- FIXES FOR CJS IMPORTS (Kept for wink-nlp/model) ---

/**
 * Helper function to robustly extract the callable function or data 
 * from a CJS module imported via `import * as`. This is maintained only 
 * for the wink-nlp and wink-eng-lite-web-model packages.
 */
const cjsInterop = (module: any) => {
    // 1. Check if the module object itself is the callable function/data.
    if (typeof module === 'function') return module;
    
    // 2. Check for the common `.default` property.
    if (module && typeof module === 'object' && typeof module.default !== 'undefined') {
        return module.default;
    }
    
    return module; // Fallback to the module object itself
};

// 1. Define the wink factory function
const winkFactory: any = cjsInterop(winkModule);

// 2. Define the model data object
const model: any = cjsInterop(modelModule);

// FIX 2: Define 'agnes' by applying CJS interop to the wildcard import result.
// If the library exports agnes as its default, this will work. If not, the fallback
// is often to access it directly as hclustModule.agnes, but we rely on your interop logic first.
const agnes: any = cjsInterop(hclustModule);

// --- TYPE & INITIALIZATION ---

// 1. Initialize the NLP instance.
const nlp: any = (winkFactory as Function)(model);

// 2. Access constants (its) from the initialized instance.
const its = nlp.its; 

// Types for communication
type Mode = 'paragraph' | 'sentence' | 'word';
interface WorkerMessage {
    text: string;
    mode: Mode;
}

// Declare 'self' to be a Worker environment for TypeScript
declare const self: Worker;

// --- WORKER ENTRY POINT ---

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { text, mode } = e.data;

    try {
        // 1. Segment Text
        // FIX: Replaced nlp.read(text) with nlp.readDoc(text) based on debug logs
        const doc = nlp.readDoc(text); 
        let segments: string[] = [];
        let contextSegments: string[] = []; 

        if (mode === 'paragraph') {
            segments = text.split(/\n\n+/).filter((s) => s.trim().length > 0);
        } else if (mode === 'sentence') {
            segments = doc.sentences().out();
        } else if (mode === 'word') {
            // Get unique, stemmed, non-stop words as items to be clustered (segments)
            // Explicitly typing 't' as 'any' for the Wink token object
            segments = doc.tokens().filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag)).out(its.stem);
            segments = [...new Set(segments)]; 
            // Context for word clustering is the original sentences
            contextSegments = doc.sentences().out();
        }

        if (segments.length < 2) {
            self.postMessage({ type: 'error', error: 'Not enough data to cluster (need at least 2 segments/words). Try adding more text.' });
            return;
        }

        // 2. Calculate TF-IDF & Distance Matrix
        // The labels are the original text segments or the unique words
        const { matrix, labels } =
            mode === 'word'
                ? calculateWordSimilarityMatrix(segments, contextSegments)
                : calculateSegmentSimilarityMatrix(segments);

        // 3. Hierarchical Clustering (AGNES)
        // Now calling the correctly imported 'agnes' function
        const clusterResult = agnes(matrix, { 
            method: 'average', // UPGMA is a good general-purpose linkage
            isDistanceMatrix: true
        });
        
        // 4. Convert to D3 Tree Format
        const tree = convertToD3(clusterResult, labels);

        self.postMessage({ type: 'success', data: tree });
    } catch (err) {
        self.postMessage({ type: 'error', error: err instanceof Error ? err.message : 'Unknown clustering or NLP error' });
    }
};

// --- CORE MATH LOGIC HELPERS ---

/**
 * Calculates similarity matrix for clustering segments (sentences/paragraphs).
 * Uses TF-IDF for vector representation and Cosine Distance for similarity.
 */
function calculateSegmentSimilarityMatrix(segments: string[]) {
    // 1. Tokenize and Stem all segments
    const tokenizedSegments = segments.map((seg) => {
        const doc = nlp.readDoc(seg); 
        // Explicitly typing 't' as 'any' for the Wink token object
        return doc
            .tokens()
            .filter((t: any) => t.out(its.type) === 'word' && !t.out(its.stopWordFlag))
            .out(its.stem);
    });

    // 2. Build Vocabulary
    const vocabulary = [...new Set(tokenizedSegments.flat())];

    // 3. Create TF-IDF Vectors
    const vectors = tokenizedSegments.map((segTokens: string[]) => calculateTfIdfVector(segTokens, tokenizedSegments, vocabulary));

    // 4. Calculate Pairwise Cosine Distance
    const matrix = calculateDistanceMatrix(vectors);

    return { matrix, labels: segments };
}

/**
 * Calculates similarity matrix for clustering words based on context (sentences).
 * Uses Binary Term Frequency (presence in context sentence) and Cosine Distance.
 */
function calculateWordSimilarityMatrix(words: string[], contexts: string[]) {
    // Cluster words (rows) based on their presence in sentence contexts (columns).
    const tokenizedContexts = contexts.map((ctx) => {
        const doc = nlp.readDoc(ctx); 
        // Explicitly typing 't' as 'any'. No stop word removal here as stop words still provide context.
        return doc.tokens().filter((t: any) => t.out(its.type) === 'word').out(its.stem); 
    });

    // Vectorize: For each Word, create a vector representing its presence in each Context
    const vectors = words.map((word) => {
        // Vector value is 1 if the word (stem) appears in the context (stemmed array), 0 otherwise (Binary TF).
        return tokenizedContexts.map((ctxTokens) => (ctxTokens.includes(word) ? 1 : 0));
    });

    // Calculate distance matrix between word vectors
    const matrix = calculateDistanceMatrix(vectors);
    return { matrix, labels: words }; 
}

/**
 * Generates a TF-IDF vector for a single document (segment).
 */
function calculateTfIdfVector(tokens: string[], allDocs: string[][], vocab: string[]): number[] {
    const N = allDocs.length;
    // Handle empty document case
    if (tokens.length === 0) return vocab.map(() => 0); 
    
    return vocab.map((term) => {
        // TF (Term Frequency)
        const tf = tokens.filter((t) => t === term).length / tokens.length;
        if (tf === 0) return 0;

        // IDF (Inverse Document Frequency)
        const docsWithTerm = allDocs.filter((d) => d.includes(term)).length;
        // 1 is added to the denominator (Laplace smoothing)
        const idf = Math.log10(N / (1 + docsWithTerm)); 

        return tf * idf;
    });
}

/**
 * Computes the pairwise cosine distance matrix (1 - similarity) for a set of vectors.
 */
function calculateDistanceMatrix(vectors: number[][]): number[][] {
    const n = vectors.length;
    const matrix = Array(n).fill(0).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            if (i === j) {
                matrix[i][j] = 0;
            } else {
                const sim = cosineSimilarity(vectors[i], vectors[j]);
                // Distance = 1 - Similarity. Clamped at 0 for safety.
                const dist = Math.max(0, 1 - sim); 
                matrix[i][j] = dist;
                matrix[j][i] = dist; // Matrix is symmetric
            }
        }
    }
    return matrix;
}

/**
 * Computes the cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    // Handle division by zero
    if (magA === 0 || magB === 0) return 0; 
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// --- TREE CONVERSION HELPER ---

/**
 * Converts the ml-hclust linkage object into a recursive D3-compatible JSON tree.
 */
function convertToD3(node: any, labels: string[]): any {
    // Cluster node: Check if children exist. This is the root node or any intermediate cluster.
    // We prioritize checking for children over checking the index for a cluster.
    if (node.children && node.children.length > 0) {
        // Cluster node (children are defined and index is irrelevant/negative)
        const childrenCount = node.children.length;
        // The root node itself should be a cluster that contains all data.
        return {
            name: `Cluster (H:${node.height?.toFixed(2) || 'N/A'})`, 
            children: node.children.map((child: any) => convertToD3(child, labels))
        };
    }
    
    // Leaf node: Must have a defined index (0 or greater).
    if (node.index !== undefined) {
        // Check for invalid index (like -1). If the index is negative or out of bounds, it's an error leaf.
        if (node.index < 0 || node.index >= labels.length) {
            return { 
                name: `[Error: Index ${node.index}]`,
                fullText: `Invalid index from clustering. Data may be too sparse or uniform.`, 
                value: 1 
            };
        }
        
        // Valid leaf node (index is 0 or greater)
        const rawText = labels[node.index];
        const fullText = rawText !== undefined && rawText !== null ? rawText : `[Missing Label for Index ${node.index}]`;
        
        // Truncate the name for display in the tree, keep fullText for the tooltip
        const name = fullText.length > 40 ? fullText.substring(0, 37) + '...' : fullText;
        return { name: name, fullText: fullText, value: 1 };
    }
    
    // Fallback case (should not happen in correct output)
    return { name: '[Malformed Node]', fullText: 'Node structure missing index and children.', value: 1 };
}