import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_TOP_LIMIT,
  MAX_ENTRIES_PER_SPORT,
  assertValidEntry,
  beats,
  bestIndex,
  cloneEntry,
  indicesToPrune,
  rankedTop,
} from './MemoryScoreStore';
import type { ScoreEntry, ScoreStore } from './types';

const STORE_NAME = 'scores';
const SPORT_INDEX = 'bySport';
const DB_VERSION = 1;

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbScoreStore implements ScoreStore {
  private readonly dbName: string;
  private readonly factory: IDBFactory | undefined;
  private db: Promise<IDBDatabase> | null = null;

  constructor(dbName = 'headless-sports', factory?: IDBFactory) {
    this.dbName = dbName;
    this.factory = factory ?? globalThis.indexedDB;
  }

  /** Opens the database once and reuses the connection. Rejects if IndexedDB is unusable. */
  open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = this.openDatabase().catch((err: unknown) => {
        this.db = null;
        throw err;
      });
    }
    return this.db;
  }

  async add(
    entry: ScoreEntry,
    higherIsBetter = true,
  ): Promise<{ isBest: boolean; best: ScoreEntry }> {
    assertValidEntry(entry);
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(tx);
    done.catch(() => undefined);
    const store = tx.objectStore(STORE_NAME);
    const index = store.index(SPORT_INDEX);

    // Index order is insertion order: keys and values line up by position.
    const keys = await requestToPromise(index.getAllKeys(entry.sportId));
    const existing = await requestToPromise(index.getAll(entry.sportId));
    const previous = existing.length > 0 ? existing[bestIndex(existing, higherIsBetter)] : null;
    const isBest = previous === null || beats(entry.score, previous.score, higherIsBetter);

    const record = cloneEntry(entry);
    const newKey = await requestToPromise(store.add(record));
    const allKeys = [...keys, newKey];
    const list = [...existing, record];
    const best = bestIndex(list, higherIsBetter);
    for (const i of indicesToPrune(list, best, MAX_ENTRIES_PER_SPORT)) {
      store.delete(allKeys[i]);
    }
    await done;
    return { isBest, best: cloneEntry(list[best]) };
  }

  async best(sportId: string, higherIsBetter = true): Promise<ScoreEntry | null> {
    const rows = await this.readSport(sportId);
    return rows.length > 0 ? cloneEntry(rows[bestIndex(rows, higherIsBetter)]) : null;
  }

  async history(sportId: string, limit = DEFAULT_HISTORY_LIMIT): Promise<ScoreEntry[]> {
    const rows = await this.readSport(sportId);
    return rows.reverse().slice(0, limit).map(cloneEntry);
  }

  async top(
    sportId: string,
    limit = DEFAULT_TOP_LIMIT,
    higherIsBetter = true,
  ): Promise<ScoreEntry[]> {
    const rows = await this.readSport(sportId);
    return rankedTop(rows, limit, higherIsBetter).map(cloneEntry);
  }

  async clear(sportId?: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(tx);
    done.catch(() => undefined);
    const store = tx.objectStore(STORE_NAME);
    if (sportId === undefined) {
      store.clear();
    } else {
      const keys = await requestToPromise(store.index(SPORT_INDEX).getAllKeys(sportId));
      for (const key of keys) store.delete(key);
    }
    await done;
  }

  /** Entries for one sport in insertion order. */
  private async readSport(sportId: string): Promise<ScoreEntry[]> {
    const db = await this.open();
    const tx = db.transaction(STORE_NAME, 'readonly');
    return requestToPromise(tx.objectStore(STORE_NAME).index(SPORT_INDEX).getAll(sportId));
  }

  private openDatabase(): Promise<IDBDatabase> {
    const factory = this.factory;
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
    return new Promise((resolve, reject) => {
      const req = factory.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex(SPORT_INDEX, 'sportId');
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
  }
}
