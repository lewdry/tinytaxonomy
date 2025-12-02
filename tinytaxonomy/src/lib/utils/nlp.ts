// Simple TextRank implementation — build co-occurrence graph over tokens
export function textRank(tokensList: string[][], posLists: string[][], windowSize = 3, d = 0.85, iterations = 20) {
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
