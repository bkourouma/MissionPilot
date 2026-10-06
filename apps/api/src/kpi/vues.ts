import type {
  AlerteKpi,
  EvaluationKpi,
  ProjectionKpi,
  ScoreCompositeKpi,
  TendanceKpi,
} from "@missionpilot/engines";
import type { CibleKpi, DefinitionKpi } from "./donnees.js";
import type { AlerteDatee, EvaluationSerieKpi, PeriodeEvaluee } from "./evaluation.js";

/*
 * Projections JSON (clés snake_case) des résultats du moteur : aucune valeur
 * n'est recalculée ici, les champs sont recopiés tels que le moteur les rend.
 */

export function vueDefinition(def: DefinitionKpi, cibleActuelle: number | null) {
  return {
    id: def.id,
    mission_id: def.mission_id,
    client_id: def.client_id,
    libelle: def.libelle,
    description: def.description,
    unite: def.unite,
    perspective: def.perspective,
    sens: def.sens,
    nature: def.nature,
    frequence: def.frequence,
    ponderation: def.ponderation,
    seuil_vert: def.seuil_vert,
    seuil_orange: def.seuil_orange,
    alerte_haut: def.alerte_haut,
    alerte_bas: def.alerte_bas,
    alerte_variation: def.alerte_variation,
    proprietaire_id: def.proprietaire_id,
    debut_suivi: def.debut_suivi,
    fin_suivi: def.fin_suivi,
    rappels_actifs: def.rappels_actifs,
    actif: def.actif,
    cible_actuelle: cibleActuelle,
    cree_le: def.cree_le,
    modifie_le: def.modifie_le,
  };
}

export function vueCible(c: CibleKpi) {
  return {
    version: c.version,
    valeur: c.valeur,
    a_partir_de: c.a_partir_de,
    motif: c.motif,
    cree_par: c.cree_par,
    cree_le: c.cree_le,
  };
}

export function vueEvaluation(e: EvaluationKpi) {
  return {
    statut: e.statut,
    atteinte: e.atteinte && {
      taux: e.atteinte.taux,
      taux_exact: e.atteinte.tauxExact,
      taux_brut_exact: e.atteinte.tauxBrutExact,
      mode: e.atteinte.mode,
      borne: e.atteinte.borne,
    },
    ecart: e.ecart && {
      ecart: e.ecart.ecart,
      ecart_exact: e.ecart.ecartExact,
      ecart_relatif: e.ecart.ecartRelatif,
      ecart_oriente: e.ecart.ecartOriente,
      cible_atteinte: e.ecart.cibleAtteinte,
    },
  };
}

export function vuePeriode(p: PeriodeEvaluee) {
  return {
    periode: p.cle,
    debut: p.debut,
    fin: p.fin,
    close: p.close,
    valeur: p.valeur,
    nombre_mesures: p.nombre_mesures,
    cible: p.cible,
    ...vueEvaluation(p.evaluation),
  };
}

export function vueTendance(t: TendanceKpi) {
  return {
    direction: t.direction,
    evolution: t.evolution,
    pente: t.pente,
    variation: t.variation,
    variation_relative: t.variationRelative,
    points: t.points,
  };
}

export function vueProjection(p: ProjectionKpi) {
  return {
    valeur_projetee: p.valeurProjetee,
    valeur_exacte: p.valeurExacte,
    methode: p.methode,
    jours_ecoules: p.joursEcoules,
    jours_total: p.joursTotal,
  };
}

/** Détails chiffrés d'une alerte du moteur, en snake_case. */
export function detailsAlerte(a: AlerteKpi): Record<string, unknown> {
  switch (a.code) {
    case "DEGRADATION_CONSECUTIVE":
      return { periodes: a.periodes, seuil: a.seuil };
    case "MESURE_EN_RETARD":
      return {
        periode_attendue: a.periodeAttendue,
        echeance: a.echeance,
        jours_de_retard: a.joursDeRetard,
        periodes_manquantes: a.periodesManquantes,
        derniere_periode_due: a.dernierePeriodeDue,
      };
    case "SEUIL_HAUT":
    case "SEUIL_BAS":
      return { valeur: a.valeur, seuil: a.seuil };
    case "VARIATION":
      return {
        valeur: a.valeur,
        precedente: a.precedente,
        variation_relative: a.variationRelative,
        seuil: a.seuil,
      };
  }
}

export function vueAlerte(a: AlerteDatee) {
  return { code: a.alerte.code, periode: a.periode_cle, ...detailsAlerte(a.alerte) };
}

export function vueSerie(e: EvaluationSerieKpi) {
  return {
    date_reference: e.date_reference,
    statut: e.statut,
    derniere_periode: e.derniere && vuePeriode(e.derniere),
    tendance: vueTendance(e.tendance),
    periode_en_cours: e.en_cours && {
      ...vuePeriode(e.en_cours.periode),
      projection: vueProjection(e.en_cours.projection),
      statut_projete: e.en_cours.statut_projete,
    },
    alertes: e.alertes.map(vueAlerte),
  };
}

export function vueScore(s: ScoreCompositeKpi | null) {
  if (!s) return null;
  return {
    score: s.score,
    score_exact: s.scoreExact,
    statut: s.statut,
    couverture: s.couverture,
    contributions: s.contributions.map((c) => ({
      kpi_id: c.code,
      poids_normalise: c.poidsNormalise,
      taux: c.taux,
      contribution: c.contribution,
      statut: c.statut,
    })),
    exclus: s.exclus.map((x) => ({ kpi_id: x.code, raison: x.raison })),
  };
}
