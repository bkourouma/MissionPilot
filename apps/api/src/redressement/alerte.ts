import {
  calculerScoreAlerte,
  VERSION_MOTEUR_ALERTE,
  type EntreesAlerte,
} from "@missionpilot/engines";
import type {
  Devise,
  RedEntreesScoreVue,
  RedScoreAlerteVue,
  RedScoreCreation,
  RedScoreVue,
  RedSeuils,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { dateDuJour } from "./dates.js";
import { passerEnDiagnostic, type DossierRed } from "./acces.js";
import { calculerFiabilite } from "../dossier/fiabilite.js";
import { paginer } from "../http/outils.js";
import { journalRed } from "./journal.js";
import { DEBIT_SCORES, verifierDebit } from "./limites.js";
import { cleTriCreation, decoderCurseurCreation, type PageRed } from "./pagination.js";
import { calculerRatiosDossier } from "./ratios.js";
import { seuilsEnVigueur } from "./seuils.js";
import {
  iso,
  isoOuVide,
  personne,
  seuilsDepuisJson,
  vueRatiosExercice,
  vueScoreAlerte,
  vueTendances,
} from "./vues.js";

/*
 * Score d'alerte précoce (RED-10) : fonction pure de ratios, tendances et incidents de paiement,
 * calculée par le moteur avec les seuils en vigueur du secteur du dossier (ou les valeurs par
 * défaut du moteur, `seuils_source = defaut_moteur`). Chaque score est conservé en ajout seul avec
 * ses ENTRÉES, l'instantané COMPLET des seuils, leur version et la version du moteur : il se rejoue
 * à l'identique. Le score est INDICATIF ; il ne qualifie aucune situation juridique.
 */

const COLONNES = `s.id, s.secteur, s.seuils_source, s.seuils_version_id, v.version AS seuils_version, s.seuils,
  s.version_moteur, s.date_reference::text AS date_reference, s.entrees, s.resultat, s.score, s.niveau,
  s.calcule_par, p.nom AS calcule_par_nom, s.cree_le`;
const JOINTURES = `FROM red_scores s JOIN utilisateurs p ON p.id = s.calcule_par
  LEFT JOIN red_seuils_versions v ON v.id = s.seuils_version_id`;

export function vueScore(l: Record<string, unknown>): RedScoreVue {
  return {
    id: l.id as string,
    secteur: l.secteur as RedScoreVue["secteur"],
    seuils_source: l.seuils_source as RedScoreVue["seuils_source"],
    seuils_version_id: (l.seuils_version_id as string | null) ?? null,
    seuils_version: (l.seuils_version as number | null) ?? null,
    seuils: l.seuils as RedSeuils,
    version_moteur: l.version_moteur as number,
    date_reference: l.date_reference as string,
    entrees: l.entrees as RedEntreesScoreVue,
    resultat: l.resultat as RedScoreAlerteVue,
    score: (l.score as number | null) ?? null,
    niveau: l.niveau as RedScoreVue["niveau"],
    calcule_par: personne(l.calcule_par as string, l.calcule_par_nom as string),
    cree_le: isoOuVide(l.cree_le as Date),
  };
}

/** Route 16 : historique des scores, les plus récents d'abord. */
export async function listerScores(
  db: Db,
  dossier: DossierRed,
  q: { limite: number; curseur?: string | undefined },
): Promise<PageRed<RedScoreVue>> {
  const apres = decoderCurseurCreation(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES}, ${cleTriCreation("s")} AS cle_tri ${JOINTURES}
     WHERE s.dossier_id = $1 AND ($2::timestamptz IS NULL OR (s.cree_le, s.id) < ($2::timestamptz, $3::uuid))
     ORDER BY s.cree_le DESC, s.id DESC LIMIT $4`,
    [dossier.id, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return { elements: page.elements.map(vueScore), suivant: page.curseur_suivant };
}

/** Dernier score (résumé du dossier). */
export async function dernierScore(db: Db, dossierId: string) {
  const r = await db.query(
    `SELECT s.id, s.score, s.niveau, s.cree_le, s.seuils_source, v.version AS seuils_version
     ${JOINTURES} WHERE s.dossier_id = $1 ORDER BY s.cree_le DESC, s.id DESC LIMIT 1`,
    [dossierId],
  );
  return (
    (r.rows[0] as
      | {
          id: string;
          score: number | null;
          niveau: string;
          cree_le: Date;
          seuils_source: string;
          seuils_version: number | null;
        }
      | undefined) ?? null
  );
}

/** Route 17 : calcul par le moteur (dossier verrouillé par l'appelant), plafond de débit, journal. */
export async function creerScore(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedScoreCreation,
): Promise<RedScoreVue> {
  await verifierDebit(db, auth, DEBIT_SCORES);
  const calcul = await calculerRatiosDossier(db, dossier);
  const fiabilite = await calculerFiabilite(db, dossier.client_id);
  const courant = calcul.exercices[0] ?? null;
  const incidents = {
    rejets_bancaires_12m: corps.incidents.rejets_bancaires_12m ?? null,
    retards_fournisseurs_90j: corps.incidents.retards_fournisseurs_90j ?? null,
    arrieres_fiscaux_sociaux: corps.incidents.arrieres_fiscaux_sociaux ?? null,
  };
  const entrees: RedEntreesScoreVue = {
    exercice_reference: courant?.lu.exercice ?? null,
    etat_id: courant?.lu.id ?? null,
    correspondance_version: calcul.correspondanceVersion,
    ratios: courant ? vueRatiosExercice(courant.ratios) : null,
    tendances: calcul.tendances ? vueTendances(calcul.tendances) : null,
    incidents,
    analyses_indicatives: fiabilite.analysesIndicatives,
    devise: (courant?.lu.devise ?? dossier.devise) as Devise,
  };
  const seuils = await seuilsEnVigueur(db, dossier.secteur);
  const pourMoteur: EntreesAlerte = {
    ratios: courant?.ratios ?? null,
    tendances: calcul.tendances,
    incidents: {
      rejetsBancaires12m: incidents.rejets_bancaires_12m,
      retardsFournisseurs90j: incidents.retards_fournisseurs_90j,
      arrieresFiscauxSociaux: incidents.arrieres_fiscaux_sociaux,
    },
  };
  const resultat = vueScoreAlerte(calculerScoreAlerte(pourMoteur, seuilsDepuisJson(seuils.json)));
  const dateReference = dateDuJour();
  const r = await db.query(
    `INSERT INTO red_scores (cabinet_id, dossier_id, secteur, seuils_version_id, seuils_source, seuils,
       version_moteur, date_reference, entrees, resultat, score, niveau, calcule_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, cree_le`,
    [
      auth.cabinetId,
      dossier.id,
      dossier.secteur,
      seuils.versionId,
      seuils.source,
      JSON.stringify(seuils.json),
      VERSION_MOTEUR_ALERTE,
      dateReference,
      JSON.stringify(entrees),
      JSON.stringify(resultat),
      resultat.score,
      resultat.niveau,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await passerEnDiagnostic(db, auth, dossier);
  await journalRed(db, auth, "red_score", "score", id, {
    dossier_id: dossier.id,
    niveau: resultat.niveau,
    score: resultat.score,
    seuils_source: seuils.source,
    seuils_version: seuils.version,
  });
  return {
    id,
    secteur: dossier.secteur as RedScoreVue["secteur"],
    seuils_source: seuils.source,
    seuils_version_id: seuils.versionId,
    seuils_version: seuils.version,
    seuils: seuils.json,
    version_moteur: VERSION_MOTEUR_ALERTE,
    date_reference: dateReference,
    entrees,
    resultat,
    score: resultat.score,
    niveau: resultat.niveau,
    calcule_par: personne(auth.utilisateurId, auth.nom),
    cree_le: iso(r.rows[0].cree_le as Date) ?? "",
  };
}
