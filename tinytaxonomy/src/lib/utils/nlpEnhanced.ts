/**
 * Enhanced NLP Pipeline
 * 
 * Improvements over base pipeline:
 * 1. Lemmatization via compromise.js (idioms→idiom, analyses→analysis)
 * 2. Bigram/trigram detection for multi-word concepts
 * 3. Noun phrase extraction and boosting
 * 4. Glue word penalty for over-connecting terms
 * 5. Vector normalization to reduce paragraph length effects
 * 6. Dendrogram cutoff for cleaner top-level clusters
 */

// @ts-ignore - compromise doesn't have perfect types
import nlpCompromise from 'compromise';

// ============================================================================
// TYPES
// ============================================================================

export interface EnhancedToken {
    text: string;           // Original text
    lemma: string;          // Lemmatized form
    pos: string;            // Part of speech
    isNounPhrase: boolean;  // Part of noun phrase?
    weight: number;         // Token weight (for TF-IDF boosting)
}

export interface NGram {
    tokens: string[];
    joined: string;         // underscore-joined form
    count: number;
    isNounPhrase: boolean;
}

export interface ProcessedDocument {
    originalText: string;
    tokens: EnhancedToken[];
    ngrams: NGram[];
    // Final vocabulary entries (lemmas + significant ngrams)
    vocabulary: string[];
}

export interface EnhancedPipelineOptions {
    // Lemmatization
    enableLemmatization?: boolean;
    
    // N-gram detection
    enableNgrams?: boolean;
    minNgramFreq?: number;      // Min occurrences to keep ngram (default: 2)
    maxNgramLength?: number;    // Max tokens in ngram (default: 3)
    
    // Weighting
    nounPhraseBoost?: number;   // Multiplier for noun phrases (default: 1.3)
    glueWordPenalty?: number;   // Penalty for glue words (default: 0.5)
    
    // Vector normalization
    normalizeVectors?: boolean;
    
    // Dendrogram cutoff
    enableAutoCutoff?: boolean;
    cutoffPercentile?: number;  // Percentile of heights to cut (default: 0.85)
}

// High-frequency "glue words" that over-connect unrelated segments
const GLUE_WORDS = new Set([
    'process', 'level', 'relationship', 'structure', 'element',
    'system', 'type', 'form', 'part', 'way', 'thing', 'aspect',
    'area', 'point', 'case', 'example', 'result', 'effect',
    'use', 'work', 'make', 'take', 'give', 'get', 'set',
    'number', 'amount', 'kind', 'sort', 'group', 'series'
]);

// ============================================================================
// LEMMATIZATION (via compromise.js)
// ============================================================================

/**
 * Lemmatize a single word using compromise.js
 */
export function lemmatize(word: string): string {
    const doc = nlpCompromise(word);
    
    // Try to get the root/infinitive form
    const verbs = doc.verbs();
    if (verbs.length) {
        return verbs.toInfinitive().text() || word.toLowerCase();
    }
    
    const nouns = doc.nouns();
    if (nouns.length) {
        return nouns.toSingular().text() || word.toLowerCase();
    }
    
    return word.toLowerCase();
}

/**
 * Process text and extract tokens with lemmas and POS tags
 */
export function tokenizeWithLemmas(text: string): EnhancedToken[] {
    const doc = nlpCompromise(text);
    const tokens: EnhancedToken[] = [];
    
    // Get all terms with their tags
    const terms = doc.terms().json();
    
    for (const term of terms) {
        if (!term.text || term.text.trim().length < 2) continue;
        
        const text = term.text.trim();
        const tags = term.tags || [];
        
        // Skip punctuation and numbers
        if (tags.includes('Punctuation') || tags.includes('Cardinal')) continue;
        
        // Determine POS
        let pos = 'OTHER';
        if (tags.includes('Noun') || tags.includes('Singular') || tags.includes('Plural')) {
            pos = 'NOUN';
        } else if (tags.includes('Verb') || tags.includes('PastTense') || tags.includes('Gerund')) {
            pos = 'VERB';
        } else if (tags.includes('Adjective')) {
            pos = 'ADJ';
        } else if (tags.includes('Adverb')) {
            pos = 'ADV';
        }
        
        // Get lemma
        let lemma = text.toLowerCase();
        if (term.normal) {
            lemma = term.normal;
        }
        
        // Use compromise's built-in lemmatization
        const termDoc = nlpCompromise(text);
        if (pos === 'VERB') {
            const inf = termDoc.verbs().toInfinitive().text();
            if (inf) lemma = inf.toLowerCase();
        } else if (pos === 'NOUN') {
            const sing = termDoc.nouns().toSingular().text();
            if (sing) lemma = sing.toLowerCase();
        }
        
        // Calculate base weight
        let weight = 1.0;
        
        // Penalize glue words
        if (GLUE_WORDS.has(lemma)) {
            weight *= 0.5;
        }
        
        tokens.push({
            text,
            lemma,
            pos,
            isNounPhrase: false,
            weight
        });
    }
    
    return tokens;
}

// ============================================================================
// NOUN PHRASE EXTRACTION
// ============================================================================

/**
 * Extract noun phrases from text using compromise.js
 */
export function extractNounPhrases(text: string): string[] {
    const doc = nlpCompromise(text);
    const phrases: string[] = [];
    
    // Get noun phrases
    const nounPhrases = doc.match('#Adjective? #Noun+').out('array');
    
    for (const phrase of nounPhrases) {
        const cleaned = phrase.toLowerCase().trim();
        if (cleaned.length > 2 && cleaned.split(/\s+/).length <= 4) {
            phrases.push(cleaned);
        }
    }
    
    return phrases;
}

/**
 * Mark tokens that are part of noun phrases and boost their weight
 */
export function markNounPhraseTokens(
    tokens: EnhancedToken[], 
    nounPhrases: string[],
    boost: number = 1.3
): EnhancedToken[] {
    const phraseSet = new Set(nounPhrases.map(p => p.toLowerCase()));
    
    // Build a map of lemma sequences for matching
    for (let i = 0; i < tokens.length; i++) {
        // Check 2-4 token sequences
        for (let len = 2; len <= 4 && i + len <= tokens.length; len++) {
            const sequence = tokens.slice(i, i + len).map(t => t.lemma).join(' ');
            
            if (phraseSet.has(sequence)) {
                // Mark all tokens in this phrase
                for (let j = i; j < i + len; j++) {
                    tokens[j].isNounPhrase = true;
                    tokens[j].weight *= boost;
                }
            }
        }
    }
    
    return tokens;
}

// ============================================================================
// N-GRAM DETECTION
// ============================================================================

/**
 * Detect significant bigrams and trigrams based on frequency
 */
export function detectNgrams(
    documents: string[][],  // Each doc is array of lemmas
    minFreq: number = 2,
    maxLen: number = 3
): NGram[] {
    const ngramCounts = new Map<string, { tokens: string[], count: number }>();
    
    for (const doc of documents) {
        // Track seen ngrams in this doc to avoid double-counting
        const seenInDoc = new Set<string>();
        
        for (let n = 2; n <= maxLen; n++) {
            for (let i = 0; i <= doc.length - n; i++) {
                const tokens = doc.slice(i, i + n);
                const key = tokens.join('_');
                
                if (!seenInDoc.has(key)) {
                    seenInDoc.add(key);
                    const existing = ngramCounts.get(key);
                    if (existing) {
                        existing.count++;
                    } else {
                        ngramCounts.set(key, { tokens, count: 1 });
                    }
                }
            }
        }
    }
    
    // Filter by minimum frequency
    const ngrams: NGram[] = [];
    for (const [joined, { tokens, count }] of ngramCounts) {
        if (count >= minFreq) {
            ngrams.push({
                tokens,
                joined,
                count,
                isNounPhrase: false  // Will be updated later
            });
        }
    }
    
    // Sort by count descending
    ngrams.sort((a, b) => b.count - a.count);
    
    return ngrams;
}

/**
 * Replace token sequences with ngrams in document
 */
export function applyNgramsToDocument(
    lemmas: string[],
    ngrams: NGram[]
): string[] {
    // Sort ngrams by length descending (prefer longer matches)
    const sortedNgrams = [...ngrams].sort((a, b) => b.tokens.length - a.tokens.length);
    
    const result: string[] = [];
    let i = 0;
    
    while (i < lemmas.length) {
        let matched = false;
        
        for (const ngram of sortedNgrams) {
            if (i + ngram.tokens.length <= lemmas.length) {
                const slice = lemmas.slice(i, i + ngram.tokens.length);
                if (slice.every((t, idx) => t === ngram.tokens[idx])) {
                    result.push(ngram.joined);
                    i += ngram.tokens.length;
                    matched = true;
                    break;
                }
            }
        }
        
        if (!matched) {
            result.push(lemmas[i]);
            i++;
        }
    }
    
    return result;
}

// ============================================================================
// ENHANCED TF-IDF WITH WEIGHTING
// ============================================================================

/**
 * Calculate TF-IDF with enhanced weighting
 */
export function calculateEnhancedTfIdf(
    docTokens: string[],
    allDocs: string[][],
    vocabulary: string[],
    tokenWeights: Map<string, number>,
    options: { normalizeVectors?: boolean } = {}
): number[] {
    const N = allDocs.length;
    if (docTokens.length === 0) return vocabulary.map(() => 0);
    
    const vector = vocabulary.map((term) => {
        // Term frequency
        const count = docTokens.filter(t => t === term).length;
        const tf = count / docTokens.length;
        if (tf === 0) return 0;
        
        // Inverse document frequency
        const docsWithTerm = allDocs.filter(d => d.includes(term)).length;
        const idf = Math.log10(N / (1 + docsWithTerm));
        
        // Apply custom weight if available
        const weight = tokenWeights.get(term) ?? 1.0;
        
        return tf * idf * weight;
    });
    
    // Optionally normalize vector length
    if (options.normalizeVectors) {
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        if (magnitude > 0) {
            for (let i = 0; i < vector.length; i++) {
                vector[i] /= magnitude;
            }
        }
    }
    
    return vector;
}

// ============================================================================
// DENDROGRAM CUTOFF
// ============================================================================

/**
 * Compute merge height distribution and suggest a cutoff
 */
export function computeDendrogramCutoff(
    heights: number[],
    percentile: number = 0.85
): { cutoff: number; heights: number[]; stats: { min: number; max: number; median: number; mean: number } } {
    if (heights.length === 0) {
        return { 
            cutoff: Infinity, 
            heights: [], 
            stats: { min: 0, max: 0, median: 0, mean: 0 } 
        };
    }
    
    const sorted = [...heights].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    const medianIdx = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[medianIdx - 1] + sorted[medianIdx]) / 2
        : sorted[medianIdx];
    
    // Find the cutoff at given percentile
    const cutoffIdx = Math.min(
        Math.floor(sorted.length * percentile),
        sorted.length - 1
    );
    const cutoff = sorted[cutoffIdx];
    
    return {
        cutoff,
        heights: sorted,
        stats: { min, max, median, mean }
    };
}

/**
 * Find significant "jumps" in merge heights to auto-detect natural cluster boundaries
 */
export function findHeightGaps(
    heights: number[],
    minGapRatio: number = 1.5
): number[] {
    if (heights.length < 2) return [];
    
    const sorted = [...heights].sort((a, b) => a - b);
    const gaps: { idx: number; ratio: number; height: number }[] = [];
    
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        
        if (prev > 0) {
            const ratio = curr / prev;
            if (ratio >= minGapRatio) {
                gaps.push({ idx: i, ratio, height: curr });
            }
        }
    }
    
    // Return heights where significant gaps occur
    return gaps.map(g => g.height);
}

// ============================================================================
// FULL ENHANCED PIPELINE
// ============================================================================

/**
 * Process a collection of text segments through the enhanced NLP pipeline
 */
export function processDocumentsEnhanced(
    texts: string[],
    options: EnhancedPipelineOptions = {}
): {
    processedDocs: ProcessedDocument[];
    globalVocabulary: string[];
    tokenWeights: Map<string, number>;
    ngrams: NGram[];
} {
    const {
        enableLemmatization = true,
        enableNgrams = true,
        minNgramFreq = 2,
        maxNgramLength = 3,
        nounPhraseBoost = 1.3,
        glueWordPenalty = 0.5
    } = options;
    
    const processedDocs: ProcessedDocument[] = [];
    const allLemmaSequences: string[][] = [];
    const globalTokenWeights = new Map<string, number>();
    
    // Step 1: Tokenize and lemmatize all documents
    for (const text of texts) {
        let tokens = tokenizeWithLemmas(text);
        
        // Extract noun phrases
        const nounPhrases = extractNounPhrases(text);
        
        // Mark noun phrase tokens with boosted weight
        tokens = markNounPhraseTokens(tokens, nounPhrases, nounPhraseBoost);
        
        // Collect lemmas
        const lemmas = tokens.map(t => enableLemmatization ? t.lemma : t.text.toLowerCase());
        allLemmaSequences.push(lemmas);
        
        // Update global token weights (average across occurrences)
        for (const token of tokens) {
            const key = enableLemmatization ? token.lemma : token.text.toLowerCase();
            const existing = globalTokenWeights.get(key);
            if (existing !== undefined) {
                globalTokenWeights.set(key, (existing + token.weight) / 2);
            } else {
                globalTokenWeights.set(key, token.weight);
            }
        }
        
        processedDocs.push({
            originalText: text,
            tokens,
            ngrams: [],
            vocabulary: lemmas
        });
    }
    
    // Step 2: Detect significant n-grams
    let ngrams: NGram[] = [];
    if (enableNgrams) {
        ngrams = detectNgrams(allLemmaSequences, minNgramFreq, maxNgramLength);
        
        // Apply ngrams to each document's vocabulary
        for (let i = 0; i < processedDocs.length; i++) {
            const doc = processedDocs[i];
            doc.ngrams = ngrams;
            doc.vocabulary = applyNgramsToDocument(doc.vocabulary, ngrams);
        }
        
        // Add ngram weights to global weights
        for (const ngram of ngrams) {
            // N-grams get a slight boost since they're significant multi-word concepts
            globalTokenWeights.set(ngram.joined, 1.2);
        }
    }
    
    // Build global vocabulary
    const vocabSet = new Set<string>();
    for (const doc of processedDocs) {
        for (const term of doc.vocabulary) {
            vocabSet.add(term);
        }
    }
    const globalVocabulary = [...vocabSet];
    
    return {
        processedDocs,
        globalVocabulary,
        tokenWeights: globalTokenWeights,
        ngrams
    };
}

/**
 * Filter vocabulary by minimum document frequency
 */
export function filterVocabularyByDF(
    vocabulary: string[],
    documents: string[][],
    minDF: number = 1,
    maxDFRatio: number = 0.95
): string[] {
    const docCount = documents.length;
    
    return vocabulary.filter(term => {
        const df = documents.filter(doc => doc.includes(term)).length;
        const dfRatio = df / docCount;
        
        return df >= minDF && dfRatio <= maxDFRatio;
    });
}

// ============================================================================
// UTILITY: STOPWORD FILTERING (enhanced)
// ============================================================================

const ENHANCED_STOPWORDS = new Set([
    // Standard English stopwords
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
    'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'would', 'could',
    'also', 'well', 'even', 'still', 'already', 'ever', 'never', 'always',
    // Pronouns
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you',
    'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
    'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them',
    'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this',
    'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
    // Common verbs that add little meaning
    'said', 'say', 'says', 'made', 'came', 'come', 'went', 'go', 'goes',
    'got', 'get', 'gets', 'let', 'put', 'see', 'seen', 'seem', 'seems',
    'take', 'taken', 'took', 'think', 'thought', 'know', 'known', 'knew'
]);

/**
 * Check if a term is a stopword (enhanced list)
 */
export function isStopword(term: string): boolean {
    return ENHANCED_STOPWORDS.has(term.toLowerCase());
}

/**
 * Filter stopwords from a list of terms
 */
export function filterStopwords(terms: string[]): string[] {
    return terms.filter(t => !isStopword(t) && t.length > 1);
}
