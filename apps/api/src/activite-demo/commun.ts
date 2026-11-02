import { ErreurFinance, type DateISO } from "@missionpilot/engines";
import { journaliser } from "../audit.js";
import { journaliserIncident } from "../automatisation/diagnostic.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import { aujourdhui } from "../missions/outils.js";
import { lireActeursDemo, type ActeursDemo } from "./acteurs.js";

/*
 * Socle de la tâche « activite_demo » (activité de démonstration automatique, DECISIONS
 * « Activité de démonstration automatique », 2026-11-01 ; migration 0584) : noms des marqueurs,
 * bilan d'une exécution, contexte partagé par les étapes, points de sauvegarde et marqueurs
 * d'idempotence.
 *
 * - Le journal du job porte toujours `utilisateur_id = NULL` ; les écritures métier sont faites au
 *   nom des acteurs choisis par `acteurs.ts`, jamais d'un humain connecté.
 * - Chaque étape (avenant, feuille, dérive, alertes, jalon, facture, encaissement) s'exécute dans un
 *   point de sauvegarde : une erreur ISOLABLE (règle métier, contrainte, droit SQL, moteur) annule
 *   la seule étape, est consignée SANS contenu (code, contrainte, table) et le traitement continue ;
 *   toute autre erreur (sérialisation, interblocage, délai de verrou ou d'instruction, connexion,
 *   erreur de programmation, charge définitive) remonte au worker, qui annule la transaction du
 *   cabinet et retente (3 essais, `0001` et jobs/worker.ts).
 * - Idempotence des événements : un marqueur `activite_demo.<x>` (journal en ajout seul, `0001`)
 *   est écrit dans le point de sauvegarde de l'écriture et relu avant d'écrire. Un marqueur ne
 *   porte ni montant ni nom (clés refusées par `poserMarqueur`).
 * - Aucun calcul ici : les chiffres sortent des moteurs de `packages/engines`.
 */

export const ACTIONS_ACTIVITE_DEMO = {
  execution: "activite_demo.execution",
  feuille: "activite_demo.feuille",
  derive: "activite_demo.derive",
  jalon: "activite_demo.jalon",
  facture: "activite_demo.facture",
  encaissement: "activite_demo.encaissement",
  prolongation: "activite_demo.prolongation",
} as const;

/** Étape d'une exécution : suffixe des incidents `activite_demo_<étape>`. */
export type EtapeActiviteDemo =
  "prolongation" | "feuille" | "derive" | "alertes" | "jalon" | "facture" | "encaissement";

export type NomPointDeSauvegarde =
  | "ad_prolongation"
  | "ad_feuille"
  | "ad_derive"
  | "ad_alertes"
  | "ad_jalon"
  | "ad_facture"
  | "ad_facture_source"
  | "ad_encaissement";

/** Bilan d'une exécution (renvoyé par le handler, résumé dans `activite_demo.execution`). */
export interface BilanActiviteDemo {
  statut: "inactif" | "hors_perimetre" | "granularite_non_prise_en_charge" | "fait";
  /** Mois de la tâche, `AAAA-MM`. */
  mois: string;
  /** Lundis traités, par ordre croissant. */
  semaines: string[];
  feuilles: number;
  lignes: number;
  redeclarations: number;
  /** Mission maintenue en dérive cette exécution, ou null. */
  derive: string | null;
  jalons: number;
  factures: number;
  encaissements: number;
  prolongations: number;
  /** Tâches de suite hebdomadaires mises en file. */
  suites: number;
  /** Étapes isolées en échec (consignées sans contenu). */
  echecs: number;
}

/** Contexte partagé par les étapes d'une exécution (transaction du cabinet, RLS posée). */
export interface ContexteActiviteDemo {
  db: Db;
  cabinetId: string;
  jobId: string;
  /** Horloge du worker : horodatages écrits par le job (soumission, validation, déclaration…). */
  maintenant: Date;
  /** Jour d'exécution J, jamais après la date réelle (`jourReelDemo`). */
  jour: DateISO;
  mois: string;
  acteurs: ActeursDemo;
  bilan: BilanActiviteDemo;
}

/** Bilan à zéro ; le statut « fait » est remplacé par toute sortie anticipée du handler. */
export function bilanVideActiviteDemo(mois: string): BilanActiviteDemo {
  return {
    statut: "fait",
    mois,
    semaines: [],
    feuilles: 0,
    lignes: 0,
    redeclarations: 0,
    derive: null,
    jalons: 0,
    factures: 0,
    encaissements: 0,
    prolongations: 0,
    suites: 0,
    echecs: 0,
  };
}

/**
 * Jour d'exécution J = min(jour UTC de l'horloge, aujourd'hui) : une horloge en avance n'antidate
 * ni ne postdate rien au-delà de la date réelle (finance/encaissements.ts refuse une date future).
 */
export function jourReelDemo(maintenant: Date): DateISO {
  const jour = maintenant.toISOString().slice(0, 10);
  const reel = aujourdhui();
  return jour < reel ? jour : reel;
}

/** Contexte d'une exécution : jour d'exécution et acteurs lus dans la transaction du cabinet. */
export async function contexteActiviteDemo(
  db: Db,
  cabinetId: string,
  jobId: string,
  maintenant: Date,
  mois: string,
  bilan: BilanActiviteDemo = bilanVideActiviteDemo(mois),
): Promise<ContexteActiviteDemo> {
  return {
    db,
    cabinetId,
    jobId,
    maintenant,
    jour: jourReelDemo(maintenant),
    mois,
    acteurs: await lireActeursDemo(db, cabinetId),
    bilan,
  };
}

/* ----- Erreurs ----- */

/** SQLSTATE retraités par le worker : sérialisation, interblocage, verrou, délai d'instruction. */
const SQLSTATE_RELANCES = new Set(["40001", "40P01", "55P03", "57014"]);

function codeErreur(e: unknown): string | null {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
}

/**
 * Erreur limitée à son étape : règle métier (`AppError`), moteur (`ErreurFinance`, `RangeError`),
 * donnée (classe 22), contrainte (classe 23), refus d'un déclencheur (`P0001`, `MP…`, `MQ…`) ou
 * droit SQL (`42501`). Tout le reste, connexion et erreur de programmation comprises, remonte.
 */
export function estErreurIsolable(e: unknown): boolean {
  if (e instanceof ErreurJobDefinitive) return false;
  if (e instanceof AppError || e instanceof ErreurFinance || e instanceof RangeError) return true;
  const code = codeErreur(e);
  if (code === null || SQLSTATE_RELANCES.has(code)) return false;
  return (
    /^(22|23)[0-9A-Z]{3}$/.test(code) ||
    code === "P0001" ||
    code === "42501" ||
    /^M[PQ][0-9A-Z]{3}$/.test(code)
  );
}

/**
 * Repères d'une erreur SANS contenu (modèle automatisation/avancement-job.ts) : code, contrainte et
 * table, tronqués ; jamais le message ni le `detail` de PostgreSQL, qui peuvent citer des données.
 */
export function sansContenu(e: unknown): Record<string, string> {
  const o = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};
  const champ = (v: unknown) => (typeof v === "string" ? v.slice(0, 100) : undefined);
  const r: Record<string, string> = {
    message: "Échec d'une étape de l'activité de démonstration.",
  };
  for (const [cle, v] of [
    ["code", o.code],
    ["constraint", o.constraint],
    ["table", o.table],
  ] as const) {
    const c = champ(v);
    if (c) r[cle] = c;
  }
  return r;
}

/* ----- Points de sauvegarde ----- */

interface SqlPointDeSauvegarde {
  poser: string;
  liberer: string;
  annuler: string;
}

/** SQL des points de sauvegarde : chaînes CONSTANTES par nom, jamais un gabarit. */
const POINTS_DE_SAUVEGARDE: Record<NomPointDeSauvegarde, SqlPointDeSauvegarde> = {
  ad_prolongation: {
    poser: "SAVEPOINT ad_prolongation",
    liberer: "RELEASE SAVEPOINT ad_prolongation",
    annuler: "ROLLBACK TO SAVEPOINT ad_prolongation",
  },
  ad_feuille: {
    poser: "SAVEPOINT ad_feuille",
    liberer: "RELEASE SAVEPOINT ad_feuille",
    annuler: "ROLLBACK TO SAVEPOINT ad_feuille",
  },
  ad_derive: {
    poser: "SAVEPOINT ad_derive",
    liberer: "RELEASE SAVEPOINT ad_derive",
    annuler: "ROLLBACK TO SAVEPOINT ad_derive",
  },
  ad_alertes: {
    poser: "SAVEPOINT ad_alertes",
    liberer: "RELEASE SAVEPOINT ad_alertes",
    annuler: "ROLLBACK TO SAVEPOINT ad_alertes",
  },
  ad_jalon: {
    poser: "SAVEPOINT ad_jalon",
    liberer: "RELEASE SAVEPOINT ad_jalon",
    annuler: "ROLLBACK TO SAVEPOINT ad_jalon",
  },
  ad_facture: {
    poser: "SAVEPOINT ad_facture",
    liberer: "RELEASE SAVEPOINT ad_facture",
    annuler: "ROLLBACK TO SAVEPOINT ad_facture",
  },
  ad_facture_source: {
    poser: "SAVEPOINT ad_facture_source",
    liberer: "RELEASE SAVEPOINT ad_facture_source",
    annuler: "ROLLBACK TO SAVEPOINT ad_facture_source",
  },
  ad_encaissement: {
    poser: "SAVEPOINT ad_encaissement",
    liberer: "RELEASE SAVEPOINT ad_encaissement",
    annuler: "ROLLBACK TO SAVEPOINT ad_encaissement",
  },
};

/**
 * Exécute `f` dans le point de sauvegarde `nom`. Erreur isolable : retour au point, incident
 * `activite_demo_<étape>` sans contenu, `bilan.echecs` + 1, résultat null ; la transaction reste
 * utilisable. Toute autre erreur est relancée telle quelle (le worker annule et retente).
 */
export async function dansPointDeSauvegarde<T>(
  c: ContexteActiviteDemo,
  nom: NomPointDeSauvegarde,
  etape: EtapeActiviteDemo,
  reperes: Readonly<Record<string, string | number | null>>,
  f: () => Promise<T>,
): Promise<T | null> {
  const sql = POINTS_DE_SAUVEGARDE[nom];
  await c.db.query(sql.poser);
  try {
    const resultat = await f();
    await c.db.query(sql.liberer);
    return resultat;
  } catch (erreur) {
    if (!estErreurIsolable(erreur)) throw erreur;
    await c.db.query(sql.annuler);
    await c.db.query(sql.liberer);
    c.bilan.echecs += 1;
    journaliserIncident(`activite_demo_${etape}`, sansContenu(erreur), {
      ...reperes,
      job_id: c.jobId,
    });
    return null;
  }
}

/* ----- Marqueurs du journal (idempotence) ----- */

/**
 * Le job seul écrit ses marqueurs (`utilisateur_id` nul) ; la lecture est bornée par `cree_le`
 * (index `journal_audit_cabinet_idx`, `0001`), à partir de minuit UTC du jour `depuis`, et filtrée
 * par la RLS du cabinet.
 */
export async function marqueurExiste(
  db: Db,
  action: string,
  cle: { semaine?: string; mois?: string; entiteId?: string },
  depuis: DateISO,
): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM journal_audit
     WHERE action = $1 AND utilisateur_id IS NULL
       AND cree_le >= ($2::date::timestamp AT TIME ZONE 'UTC')
       AND ($3::text IS NULL OR details->>'semaine' = $3)
       AND ($4::text IS NULL OR details->>'mois' = $4)
       AND ($5::text IS NULL OR entite_id = $5)
     LIMIT 1`,
    [action, depuis, cle.semaine ?? null, cle.mois ?? null, cle.entiteId ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Dernier marqueur de l'action depuis le jour donné (le plus récent, puis le dernier inscrit). */
export async function dernierMarqueur(
  db: Db,
  action: string,
  depuis: DateISO,
): Promise<{ entiteId: string | null; details: Record<string, unknown> } | null> {
  const r = await db.query(
    `SELECT entite_id, details FROM journal_audit
     WHERE action = $1 AND utilisateur_id IS NULL
       AND cree_le >= ($2::date::timestamp AT TIME ZONE 'UTC')
     ORDER BY cree_le DESC, id DESC
     LIMIT 1`,
    [action, depuis],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    entiteId: (l.entite_id as string | null) ?? null,
    details: (l.details as Record<string, unknown> | null) ?? {},
  };
}

/** Identifiants d'entité marqués depuis le jour donné, du plus récent au plus ancien, sans doublon. */
export async function idsMarques(
  db: Db,
  action: string,
  depuis: DateISO,
  limite: number,
): Promise<string[]> {
  const r = await db.query(
    `SELECT entite_id FROM journal_audit
     WHERE action = $1 AND utilisateur_id IS NULL AND entite_id IS NOT NULL
       AND cree_le >= ($2::date::timestamp AT TIME ZONE 'UTC')
     ORDER BY cree_le DESC, id DESC
     LIMIT $3`,
    [action, depuis, limite],
  );
  return [...new Set(r.rows.map((l) => l.entite_id as string))];
}

/** Clés de détails refusées dans un marqueur : ni montant, ni nom, ni libellé. */
const CLE_INTERDITE =
  /(^|_)(montant|montants|prix|cout|couts|taux|marge|honoraires|solde|nom|noms|libelle|intitule)(_|$)/;

/**
 * Pose un marqueur `activite_demo.*` au nom du job (`utilisateur_id` nul), dans la transaction
 * de l'écriture qu'il atteste ; `job_id` est ajouté aux détails. Une action hors du module ou une
 * clé de montant ou de nom lève une `RangeError` (isolable : l'étape entière est annulée).
 */
export async function poserMarqueur(
  c: ContexteActiviteDemo,
  action: string,
  entite: string,
  entiteId: string | null,
  details: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  if (!action.startsWith("activite_demo.")) {
    throw new RangeError(`Marqueur hors de l'activité de démonstration : ${action}.`);
  }
  const interdite = Object.keys(details).find((cle) => CLE_INTERDITE.test(cle));
  if (interdite !== undefined) {
    throw new RangeError(`Marqueur ${action} : clé « ${interdite} » refusée (ni montant ni nom).`);
  }
  await journaliser(c.db, {
    cabinetId: c.cabinetId,
    utilisateurId: null,
    action,
    entite,
    entiteId,
    details: { ...details, job_id: c.jobId },
  });
}
