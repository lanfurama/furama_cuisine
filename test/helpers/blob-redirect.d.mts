/** Types for blob-redirect.mjs (plain JS so `node --import` can preload it). */
export declare const refused: string[];
export declare function installBlobRedirect(fakeOrigin: string, options?: { blockExternal?: boolean }): void;
