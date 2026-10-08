import type { TypeLivrable } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { empreinteJson } from "./empreinte.js";

/*
 * Lecture, par le module qualité, de ce qu'il sait d'un livrable : existence dans la mission,
 * auteur, statut de validation du contenu source, sections présentes et empreinte du contenu.
 * Lecture seule des tables des modules (rapports, notations, plans, questionnaires) : le module
 * qualité ne modifie jamais un livrable. Un type sans résolveur (`etat`, `autre`) est OPAQUE :
 * `resolu: false`, les contrôles correspondants sont « non évaluables » et se règlent par une
 * attestation humaine ; la signature porte alors sur le dossier de revue seul.
 */

export interface ContenuLivrable {
  /** Le module a pu lire le livrable. */
  resolu: boolean;
  auteurId: string | null;
  /** Statut de validation du contenu côté module (`valide`, `publiee`…) ; null : inconnu. */
  statutSource: string | null;
  /** Sections présentes ; null : le contenu n'expose pas de sections. */
  sections: string[] | null;
  /** SHA-256 du contenu ; null : contenu non lisible par le module qualité. */
  empreinte: string | null;
}

export const CONTENU_OPAQUE: ContenuLivrable = {
  resolu: false,
  auteurId: null,
  statutSource: null,
  sections: null,
  empreinte: null,
};

type Resolveur = (
  db: Db,
  missionId: string,
  livrableId: string,
  version: number,
) => Promise<ContenuLivrable | null>;

const rapport: Resolveur = async (db, missionId, livrableId) => {
  const r = await db.query(
    `SELECT r.statut, r.genere_par, f.sha256
     FROM rapports_mission r JOIN fichiers f ON f.cabinet_id = r.cabinet_id AND f.id = r.fichier_id
     WHERE r.id = $1 AND r.mission_id = $2`,
    [livrableId, missionId],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    resolu: true,
    auteurId: l.genere_par as string,
    statutSource: l.statut as string,
    sections: null,
    empreinte: l.sha256 as string,
  };
};

const notation: Resolveur = async (db, missionId, livrableId, version) => {
  const r = await db.query(
    `SELECT v.id, v.numero, v.grille, v.definition, v.strategie, v.reponses_ids, v.resultat, v.ecarts,
       v.calcule_par, notation_version_statut(v.id) AS statut
     FROM notation_versions v JOIN notations n ON n.id = v.notation_id
     WHERE n.id = $1 AND n.mission_id = $2 AND v.numero = $3`,
    [livrableId, missionId, version],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    resolu: true,
    auteurId: l.calcule_par as string,
    statutSource: l.statut as string,
    sections: ["resultat"],
    empreinte: empreinteJson({
      numero: l.numero,
      grille: l.grille,
      definition: l.definition,
      strategie: l.strategie,
      reponses: [...(l.reponses_ids as string[])].sort(),
      resultat: l.resultat,
      ecarts: l.ecarts,
    }),
  };
};

const plan: Resolveur = async (db, missionId, livrableId) => {
  const p = await db.query(
    "SELECT cree_par FROM plans_strategiques WHERE id = $1 AND mission_id = $2",
    [livrableId, missionId],
  );
  if (!p.rows[0]) return null;
  const e = await db.query(
    `SELECT DISTINCT ON (v.element_id) e.id, e.type, e.parent_id, v.version, v.statut_contenu, v.contenu,
       v.retire, v.responsable_id, v.debut::text AS debut, v.echeance::text AS echeance, v.budget::text AS budget,
       v.statut_initiative
     FROM plan_elements e JOIN plan_element_versions v ON v.element_id = e.id
     WHERE e.plan_id = $1 ORDER BY v.element_id, v.version DESC`,
    [livrableId],
  );
  const actifs = e.rows.filter((l) => !(l.retire as boolean));
  const valide = actifs.length > 0 && actifs.every((l) => l.statut_contenu === "valide");
  const tries = [...e.rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    resolu: true,
    auteurId: p.rows[0].cree_par as string,
    statutSource: valide ? "valide" : "brouillon",
    sections: [...new Set(actifs.map((l) => l.type as string))].sort(),
    empreinte: empreinteJson(tries),
  };
};

const questionnaire: Resolveur = async (db, missionId, livrableId) => {
  const r = await db.query(
    "SELECT statut, definition, cree_par FROM questionnaire_envois WHERE id = $1 AND mission_id = $2",
    [livrableId, missionId],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    resolu: true,
    auteurId: l.cree_par as string,
    statutSource: l.statut as string,
    sections: null,
    empreinte: empreinteJson(l.definition),
  };
};

const RESOLVEURS: Partial<Record<TypeLivrable, Resolveur>> = {
  rapport,
  notation,
  plan,
  questionnaire,
};

/** Contenu du livrable, `null` s'il n'existe pas dans la mission, `CONTENU_OPAQUE` si le type est opaque. */
export async function lireContenuLivrable(
  db: Db,
  missionId: string,
  type: TypeLivrable,
  livrableId: string,
  version: number,
): Promise<ContenuLivrable | null> {
  const resolveur = RESOLVEURS[type];
  if (!resolveur) return CONTENU_OPAQUE;
  return resolveur(db, missionId, livrableId, version);
}
