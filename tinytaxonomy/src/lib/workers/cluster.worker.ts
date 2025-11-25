// Worker entry: provide a minimal browser-safe `process` shim so legacy CJS
// modules (util and others) won't throw when they attempt to read `process`.
if (typeof (globalThis as any).process === 'undefined') {
    (globalThis as any).process = {
        env: {},
        nextTick: (fn: Function, ...args: any[]) => Promise.resolve().then(() => fn(...args)),
        pid: 1,
        noDeprecation: false,
        throwDeprecation: false,
        traceDeprecation: false
    } as any;
}

// Load the full implementation after the shim is in place.
void import('./cluster.worker.impl');

// Worker entry point shim — set up a minimal `process` object in the browser
// environment before loading the full implementation which depends on CJS
// modules that reference `process`.

// Provide a very small process shim that covers the usages in our dependencies
// (process.env, nextTick, pid and a couple of flags). This avoids introducing
// a heavy bundler-level polyfill and keeps worker size small.
if (typeof (globalThis as any).process === 'undefined') {
    (globalThis as any).process = {
        env: {},
        nextTick: (fn: Function, ...args: any[]) => Promise.resolve().then(() => fn(...args)),
        pid: 1,
        noDeprecation: false,
        throwDeprecation: false,
        traceDeprecation: false
    } as any;
}

// Load the real implementation now that `process` is available.
void import('./cluster.worker.impl');

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