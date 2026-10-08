/**
 * IndexedDB simulé, réservé aux tests (aucun paquet ajouté) : ce que `magasins.ts` utilise
 * (`open`, mise à niveau, `getAll`/`put`/`delete`/`clear`, transactions, `deleteDatabase`,
 * `versionchange`), avec des rappels asynchrones comme le vrai. Les valeurs sont clonées
 * (`structuredClone`) : une entrée relue n'est jamais l'objet écrit.
 */

type Rappel = (() => void) | null;

class Requete<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: Rappel = null;
  onerror: Rappel = null;
  onupgradeneeded: Rappel = null;
  onblocked: Rappel = null;
}

interface Table {
  keyPath: string;
  lignes: Map<string, unknown>;
}

interface Base {
  version: number;
  tables: Map<string, Table>;
  connexions: Set<BaseOuverte>;
}

const tick = (f: () => void) => setTimeout(f, 0);

class Transaction {
  oncomplete: Rappel = null;
  onerror: Rappel = null;
  onabort: Rappel = null;
  error: Error | null = null;
  private enAttente = 0;
  private terminee = false;

  constructor(
    private readonly table: Table,
    private readonly mode: string,
    private readonly simu: IdbSimule,
  ) {
    tick(() => this.terminer());
  }

  private terminer() {
    if (this.enAttente > 0 || this.terminee) return;
    this.terminee = true;
    if (this.error) this.onerror?.();
    else this.oncomplete?.();
  }

  objectStore() {
    const requete = <T>(f: () => T) => {
      const r = new Requete<T>();
      this.enAttente++;
      tick(() => {
        this.enAttente--;
        try {
          if (this.simu.echouerEcritures && this.mode === "readwrite") {
            throw new Error("QuotaExceededError");
          }
          r.result = f();
          r.onsuccess?.();
        } catch (e) {
          r.error = e as Error;
          this.error = r.error;
          r.onerror?.();
        }
        this.terminer();
      });
      return r;
    };
    const lignes = this.table.lignes;
    const keyPath = this.table.keyPath;
    return {
      getAll: () => requete(() => [...lignes.values()].map((v) => structuredClone(v))),
      put: (v: Record<string, unknown>) =>
        requete(() => {
          if (this.mode !== "readwrite") throw new Error("ReadOnlyError");
          lignes.set(String(v[keyPath]), structuredClone(v));
          return v[keyPath];
        }),
      delete: (cle: string) =>
        requete(() => {
          if (this.mode !== "readwrite") throw new Error("ReadOnlyError");
          lignes.delete(cle);
          return undefined;
        }),
      clear: () =>
        requete(() => {
          if (this.mode !== "readwrite") throw new Error("ReadOnlyError");
          lignes.clear();
          return undefined;
        }),
    };
  }
}

class BaseOuverte {
  onversionchange: Rappel = null;
  fermee = false;
  private ecouteursFermeture: (() => void)[] = [];

  constructor(
    private readonly base: Base,
    private readonly simu: IdbSimule,
  ) {}

  get objectStoreNames() {
    return { contains: (n: string) => this.base.tables.has(n) };
  }

  createObjectStore(nom: string, o: { keyPath: string }) {
    this.base.tables.set(nom, { keyPath: o.keyPath, lignes: new Map() });
  }

  transaction(nom: string, mode: string) {
    if (this.fermee) throw new Error("InvalidStateError: base fermée");
    const t = this.base.tables.get(nom);
    if (!t) throw new Error("NotFoundError");
    return new Transaction(t, mode, this.simu);
  }

  addEventListener(type: string, f: () => void) {
    if (type === "close") this.ecouteursFermeture.push(f);
  }

  close() {
    this.fermee = true;
    this.base.connexions.delete(this);
  }
}

export class IdbSimule {
  readonly bases = new Map<string, Base>();
  /** Simule un navigateur qui refuse IndexedDB (mode privé). */
  echouerOuverture = false;
  /** Simule un quota plein sur les écritures. */
  echouerEcritures = false;
  ouvertures = 0;

  open(nom: string, version: number) {
    const r = new Requete<BaseOuverte>();
    tick(() => {
      this.ouvertures++;
      if (this.echouerOuverture) {
        r.error = new Error("InvalidStateError");
        r.onerror?.();
        return;
      }
      let base = this.bases.get(nom);
      const nouvelle = !base || base.version < version;
      base ??= { version: 0, tables: new Map(), connexions: new Set() };
      this.bases.set(nom, base);
      const db = new BaseOuverte(base, this);
      r.result = db;
      if (nouvelle) {
        base.version = version;
        r.onupgradeneeded?.();
      }
      base.connexions.add(db);
      r.onsuccess?.();
    });
    return r;
  }

  deleteDatabase(nom: string) {
    const r = new Requete<undefined>();
    tick(() => {
      const base = this.bases.get(nom);
      if (base) {
        for (const c of [...base.connexions]) c.onversionchange?.();
        if (base.connexions.size > 0) {
          r.onblocked?.();
          return;
        }
        this.bases.delete(nom);
      }
      r.result = undefined;
      r.onsuccess?.();
    });
    return r;
  }

  /** Lignes d'une table, pour les assertions. */
  lignes(nom: string, table: string): unknown[] {
    return [...(this.bases.get(nom)?.tables.get(table)?.lignes.values() ?? [])];
  }

  /** À passer là où un `IDBFactory` est attendu. */
  get fabrique(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}
