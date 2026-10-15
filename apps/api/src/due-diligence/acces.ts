import { aPermission, type Permission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { exigerMissionEcrivable, exigerMissionLisible } from "../preuves/acces.js";

/*
 * Droits de la due diligence (SPEC-3b §8.0), en plus de la permission de la route (vérifiée par
 * `exiger` AVANT tout accès aux données) :
 * - lire : la mission du dossier doit être visible (404 sinon, comme une ressource d'un autre
 *   cabinet ou inexistante : on ne révèle pas son existence) ;
 * - écrire : mission visible, VERROUILLÉE (`FOR UPDATE` : les écritures d'une mission se
 *   sérialisent, plafonds et numérotation compris) et non clôturée (409 MISSION_CLOTUREE) ;
 * - les routes qui touchent le registre des preuves exigent AUSSI `preuve.ecrire` (`exigerAussi`).
 * Aucune route n'est ouverte au portail (`LISTE_BLANCHE_PORTAIL`, tables `portail_interdit`).
 */

export type TypeElement = "point_analyse" | "etape_chaine" | "risque" | "hypothese" | "action_100j";

export interface DossierLu {
  id: string;
  mission_id: string;
  client_id: string;
  numero: string;
  cree_par: string;
  cree_le: Date;
}

export interface ElementLu {
  id: string;
  type: TypeElement;
  dossier_id: string;
}

/** Permission supplémentaire d'une route (403 sinon). */
export function exigerAussi(auth: Auth, permission: Permission): void {
  if (!aPermission(auth.roles, permission)) throw interdit();
}

/** Associé : seul rôle dispensé de la séparation des tâches du lot (doublé en base). */
export function estAssocieDd(auth: Auth): boolean {
  return auth.roles.includes("associe");
}

export async function lireDossier(db: Db, id: string): Promise<DossierLu | null> {
  const r = await db.query(
    `SELECT d.id, d.mission_id, d.client_id, d.numero::text AS numero, d.cree_par, d.cree_le
     FROM dd_dossiers d WHERE d.id = $1`,
    [id],
  );
  return (r.rows[0] as DossierLu | undefined) ?? null;
}

/**
 * Dossier d'une mission visible (lecture) ou ouverte et verrouillée (écriture) ; 404 sinon, AU MÊME
 * libellé (`quoi`) qu'il n'existe pas ou que sa mission soit invisible : on ne révèle rien.
 */
export async function dossierAccessible(
  db: Db,
  auth: Auth,
  id: string,
  ecriture: boolean,
  quoi = "Dossier",
): Promise<{ dossier: DossierLu; mission: MissionAcces }> {
  const dossier = await lireDossier(db, id);
  if (!dossier) throw introuvable(quoi);
  const mission = ecriture
    ? await exigerMissionEcrivable(db, auth, dossier.mission_id, quoi)
    : await exigerMissionLisible(db, auth, dossier.mission_id, quoi);
  return { dossier, mission };
}

export async function lireElement(db: Db, id: string): Promise<ElementLu | null> {
  const r = await db.query(`SELECT e.id, e.type, e.dossier_id FROM dd_elements e WHERE e.id = $1`, [
    id,
  ]);
  return (r.rows[0] as ElementLu | undefined) ?? null;
}

/** Élément du type attendu d'un dossier accessible ; 404 si absent, d'un autre type ou invisible. */
export async function elementAccessible(
  db: Db,
  auth: Auth,
  id: string,
  type: TypeElement,
  ecriture: boolean,
  quoi = "Élément",
): Promise<{ element: ElementLu; dossier: DossierLu; mission: MissionAcces }> {
  const element = await lireElement(db, id);
  if (!element || element.type !== type) throw introuvable(quoi);
  const { dossier, mission } = await dossierAccessible(
    db,
    auth,
    element.dossier_id,
    ecriture,
    quoi,
  );
  return { element, dossier, mission };
}

/**
 * Plafond d'un objet (409 PLAFOND_ATTEINT), compté sous le verrou de la mission. `table` et
 * `colonne` sont des choix entre constantes de ce module (jamais une valeur reçue).
 */
export async function exigerPlafondDd(
  db: Db,
  p: {
    table:
      "dd_dossiers" | "dd_dimensionnements" | "dd_filtrages" | "dd_notes" | "dd_signal_constats";
    colonne: "mission_id" | "dossier_id";
    valeur: string;
    max: number;
    quoi: string;
  },
): Promise<void> {
  const r = await db.query(`SELECT count(*)::int AS n FROM ${p.table} WHERE ${p.colonne} = $1`, [
    p.valeur,
  ]);
  if ((r.rows[0].n as number) >= p.max) {
    throw new AppError(409, "PLAFOND_ATTEINT", `Plafond atteint : ${p.max} ${p.quoi} au plus.`);
  }
}

/** Plafond des éléments d'un type dans un dossier (retirés compris : ils restent en historique). */
export async function exigerPlafondElements(
  db: Db,
  dossierId: string,
  type: TypeElement,
  max: number,
  quoi: string,
): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM dd_elements WHERE dossier_id = $1 AND type = $2`,
    [dossierId, type],
  );
  if ((r.rows[0].n as number) >= max) {
    throw new AppError(409, "PLAFOND_ATTEINT", `Plafond atteint : ${max} ${quoi} au plus.`);
  }
}

/**
 * Verrou de cabinet pour les plafonds sans mission (signaux, listes d'exclusion) : sérialise les
 * créations concurrentes du cabinet jusqu'à la fin de la transaction.
 */
export async function verrouillerCabinet(db: Db, cabinetId: string, objet: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `dd:${objet}:${cabinetId}`,
  ]);
}

/** 409 VERSION_PERIMEE si la version lue par le client n'est plus la version courante. */
export function exigerVersionCourante(lue: number, courante: number): void {
  if (lue !== courante) {
    throw new AppError(
      409,
      "VERSION_PERIMEE",
      "Une autre modification vient d'être enregistrée : rechargez la page puis recommencez.",
    );
  }
}

/** Plafond de versions d'un objet (doublé par `CHECK version BETWEEN 1 AND 200`). */
export function exigerVersionsRestantes(prochaine: number, max: number): void {
  if (prochaine > max) {
    throw new AppError(409, "PLAFOND_ATTEINT", `Plafond atteint : ${max} versions au plus.`);
  }
}
