import {
  evaluerGarde,
  gardesRequises,
  rangClasseRisque,
  type CandidatBrief,
  type ClasseRisque,
  type EtapeGarde,
  type ValidationGarde,
} from "@missionpilot/engines";
import { aPermission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { estAssocie, type MissionAcces } from "../missions/acces.js";
import { habilitePour } from "../qualite/garde.js";
import {
  a,
  base,
  enSource,
  enSourceFiltree,
  JOUR,
  PLAFOND_PAR_SOURCE,
  texte,
  VISIBLE,
  type ContexteBrief,
  type Extracteur,
} from "./commun.js";

/*
 * Famille « À décider » (2/2) : validations qui passent par une garde humaine ou un circuit
 * propre au module (notation, livrables, dérogations, pièces de la salle, brouillons
 * d'automatisation). Là où le module juge la séparation des tâches par le moteur (`evaluerGarde`),
 * le brief l'interroge avec les mêmes entrées : on ne propose que ce que la garde laisserait faire.
 */

type Ligne = Record<string, unknown>;

/**
 * Notation en revue (NOT-07) : publiée par un expert métier seulement, qui n'est ni l'auteur du
 * calcul, ni d'un ajustement, ni celui qui l'a soumise (déclencheur MPN04).
 */
export const notationsAPublier: Extracteur = async (c) => {
  if (!c.auth.roles.includes("expert_metier") || !a(c, "notation.publier")) return null;
  const r = await c.db.query(
    `SELECT n.id, n.mission_id, m.intitule, ${JOUR("e.le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM notations n JOIN missions m ON m.id = n.mission_id
     JOIN LATERAL (SELECT v.id, v.calcule_par FROM notation_versions v
                   WHERE v.notation_id = n.id ORDER BY v.numero DESC LIMIT 1) v ON true
     JOIN LATERAL (SELECT x.action, x.le FROM notation_evenements x
                   WHERE x.version_id = v.id ORDER BY x.rang DESC LIMIT 1) e
       ON e.action = 'soumission'
     WHERE ${VISIBLE} AND v.calcule_par <> $2
       AND NOT EXISTS (SELECT 1 FROM notation_ajustements aj
                       WHERE aj.version_id = v.id AND aj.auteur_id = $2)
       AND NOT EXISTS (SELECT 1 FROM notation_evenements s
                       WHERE s.version_id = v.id AND s.action = 'soumission' AND s.par = $2)
     ORDER BY e.le, n.id LIMIT $3`,
    [...base(c), PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "notation_a_publier",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: null,
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}/notation`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

interface SuiviLigne extends Record<string, unknown> {
  id: string;
  mission_id: string;
  intitule: string;
  libelle: string;
  classe: ClasseRisque;
  auteur_id: string | null;
  chef_id: string | null;
  directeur_id: string | null;
  depuis: string | null;
  total_source: number;
}

async function suivisAu(c: ContexteBrief, statut: "en_revue" | "valide"): Promise<SuiviLigne[]> {
  const r = await c.db.query(
    `SELECT s.id, s.mission_id, m.intitule, s.libelle, s.classe, s.auteur_id, m.chef_id,
       m.directeur_id, ${JOUR("s.modifie_le")} AS depuis, count(*) OVER ()::int AS total_source
     FROM qualite_suivis s JOIN missions m ON m.id = s.mission_id
     WHERE s.statut = $3 AND ${VISIBLE} AND s.auteur_id IS DISTINCT FROM $2
     ORDER BY s.modifie_le, s.id LIMIT $4`,
    [...base(c), statut, PLAFOND_PAR_SOURCE],
  );
  return r.rows as SuiviLigne[];
}

async function validationsDe(c: ContexteBrief, ids: readonly string[]) {
  const parSuivi = new Map<string, ValidationGarde[]>();
  if (ids.length === 0) return parSuivi;
  const r = await c.db.query(
    `SELECT suivi_id, etape, acteur_id FROM qualite_validations
     WHERE suivi_id = ANY ($1::uuid[]) ORDER BY valide_le, id`,
    [ids],
  );
  for (const l of r.rows as { suivi_id: string; etape: EtapeGarde; acteur_id: string }[]) {
    const liste = parSuivi.get(l.suivi_id) ?? [];
    liste.push({ etape: l.etape, acteur: l.acteur_id });
    parSuivi.set(l.suivi_id, liste);
  }
  return parSuivi;
}

const missionDe = (s: SuiviLigne) =>
  ({ id: s.mission_id, chef_id: s.chef_id, directeur_id: s.directeur_id }) as MissionAcces;

function candidatSuivi(type: "livrable_a_relire" | "livrable_a_signer", s: SuiviLigne) {
  return {
    type,
    entite_id: s.id,
    mission_id: s.mission_id,
    entite_libelle: s.libelle,
    mission_libelle: s.intitule,
    lien: `/qualite/${s.id}`,
    faits: { nature: "attente", depuis: s.depuis },
  } satisfies CandidatBrief;
}

/**
 * Livrable en revue (QUA-01, QUA-04) : l'étape suivante de la garde de sa classe est celle que
 * l'utilisateur peut franchir (habilitation de la mission et séparation des tâches du moteur).
 */
export const livrablesARelire: Extracteur = async (c) => {
  if (!a(c, "qualite.relire")) return null;
  const lignes = await suivisAu(c, "en_revue");
  const validations = await validationsDe(
    c,
    lignes.map((s) => s.id),
  );
  const candidats: CandidatBrief[] = [];
  for (const s of lignes) {
    const faites = validations.get(s.id) ?? [];
    const evaluation = evaluerGarde(s.classe, faites, { auteur: s.auteur_id });
    const etape = evaluation.manquantes.find((e) => e !== "signature_directeur_mission");
    if (!etape || !(await habilitePour(c.db, c.auth, missionDe(s), etape))) continue;
    const apres = evaluerGarde(
      s.classe,
      [...faites, { etape, acteur: c.auth.utilisateurId, habilite: true }],
      { auteur: s.auteur_id },
    );
    if (apres.violations.length === 0) candidats.push(candidatSuivi("livrable_a_relire", s));
  }
  return enSourceFiltree("decider", lignes, candidats);
};

/** Livrable validé de classe R2 ou R3 (QUA-06) : signé par le directeur de mission ou un associé. */
export const livrablesASigner: Extracteur = async (c) => {
  if (!a(c, "qualite.signer")) return null;
  const lignes = (await suivisAu(c, "valide")).filter(
    (s) => rangClasseRisque(s.classe) >= rangClasseRisque("R2"),
  );
  const validations = await validationsDe(
    c,
    lignes.map((s) => s.id),
  );
  const candidats: CandidatBrief[] = [];
  for (const s of lignes) {
    if (!(await habilitePour(c.db, c.auth, missionDe(s), "signature_directeur_mission"))) continue;
    if (gardesRequises(s.classe).signature) {
      const apres = evaluerGarde(
        s.classe,
        [
          ...(validations.get(s.id) ?? []),
          { etape: "signature_directeur_mission", acteur: c.auth.utilisateurId, habilite: true },
        ],
        { auteur: s.auteur_id },
      );
      if (apres.violations.length > 0) continue;
    }
    candidats.push(candidatSuivi("livrable_a_signer", s));
  }
  return enSourceFiltree("decider", lignes, candidats);
};

/** Habilitation à une étape de dérogation (même règle que standard/derogations.ts). */
function habiliteDerogation(
  auth: Auth,
  mission: { chef_id: string | null; directeur_id: string | null },
  etape: EtapeGarde,
): boolean {
  const responsable =
    mission.chef_id === auth.utilisateurId || mission.directeur_id === auth.utilisateurId;
  switch (etape) {
    case "relecture_chef_mission":
      return aPermission(auth.roles, "methode.deroger") && (responsable || estAssocie(auth));
    case "revue_second_expert":
      return auth.roles.includes("expert_metier") || estAssocie(auth);
    case "signature_directeur_mission":
      return mission.directeur_id === auth.utilisateurId || estAssocie(auth);
    default:
      return false;
  }
}

/**
 * Dérogation demandée (STD-07) : l'étape suivante de sa garde est celle que l'utilisateur peut
 * franchir, jamais pour le demandeur (déclencheur MPM04) ni contre les quatre yeux du moteur.
 */
export const derogationsAAccorder: Extracteur = async (c) => {
  if (!a(c, "methode.deroger") && !c.auth.roles.includes("expert_metier") && !estAssocie(c.auth)) {
    return null;
  }
  const r = await c.db.query(
    `SELECT d.id, d.mission_id, m.intitule, d.brique_code, d.classe_risque, d.demandeur_id,
       m.chef_id, m.directeur_id, ${JOUR("d.cree_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM derogations d JOIN missions m ON m.id = d.mission_id
     WHERE d.statut = 'demandee' AND m.statut <> 'cloturee' AND ${VISIBLE}
       AND d.demandeur_id IS DISTINCT FROM $2
     ORDER BY d.cree_le, d.id LIMIT $3`,
    [...base(c), PLAFOND_PAR_SOURCE],
  );
  const lignes = r.rows as Ligne[];
  const ids = lignes.map((l) => l.id as string);
  const faites = new Map<string, ValidationGarde[]>();
  if (ids.length > 0) {
    const v = await c.db.query(
      `SELECT derogation_id, etape, acteur_id FROM derogation_validations
       WHERE derogation_id = ANY ($1::uuid[]) AND decision = 'approuve' ORDER BY cree_le, etape`,
      [ids],
    );
    for (const l of v.rows as { derogation_id: string; etape: EtapeGarde; acteur_id: string }[]) {
      faites.set(l.derogation_id, [
        ...(faites.get(l.derogation_id) ?? []),
        { etape: l.etape, acteur: l.acteur_id },
      ]);
    }
  }
  const candidats: CandidatBrief[] = [];
  for (const l of lignes) {
    const classe = l.classe_risque as ClasseRisque;
    const validations = faites.get(l.id as string) ?? [];
    const options = { auteur: l.demandeur_id as string };
    const etape = evaluerGarde(classe, validations, options).prochaineEtape;
    if (
      !etape ||
      !habiliteDerogation(
        c.auth,
        { chef_id: texte(l.chef_id), directeur_id: texte(l.directeur_id) },
        etape,
      )
    )
      continue;
    const apres = evaluerGarde(
      classe,
      [...validations, { etape, acteur: c.auth.utilisateurId, habilite: true }],
      options,
    );
    if (apres.violations.length > 0) continue;
    candidats.push({
      type: "derogation_a_accorder",
      entite_id: l.id as string,
      mission_id: l.mission_id as string,
      entite_libelle: texte(l.brique_code),
      mission_libelle: texte(l.intitule),
      lien: "/methodes/derogations",
      faits: { nature: "attente", depuis: texte(l.depuis) },
    });
  }
  return enSourceFiltree("decider", lignes, candidats);
};

/**
 * Pièce reçue de la salle de mission (CLI-01) : acceptée ou rejetée par l'équipe, jamais par
 * celui qui a déposé le fichier retenu (séparation des tâches, MPL09). Le nom et le contenu du
 * fichier ne sont pas lus : seul le libellé de la pièce demandée par le cabinet l'est.
 */
export const piecesAExaminer: Extracteur = async (c) => {
  if (!a(c, "salle.gerer")) return null;
  const r = await c.db.query(
    `SELECT p.id, p.libelle, d.id AS demande_id, d.mission_id, m.intitule,
       ${JOUR("e.cree_le")} AS depuis, count(*) OVER ()::int AS total_source
     FROM salle_pieces p
     JOIN salle_demandes d ON d.id = p.demande_id AND d.statut = 'envoyee'
     JOIN missions m ON m.id = d.mission_id
     JOIN LATERAL (SELECT x.statut, x.cree_le FROM salle_piece_evenements x
                   WHERE x.piece_id = p.id ORDER BY x.rang DESC LIMIT 1) e ON e.statut = 'recue'
     JOIN LATERAL (SELECT x.depose_par FROM salle_depots x
                   WHERE x.piece_id = p.id
                     AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = x.fichier_id)
                   ORDER BY x.depose_le DESC, x.id DESC LIMIT 1) dd ON true
     WHERE ${VISIBLE} AND m.statut <> 'cloturee' AND dd.depose_par <> $2
     ORDER BY e.cree_le, p.id LIMIT $3`,
    [...base(c), PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "piece_a_examiner",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.libelle),
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}/salle/${l.demande_id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

const NATURES_BROUILLON: Readonly<Record<string, string>> = {
  note_alerte: "note d'alerte",
  rappel_checklist: "rappel de check-list",
  note: "note",
};

/**
 * Brouillon produit par une automatisation (AUT-05) : décidé par le chef ou le directeur de sa
 * mission (ou qui modifie toutes les missions). Seule la nature du brouillon est reprise, pas son
 * texte, qui peut citer des éléments de la mission.
 */
export const brouillonsAutomatisation: Extracteur = async (c) => {
  if (!a(c, "automatisation.lire")) return null;
  const r = await c.db.query(
    `SELECT b.id, b.mission_id, b.nature, m.intitule, ${JOUR("b.cree_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM automatisation_brouillons b JOIN missions m ON m.id = b.mission_id
     WHERE NOT EXISTS (SELECT 1 FROM automatisation_brouillon_decisions d
                       WHERE d.brouillon_id = b.id)
       AND ${VISIBLE} AND ($3::boolean OR m.chef_id = $2 OR m.directeur_id = $2)
     ORDER BY b.cree_le, b.id LIMIT $4`,
    [...base(c), a(c, "mission.modifier_toutes"), PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "brouillon_automatisation",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: NATURES_BROUILLON[String(l.nature)] ?? null,
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};
