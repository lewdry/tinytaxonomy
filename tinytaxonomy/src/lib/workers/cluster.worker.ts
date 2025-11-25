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

// Load the full implementation after the shim is in place. Keep this entry
// minimal — the actual worker implementation lives in `cluster.worker.impl.ts`.
void import('./cluster.worker.impl');