export type Mode = 'paragraph' | 'sentence' | 'word';

export interface WorkerOptions {
    nounOnly?: boolean;
    minWordFreq?: number;
    minTfIdf?: number;
    customStopwords?: string[];
    
    // Enhanced NLP pipeline options
    enableEnhancedPipeline?: boolean;   // Use the new enhanced pipeline
    enableLemmatization?: boolean;       // Lemmatize tokens (idioms→idiom)
    enableNgrams?: boolean;              // Detect bigrams/trigrams
    minNgramFreq?: number;               // Min occurrences for ngrams (default: 2)
    nounPhraseBoost?: number;            // Weight boost for noun phrases (default: 1.3)
    glueWordPenalty?: number;            // Penalty for glue words (default: 0.5)
    normalizeVectors?: boolean;          // L2 normalize TF-IDF vectors
    enableAutoCutoff?: boolean;          // Auto-cut dendrogram at natural boundaries
    cutoffPercentile?: number;           // Percentile for dendrogram cutoff (default: 0.85)
}

export interface WorkerMessage {
    text: string;
    mode: Mode;
    options?: WorkerOptions;
}

export interface TaxonomyNode {
    id?: number;
    name: string;
    value?: number;
    children?: TaxonomyNode[];
    _children?: TaxonomyNode[] | null; // For collapsed state
    height?: number;
    sampleLeaves?: string[];
    clusterKeywords?: string[];
    clusterLabel?: string | null;
    fullText?: string;
    index?: number;
    type?: 'cluster' | 'leaf';
    label?: string;
}

export interface WorkerResponse {
    type: 'success' | 'error' | 'progress';
    data?: TaxonomyNode;
    error?: string;
    message?: string;
}

export interface AppState {
    text: string;
    mode: Mode;
    data: TaxonomyNode | null;
    isProcessing: boolean;
    error: string | null;
    progress?: string;
}
