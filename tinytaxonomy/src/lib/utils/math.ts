export interface TfIdfOptions {
    tokenWeights?: Map<string, number>;  // Custom weights per term
    normalizeVector?: boolean;           // L2 normalize the result
}

export function calculateTfIdfVector(
    tokens: string[], 
    allDocs: string[][], 
    vocab: string[],
    options: TfIdfOptions = {}
): number[] {
    const { tokenWeights, normalizeVector = false } = options;
    const N = allDocs.length;
    if (tokens.length === 0) return vocab.map(() => 0);

    const vector = vocab.map((term) => {
        const tf = tokens.filter((t) => t === term).length / tokens.length;
        if (tf === 0) return 0;

        const docsWithTerm = allDocs.filter((d) => d.includes(term)).length;
        const idf = Math.log10(N / (1 + docsWithTerm));

        // Apply custom weight if provided
        const weight = tokenWeights?.get(term) ?? 1.0;
        
        return tf * idf * weight;
    });
    
    // L2 normalization to reduce paragraph length effects
    if (normalizeVector) {
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        if (magnitude > 0) {
            for (let i = 0; i < vector.length; i++) {
                vector[i] /= magnitude;
            }
        }
    }
    
    return vector;
}

export function calculateDistanceMatrix(vectors: number[][]): number[][] {
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

export function cosineSimilarity(a: number[], b: number[]): number {
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
