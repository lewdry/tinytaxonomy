export type Mode = 'paragraph' | 'sentence' | 'word';

export interface WorkerOptions {
    nounOnly?: boolean;
    minWordFreq?: number;
    minTfIdf?: number;
    customStopwords?: string[];
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
