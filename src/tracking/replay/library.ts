import type { LandmarkClip } from '../types';
import { validateClip } from './recorder';

const modules = import.meta.glob<unknown>('/tests/recordings/*.json', { import: 'default' });

function nameOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.json$/, '');
}

/** Names of clips under /tests/recordings/*.json. */
export function listClips(): string[] {
  return Object.keys(modules).map(nameOf).sort();
}

export async function loadClip(name: string): Promise<LandmarkClip> {
  for (const path of Object.keys(modules)) {
    if (nameOf(path) === name) return validateClip(await modules[path]());
  }
  throw new Error(
    `No recorded clip named "${name}". Available: ${listClips().join(', ') || 'none'}`,
  );
}
