/** Builds the app-shell precache list from the bundle's metadata. Pure: runs in the build and in tests. */

export interface BundleEntry {
  fileName: string;
  type: 'chunk' | 'asset';
  isEntry?: boolean;
  /** Chunk name; the entry for index.html is called `main`. */
  name?: string;
  /** Static imports (chunk file names). Dynamic imports are deliberately not followed. */
  imports?: readonly string[];
  importedCss?: readonly string[];
  importedAssets?: readonly string[];
}

export const SHELL_ENTRY_NAME = 'main';

/** `/` and `/index.html` first, then the entry chunk, its static imports, its CSS and fonts. */
export function buildPrecacheList(bundle: Readonly<Record<string, BundleEntry>>): string[] {
  const urls = new Set<string>(['/', '/index.html']);
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const entry = bundle[file];
    if (!entry || entry.type !== 'chunk') return;
    urls.add(`/${file}`);
    for (const css of entry.importedCss ?? []) urls.add(`/${css}`);
    // Every browser that can run the game loads woff2; the .woff fallback is never fetched.
    for (const asset of entry.importedAssets ?? [])
      if (!asset.endsWith('.woff')) urls.add(`/${asset}`);
    for (const dep of entry.imports ?? []) visit(dep);
  };
  const entries = Object.values(bundle).filter(
    (e) => e.type === 'chunk' && e.isEntry === true && e.name === SHELL_ENTRY_NAME,
  );
  for (const e of entries) visit(e.fileName);
  return [...urls];
}
