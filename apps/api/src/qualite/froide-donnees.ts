import {
  evaluerIndependanceRelecteur,
  type EntreeIndependance,
  type ViolationIndependance,
} from "@missionpilot/engines";
import { aPermission, type Role } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable } from "../errors.js";

/*
 * Accès aux données de la revue à froid (QUA-05, migrations 0287 à 0289). Une campagne et ses
 * revues sont des données internes du cabinet : RLS par cabinet, tables fermées au portail.
 * Une revue n'est lisible que du relecteur affecté et de qui gère la revue à froid
 * (`qualite.froide.gerer`) ; toute autre personne reçoit 404, jamais 403, pour ne rien révéler.
 */

export const peutGererFroide = (auth: Auth): boolean =>
  aPermission(auth.roles, "qualite.froide.gerer");

export interface CampagneLue {
  id: string;
  intitule: string;
  criteres: Record<string, unknown>;
  taille_demandee: number;
  graine: string;
  empreinte_population: string;
  statut: "ouverte" | "close";
  cree_par: string;
  cree_le: Date;
  cloturee_par: string | null;
  cloturee_le: Date | null;
}

const COLONNES_CAMPAGNE = `c.id, c.intitule, c.criteres, c.taille_demandee, c.graine, c.empreinte_population,
  c.statut, c.cree_par, c.cree_le, c.cloturee_par, c.cloturee_le`;

/** Campagne du cabinet, ou 404. `verrouiller` pose FOR UPDATE (clôture, ajout d'action sérialisés). */
export async function exigerCampagne(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<CampagneLue> {
  const r = await db.query(
    `SELECT ${COLONNES_CAMPAGNE} FROM qualite_froide_campagnes c WHERE c.id = $1
     ${verrouiller ? "FOR UPDATE OF c" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Campagne");
  return r.rows[0] as CampagneLue;
}

export interface EchantillonLu {
  id: string;
  campagne_id: string;
  mission_id: string;
  rang: number;
  cle: string;
  relecteur_id: string | null;
  affecte_par: string | null;
  affecte_le: Date | null;
  statut: "a_affecter" | "affectee" | "en_revue" | "terminee";
  score: number | null;
  conclusion: string | null;
  synthese: string | null;
  version_grille: number | null;
  terminee_le: Date | null;
}

const COLONNES_ECHANTILLON = `e.id, e.campagne_id, e.mission_id, e.rang, e.cle, e.relecteur_id, e.affecte_par,
  e.affecte_le, e.statut, e.score::float8 AS score, e.conclusion, e.synthese, e.version_grille, e.terminee_le`;

/** Échantillon du cabinet, ou 404 (accès réservé aux appelants qui gèrent la revue à froid). */
export async function exigerEchantillon(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<EchantillonLu> {
  const r = await db.query(
    `SELECT ${COLONNES_ECHANTILLON} FROM qualite_froide_echantillon e WHERE e.id = $1
     ${verrouiller ? "FOR UPDATE OF e" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Revue");
  return r.rows[0] as EchantillonLu;
}

/** Lecture d'une revue : relecteur affecté ou gestionnaire de la revue à froid, sinon 404. */
export async function accesEchantillon(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<EchantillonLu> {
  const e = await exigerEchantillon(db, id, verrouiller);
  if (!peutGererFroide(auth) && e.relecteur_id !== auth.utilisateurId) throw introuvable("Revue");
  return e;
}

/**
 * Écriture de la grille et des constats : le relecteur AFFECTÉ seul. Un tiers reçoit 404 ; qui
 * gère la revue sans en être le relecteur reçoit 403.
 */
export async function exigerRelecteurAffecte(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = true,
): Promise<EchantillonLu> {
  const e = await accesEchantillon(db, auth, id, verrouiller);
  if (e.relecteur_id !== auth.utilisateurId) throw interdit();
  return e;
}

export const revueTerminee = () =>
  new AppError(409, "REVUE_FROIDE_TERMINEE", "La revue est terminée : elle est figée.");

/** Ce qu'il faut savoir de la mission pour juger l'indépendance d'un relecteur (hors relecteur). */
export type ContexteIndependance = Omit<EntreeIndependance, "relecteur_id">;

export async function contexteIndependance(
  db: Db,
  missionId: string,
): Promise<ContexteIndependance> {
  const m = await db.query(
    `SELECT directeur_id, chef_id, cree_par, cloturee_par, signee_par FROM missions WHERE id = $1`,
    [missionId],
  );
  if (!m.rows[0]) throw introuvable("Mission");
  const equipe = await db.query("SELECT utilisateur_id FROM mission_equipe WHERE mission_id = $1", [
    missionId,
  ]);
  const affectes = await db.query(
    `SELECT DISTINCT c.utilisateur_id FROM affectations a
     JOIN collaborateurs c ON c.id = a.collaborateur_id
     WHERE a.mission_id = $1 AND c.utilisateur_id IS NOT NULL`,
    [missionId],
  );
  // Auteurs, ouvreurs, valideurs, signataires et attestateurs des suivis qualité de la mission
  // (même ensemble que la fonction SQL `qualite_froide_violations`).
  const intervenants = await db.query(
    `SELECT s.auteur_id AS u FROM qualite_suivis s WHERE s.mission_id = $1
     UNION SELECT s.ouvert_par FROM qualite_suivis s WHERE s.mission_id = $1
     UNION SELECT v.acteur_id FROM qualite_validations v JOIN qualite_suivis s ON s.id = v.suivi_id
       WHERE s.mission_id = $1
     UNION SELECT g.signataire_id FROM qualite_signatures g JOIN qualite_suivis s ON s.id = g.suivi_id
       WHERE s.mission_id = $1
     UNION SELECT q.par FROM qualite_verifications q JOIN qualite_suivis s ON s.id = q.suivi_id
       WHERE s.mission_id = $1`,
    [missionId],
  );
  const ids = (rows: { [k: string]: unknown }[], cle: string): string[] =>
    rows.map((l) => l[cle] as string | null).filter((x): x is string => x !== null);
  return {
    mission: m.rows[0] as ContexteIndependance["mission"],
    equipe: ids(equipe.rows, "utilisateur_id"),
    affectes: ids(affectes.rows, "utilisateur_id"),
    intervenants_qualite: ids(intervenants.rows, "u"),
  };
}

export function jugerIndependance(
  contexte: ContexteIndependance,
  relecteurId: string,
): { independant: boolean; violations: ViolationIndependance[] } {
  return evaluerIndependanceRelecteur({ ...contexte, relecteur_id: relecteurId });
}

export interface CandidatRelecteur {
  id: string;
  nom: string;
  roles: Role[];
}

/** Utilisateurs actifs du cabinet habilités à la revue à froid (`qualite.froide.relire`). */
export async function candidatsRelecteurs(db: Db): Promise<CandidatRelecteur[]> {
  const r = await db.query(
    "SELECT id, nom, roles FROM utilisateurs WHERE actif ORDER BY lower(nom), id",
  );
  return (r.rows as CandidatRelecteur[]).filter((u) =>
    aPermission(u.roles, "qualite.froide.relire"),
  );
}
