import {
  CORRESPONDANCE_SYSCOHADA_INDICATIVE,
  validerCorrespondance,
  type CorrespondancePostes,
} from "@missionpilot/engines";
import type {
  RedCorrespondanceCreation,
  RedCorrespondanceVue,
  RedCorrespondancesVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { DossierRed } from "./acces.js";
import { journalRed } from "./journal.js";
import { DEBIT_CORRESPONDANCES, verifierDebit } from "./limites.js";
import { isoOuVide, personne, postesDepuisJson, postesVersVue } from "./vues.js";

/*
 * Correspondance de postes (RED-02) : « poste de ratio ← codes des lignes de l'état du client ».
 * Une version par enregistrement, en ajout seul ; la dernière est la courante. Les ratios sont
 * calculés à la LECTURE depuis les états acceptés (ratios.ts) : rien n'est copié.
 */

const HISTORIQUE_MAX = 100;

export interface CorrespondanceLue {
  version: number;
  postes: CorrespondancePostes;
  postes_json: unknown;
}

const COLONNES = `c.version, c.postes, c.motif, c.cree_par, u.nom AS cree_par_nom, c.cree_le`;

function vue(l: Record<string, unknown>): RedCorrespondanceVue {
  return {
    version: l.version as number,
    postes: postesVersVue(postesDepuisJson(l.postes)),
    motif: (l.motif as string | null) ?? null,
    cree_par: personne(l.cree_par as string, l.cree_par_nom as string),
    cree_le: isoOuVide(l.cree_le as Date),
  };
}

/** Correspondance courante du dossier (la plus haute version), ou null. */
export async function correspondanceCourante(
  db: Db,
  dossierId: string,
): Promise<CorrespondanceLue | null> {
  const r = await db.query(
    `SELECT c.version, c.postes FROM red_correspondances c
     WHERE c.dossier_id = $1 ORDER BY c.version DESC LIMIT 1`,
    [dossierId],
  );
  const l = r.rows[0] as { version: number; postes: unknown } | undefined;
  if (!l) return null;
  return { version: l.version, postes: postesDepuisJson(l.postes), postes_json: l.postes };
}

/** Route 8 : courante, historique (100 au plus) et proposition indicative du moteur. */
export async function lireCorrespondances(
  db: Db,
  dossier: DossierRed,
): Promise<RedCorrespondancesVue> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM red_correspondances c JOIN utilisateurs u ON u.id = c.cree_par
     WHERE c.dossier_id = $1 ORDER BY c.version DESC LIMIT $2`,
    [dossier.id, HISTORIQUE_MAX],
  );
  const lignes = r.rows as Record<string, unknown>[];
  return {
    courante: lignes[0] ? vue(lignes[0]) : null,
    historique: lignes.map((l) => {
      const v = vue(l);
      return { version: v.version, cree_par: v.cree_par, cree_le: v.cree_le, motif: v.motif };
    }),
    indicative: postesVersVue(CORRESPONDANCE_SYSCOHADA_INDICATIVE),
  };
}

/** Route 9 : nouvelle version (dossier verrouillé par l'appelant). Le moteur valide la forme. */
export async function creerCorrespondance(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedCorrespondanceCreation,
): Promise<RedCorrespondanceVue> {
  await verifierDebit(db, auth, DEBIT_CORRESPONDANCES);
  validerCorrespondance(postesDepuisJson(corps.postes));
  const postes = postesVersVue(postesDepuisJson(corps.postes));
  const v = await db.query(
    `SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_correspondances WHERE dossier_id = $1`,
    [dossier.id],
  );
  const version = v.rows[0].suivante as number;
  const r = await db.query(
    `INSERT INTO red_correspondances (cabinet_id, dossier_id, version, postes, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, cree_le`,
    [
      auth.cabinetId,
      dossier.id,
      version,
      JSON.stringify(postes),
      corps.motif ?? null,
      auth.utilisateurId,
    ],
  );
  await journalRed(db, auth, "red_correspondance", "creation", r.rows[0].id as string, {
    dossier_id: dossier.id,
    version,
    nombre_postes: Object.keys(postes).length,
  });
  return {
    version,
    postes,
    motif: corps.motif ?? null,
    cree_par: personne(auth.utilisateurId, auth.nom),
    cree_le: isoOuVide(r.rows[0].cree_le as Date),
  };
}
