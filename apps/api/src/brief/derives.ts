import {
  ajouterJours,
  capacite,
  comparer,
  ErreurKpi,
  lundiDeLaSemaine,
  zero,
  type CandidatBrief,
  type StatutPeriodeBrief,
} from "@missionpilot/engines";
import {
  COLONNES_KPI,
  ciblesDe,
  lireParametresKpi,
  mesuresActivesDe,
  parKpi,
  versDefinition,
} from "../kpi/donnees.js";
import { evaluerSerieKpi, nombrePeriodesEvaluees } from "../kpi/evaluation.js";
import { MAX_PERIODES_EVALUEES_PAR_REQUETE } from "../kpi/tableau.js";
import {
  imputationsParFacture,
  COLONNES_FACTURE_PAIEMENT,
  situationPaiement,
  versFacturePaiement,
} from "../finance/paiements.js";
import { chargerCalendrier } from "../missions/outils.js";
import { absencesValidees } from "../planification/charge.js";
import { calculerSuivisMissions } from "../temps/suivi.js";
import {
  a,
  base,
  dateFr,
  enSource,
  enSourceFiltree,
  JOUR,
  PLAFOND_PAR_SOURCE,
  texte,
  VISIBLE,
  type Extracteur,
} from "./commun.js";

/*
 * Famille « Ça dérive » : KPI au rouge ou à l'orange deux périodes de suite, atterrissage au-delà
 * du budget, factures échues, jalons et tâches en retard, feuille de temps non soumise,
 * questionnaire sans réponse. Les sources ne lisent que des FAITS (statuts de périodes, jours,
 * échéances) ; seuils et gravité sont ceux du moteur du brief. Les montants ne sortent qu'avec
 * `finance.lire` (FIN-02) ; l'atterrissage reste en jours (`budget.lire_jours`).
 */

/** KPI actifs évalués par requête (la liste d'une mission est plafonnée à 200 par ailleurs). */
const PLAFOND_KPI = 150;
/** Missions dont l'atterrissage est lu, en lot. */
const PLAFOND_MISSIONS_ATTERRISSAGE = 100;

const STATUTS_JUGEABLES: readonly string[] = ["vert", "orange", "rouge"];

/**
 * KPI d'une mission visible : statuts des deux dernières périodes closes mesurées (sélection, le
 * statut de chaque période est calculé par le moteur KPI). Un KPI dont la configuration est
 * refusée par le moteur, ou dont l'évaluation dépasserait le volume admis, est ignoré.
 */
export const kpisQuiDerivent: Extracteur = async (c) => {
  if (!a(c, "kpi.lire")) return null;
  const r = await c.db.query(
    `SELECT ${COLONNES_KPI}, m.intitule AS mission_intitule, count(*) OVER ()::int AS total_source
     FROM kpi_definitions d JOIN missions m ON m.id = d.mission_id
     WHERE d.actif AND m.statut <> 'cloturee' AND d.debut_suivi <= $3::date AND ${VISIBLE}
     ORDER BY d.id LIMIT $4`,
    [...base(c), c.date, PLAFOND_KPI],
  );
  const lignes = r.rows as Record<string, unknown>[];
  const definitions = lignes.map(versDefinition);
  const ids = definitions.map((d) => d.id);
  const params = await lireParametresKpi(c.db);
  const cibles = parKpi(await ciblesDe(c.db, ids));
  const mesures = parKpi(await mesuresActivesDe(c.db, ids));
  const candidats: CandidatBrief[] = [];
  let periodes = 0;
  let interrompue = false;
  for (const [i, def] of definitions.entries()) {
    periodes += nombrePeriodesEvaluees(def, c.date);
    if (periodes > MAX_PERIODES_EVALUEES_PAR_REQUETE) {
      interrompue = true;
      break;
    }
    let mesurees;
    try {
      mesurees = evaluerSerieKpi(
        def,
        mesures.get(def.id) ?? [],
        cibles.get(def.id) ?? [],
        c.date,
        params,
      ).periodes.filter((p) => p.close && p.valeur !== null);
    } catch (error) {
      if (error instanceof ErreurKpi) continue;
      throw error;
    }
    const recentes = mesurees
      .slice(-2)
      .reverse()
      .filter((p) => STATUTS_JUGEABLES.includes(p.evaluation.statut));
    candidats.push({
      type: "kpi_rouge",
      entite_id: def.id,
      mission_id: def.mission_id,
      entite_libelle: def.libelle,
      mission_libelle: texte(lignes[i]?.mission_intitule),
      lien: `/missions/${def.mission_id}/kpi/${def.id}`,
      faits: {
        nature: "kpi",
        statuts: recentes.map((p) => p.evaluation.statut as StatutPeriodeBrief),
        depuis: recentes[0]?.fin ?? null,
      },
    });
  }
  // Au-delà des KPI lus (plafond) ou du volume d'évaluation, le nombre de KPI qui dérivent est
  // inconnu : famille tronquée, sans total gonflé.
  return enSourceFiltree("deriver", lignes, candidats, interrompue);
};

/**
 * Atterrissage d'une mission en cours (TPS-05) : jours du budget et jours d'atterrissage tels que
 * le suivi les calcule ; le moteur du brief juge le dépassement de 5 %. Aucun montant.
 */
export const atterrissagesDepasses: Extracteur = async (c) => {
  if (!a(c, "budget.lire_jours")) return null;
  const r = await c.db.query(
    `SELECT m.id, m.intitule, count(*) OVER ()::int AS total_source
     FROM missions m
     WHERE m.statut IN ('signee', 'en_cours', 'a_cloturer') AND ${VISIBLE}
     ORDER BY m.date_fin NULLS LAST, m.id LIMIT $3`,
    [...base(c), PLAFOND_MISSIONS_ATTERRISSAGE],
  );
  const lignes = r.rows as Record<string, unknown>[];
  const suivis = await calculerSuivisMissions(
    c.db,
    c.auth.cabinetId,
    lignes.map((l) => l.id as string),
  );
  const candidats: CandidatBrief[] = [];
  for (const l of lignes) {
    const suivi = suivis.get(l.id as string)?.arbre.suivi;
    if (!suivi) continue;
    candidats.push({
      type: "atterrissage_depasse",
      entite_id: l.id as string,
      mission_id: l.id as string,
      entite_libelle: null,
      mission_libelle: texte(l.intitule),
      lien: `/missions/${l.id as string}/suivi`,
      faits: {
        nature: "atterrissage",
        jours_budget: suivi.budget,
        jours_atterrissage: suivi.atterrissage,
      },
    });
  }
  return enSourceFiltree("deriver", lignes, candidats);
};

/**
 * Facture émise dont l'échéance est dépassée et dont le solde, calculé par le moteur de finance,
 * reste positif (FIN-09). Le montant (solde) n'est rendu qu'avec `finance.lire`.
 */
export const facturesEchues: Extracteur = async (c) => {
  if (!a(c, "facture.lire")) return null;
  const r = await c.db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT}, m.intitule, count(*) OVER ()::int AS total_source
     FROM factures f JOIN missions m ON m.id = f.mission_id
     WHERE f.nature = 'facture' AND f.statut = 'emise' AND f.date_echeance < $3::date AND ${VISIBLE}
     ORDER BY f.date_echeance, f.id LIMIT $4`,
    [...base(c), c.date, PLAFOND_PAR_SOURCE],
  );
  const lignes = r.rows as Record<string, unknown>[];
  const factures = lignes.map(versFacturePaiement);
  const imputations = await imputationsParFacture(
    c.db,
    factures.map((f) => f.id),
    c.date,
  );
  const candidats: CandidatBrief[] = [];
  for (const [i, f] of factures.entries()) {
    const situation = situationPaiement(f, imputations.get(f.id) ?? [], c.date);
    if (comparer(situation.solde, zero(situation.solde.devise)) <= 0 || !f.date_echeance) continue;
    candidats.push({
      type: "facture_echue",
      entite_id: f.id,
      mission_id: f.mission_id,
      entite_libelle: f.numero,
      mission_libelle: texte(lignes[i]?.intitule),
      lien: `/facturation/${f.id}`,
      faits: { nature: "retard", echeance: f.date_echeance },
      ...(c.avecFinance ? { montant: situation.solde.valeur, devise: situation.solde.devise } : {}),
    });
  }
  return enSourceFiltree("deriver", lignes, candidats);
};

/** Jalon non atteint dont la date prévue est dépassée, sur une mission visible et non clôturée. */
export const jalonsEnRetard: Extracteur = async (c) => {
  if (!a(c, "mission.lire")) return null;
  const r = await c.db.query(
    `SELECT j.id, j.libelle, j.mission_id, m.intitule, j.date_prevue::text AS echeance,
       count(*) OVER ()::int AS total_source
     FROM mission_jalons j JOIN missions m ON m.id = j.mission_id
     WHERE NOT j.atteint AND j.date_prevue < $3::date
       AND m.statut IN ('signee', 'en_cours', 'a_cloturer') AND ${VISIBLE}
     ORDER BY j.date_prevue, j.id LIMIT $4`,
    [...base(c), c.date, PLAFOND_PAR_SOURCE],
  );
  return enSource("deriver", r.rows, (l) => ({
    type: "jalon_en_retard",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.libelle),
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}/decoupage`,
    faits: { nature: "retard", echeance: l.echeance as string },
  }));
};

/** Tâche assignée à l'utilisateur (SOC-08), non faite, dont l'échéance est dépassée. */
export const tachesEnRetard: Extracteur = async (c) => {
  const r = await c.db.query(
    `SELECT t.id, t.titre, t.mission_id, t.echeance::text AS echeance,
       count(*) OVER ()::int AS total_source
     FROM taches_collaboration t
     WHERE t.assignee_id = $1::uuid AND t.statut <> 'fait' AND t.echeance < $2::date
     ORDER BY t.echeance, t.id LIMIT $3`,
    [c.auth.utilisateurId, c.date, PLAFOND_PAR_SOURCE],
  );
  return enSource("deriver", r.rows, (l) => ({
    type: "tache_en_retard",
    entite_id: l.id as string,
    mission_id: texte(l.mission_id),
    entite_libelle: texte(l.titre),
    mission_libelle: null,
    lien: `/mes-taches/${l.id as string}`,
    faits: { nature: "retard", echeance: l.echeance as string },
  }));
};

/** Semaines récentes examinées pour la feuille de temps non soumise (hors semaine en cours). */
const SEMAINES_EXAMINEES = 2;

/**
 * Feuille de temps de l'utilisateur non soumise pour l'une des deux dernières semaines, hors
 * semaine sans capacité (absence validée) et hors semaine antérieure à son arrivée. L'échéance est
 * le vendredi de la semaine (rappel du vendredi, TPS-04).
 */
export const feuillesNonSoumises: Extracteur = async (c) => {
  if (!a(c, "temps.saisir")) return null;
  const moi = await c.db.query(
    `SELECT id, ${JOUR("cree_le")} AS arrivee FROM collaborateurs
     WHERE utilisateur_id = $1::uuid AND actif`,
    [c.auth.utilisateurId],
  );
  const collaborateur = moi.rows[0] as { id: string; arrivee: string } | undefined;
  if (!collaborateur) return null;
  const lundi = lundiDeLaSemaine(c.date);
  const semaines = Array.from({ length: SEMAINES_EXAMINEES }, (_, i) =>
    ajouterJours(lundi, -7 * (i + 1)),
  );
  const soumises = await c.db.query(
    `SELECT f.semaine::text AS semaine FROM feuilles_temps f
     WHERE f.collaborateur_id = $1 AND f.semaine = ANY ($2::date[])
       AND f.statut IN ('soumise', 'validee', 'verrouillee')`,
    [collaborateur.id, semaines],
  );
  const faites = new Set(soumises.rows.map((l) => l.semaine as string));
  const calendrier = await chargerCalendrier(c.db, c.auth.cabinetId);
  const candidats: CandidatBrief[] = [];
  for (const semaine of semaines) {
    const periode = { debut: semaine, fin: ajouterJours(semaine, 6) };
    if (faites.has(semaine) || collaborateur.arrivee > periode.fin) continue;
    const absences = (await absencesValidees(c.db, [collaborateur.id], periode)).get(
      collaborateur.id,
    );
    if (capacite(periode, calendrier, absences ?? [], 100) === 0) continue;
    candidats.push({
      type: "feuille_non_soumise",
      entite_id: `${collaborateur.id}:${semaine}`,
      mission_id: null,
      entite_libelle: `semaine du ${dateFr(semaine)}`,
      mission_libelle: null,
      lien: `/temps?semaine=${semaine}`,
      faits: { nature: "retard", echeance: ajouterJours(semaine, 4) },
    });
  }
  return { famille: "deriver", candidats, restants: 0 };
};

/**
 * Questionnaire envoyé dont l'échéance (date limite, à défaut J+7, palier des relances) est
 * dépassée alors qu'un répondant éligible n'a pas soumis. Aucune réponse n'est lue : seul le
 * titre de l'envoi, choisi par le cabinet, est repris.
 */
export const questionnairesSansReponse: Extracteur = async (c) => {
  if (!a(c, "questionnaire.lire")) return null;
  const r = await c.db.query(
    `SELECT * FROM (
       SELECT e.id, e.titre, e.mission_id, m.intitule,
         coalesce(e.date_limite, (e.envoye_le AT TIME ZONE 'UTC')::date + 7)::text AS echeance,
         count(*) OVER ()::int AS total_source
       FROM questionnaire_envois e JOIN missions m ON m.id = e.mission_id
       WHERE e.statut = 'envoye' AND m.statut <> 'cloturee' AND ${VISIBLE}
         AND coalesce(e.date_limite, (e.envoye_le AT TIME ZONE 'UTC')::date + 7) < $3::date
         AND EXISTS (
           SELECT 1 FROM questionnaire_repondants r
           JOIN utilisateurs u ON u.id = r.utilisateur_id AND u.actif
             AND u.roles && ARRAY['client_dirigeant', 'client_contributeur']
           JOIN utilisateurs_portail up ON up.utilisateur_id = r.utilisateur_id
             AND up.client_id = r.client_id AND up.statut = 'actif'
           JOIN clients cl ON cl.id = r.client_id AND cl.actif
           WHERE r.envoi_id = e.id AND NOT EXISTS (
             SELECT 1 FROM questionnaire_reponses q
             WHERE q.statut = 'soumise' AND CASE WHEN e.mode = 'collectif'
               THEN q.envoi_id = r.envoi_id AND q.repondant_id IS NULL
               ELSE q.repondant_id = r.id END))
     ) x ORDER BY x.echeance, x.id LIMIT $4`,
    [...base(c), c.date, PLAFOND_PAR_SOURCE],
  );
  return enSource("deriver", r.rows, (l) => ({
    type: "questionnaire_sans_reponse",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.titre),
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}/questionnaires/${l.id as string}`,
    faits: { nature: "retard", echeance: l.echeance as string },
  }));
};
