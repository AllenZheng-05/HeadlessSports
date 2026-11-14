import type { Script } from '../script';

const registry = new Map<string, () => Script>();

export function registerScript(name: string, factory: () => Script): void {
  registry.set(name, factory);
}

/** A fresh copy of the named script, or null. */
export function getScript(name: string): Script | null {
  const factory = registry.get(name);
  return factory ? factory() : null;
}

export function listScripts(): string[] {
  return [...registry.keys()];
}
