import {
  analyserBancabilite,
  type AnalyseBancabilite,
  type PlanFinancementExercice,
  type SeuilsBancabilite,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { exigerPlanVisible } from "./acces.js";
import { versionReference, type ResumeModele } from "./modele.js";

/*
 * Bancabilité du plan (PLA-17) : ratios bancaires (couverture du service de
 * la dette, endettement, dette nette / EBE, capacité de remboursement, BFR en
 * jours), plan de financement et verdict indicatif, calculés par le moteur
 * (analyserBancabilite) UNIQUEMENT depuis le résultat FIGÉ d'une version
 * VALIDÉE du modèle financier existant (0181) : aucune hypothèse nouvelle,
 * aucun chiffre saisi ni produit par l'IA. Sans version validée : 409
 * MODELE_NON_VALIDE. Le dossier bancaire (rapport PDF ou Word) reprend la
 * même analyse (rapports/dossier-bancaire.ts).
 */

export const modeleNonValide = (detail: string) =>
  new AppError(409, "MODELE_NON_VALIDE", `Bancabilité : ${detail}`);

/** Version validée du modèle (demandée, sinon la dernière validée) et son résultat figé. */
export async function versionValidee(db: Db, planId: string, version: number | undefined) {
  const reference = await versionReference(db, planId, version);
  if (!reference) throw modeleNonValide("aucune version du modèle financier.");
  if (!reference.resume.validation) {
    throw modeleNonValide(
      `la version ${reference.resume.version} du modèle financier n'est pas validée.`,
    );
  }
  return reference;
}

function vueSeuils(s: SeuilsBancabilite) {
  return {
    couverture_service_dette_min_pb: s.couvertureServiceDetteMinPb,
    endettement_max_pb: s.endettementMaxPb,
    dette_nette_sur_ebe_max_pb: s.detteNetteSurEbeMaxPb,
    capacite_remboursement_max_pb: s.capaciteRemboursementMaxPb,
    bfr_jours_max: s.bfrJoursMax,
  };
}

function vuePlanFinancement(p: PlanFinancementExercice) {
  return {
    exercice: p.exercice,
    ressources: {
      capacite_autofinancement: p.ressources.capaciteAutofinancement,
      augmentations_capital: p.ressources.augmentationsCapital,
      emprunts_nouveaux: p.ressources.empruntsNouveaux,
      diminution_bfr: p.ressources.diminutionBfr,
      total: p.ressources.total,
    },
    emplois: {
      investissements: p.emplois.investissements,
      augmentation_bfr: p.emplois.augmentationBfr,
      remboursements_emprunts: p.emplois.remboursementsEmprunts,
      dividendes: p.emplois.dividendes,
      total: p.emplois.total,
    },
    solde: p.solde,
    solde_cumule: p.soldeCumule,
  };
}

export function vueBancabilite(a: AnalyseBancabilite) {
  return {
    seuils: vueSeuils(a.seuils),
    exercices: a.exercices,
    plan_financement: a.planFinancement.map(vuePlanFinancement),
    totaux: a.totaux,
    hors_seuil: a.horsSeuil,
    verdict: a.verdict,
  };
}

const vueModele = (r: ResumeModele) => ({
  version: r.version,
  validation: r.validation,
  calcule_le: r.calcule_le,
});

/** Analyse de bancabilité d'un plan visible, sur une version validée de son modèle. */
export async function lireBancabilite(
  db: Db,
  auth: Auth,
  planId: string,
  version: number | undefined,
) {
  const plan = await exigerPlanVisible(db, auth, planId);
  const reference = await versionValidee(db, planId, version);
  const base = reference.resultat.base;
  const analyse = analyserBancabilite(base.annees);
  return {
    plan_id: planId,
    devise: plan.devise,
    horizon: base.horizon,
    modele: vueModele(reference.resume),
    ...vueBancabilite(analyse),
    echeanciers: base.echeanciers,
  };
}
