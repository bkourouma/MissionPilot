import {
  CLES_RATIO_REDRESSEMENT,
  CRITERES_ALERTE,
  POSTES_RATIO_REDRESSEMENT,
  type CorrespondancePostes,
  type DefinitionLevier,
  type EcartPlan,
  type EntreesAlerte,
  type EvaluationPlan,
  type ImpactLevier,
  type ResultatPointMort,
  type PosteRatioRedressement,
  type PropositionEcheances,
  type RatioRedressement,
  type RatiosExercice,
  type ResultatTresorerie,
  type ResultatUrgence,
  type ScoreAlerte,
  type SeuilsAlerte,
  type SituationCreancier,
  type SynthesePassif,
  type TendancesRedressement,
} from "@missionpilot/engines";
import type {
  Devise,
  RedAffectationPosteVue,
  RedDefinitionLevierVue,
  RedEcartPlanVue,
  RedEntreesScoreVue,
  RedEvaluationPlanVue,
  RedImpactLevierVue,
  RedPersonne,
  RedPointMortVue,
  RedPostesVue,
  RedProjectionVue,
  RedPropositionEcheancesVue,
  RedRatioVue,
  RedRatiosExerciceVue,
  RedResultatUrgenceVue,
  RedScoreAlerteVue,
  RedSeuils,
  RedSituationCreancierVue,
  RedSynthesePassifVue,
  RedTendancesVue,
} from "@missionpilot/shared";

/*
 * Transformateurs EXPLICITES des sorties du moteur de redressement (camelCase) vers les miroirs
 * snake_case de packages/shared (SPEC-3a §7.3), et retour pour les entrées conservées d'un score
 * (rejouables). Jamais de parcours générique des clés de données (codes de questions « T1 »,
 * noms de postes, catégories) : chaque champ est recopié nommément. Aucun calcul ici.
 */

type PgDate = Date | string | null | undefined;

/** Horodatage ISO d'une valeur timestamptz (ou null). */
export function iso(v: PgDate): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export const isoOuVide = (v: PgDate): string => iso(v) ?? "";

export function personne(
  id: string | null | undefined,
  nom: string | null | undefined,
): RedPersonne {
  return { id: id ?? "", nom: nom ?? "" };
}

/* ----- Correspondance de postes ----- */

/** JSON stocké (`{ poste: { codes, sans_objet } }`) → entrée du moteur. Seuls les postes connus sont lus. */
export function postesDepuisJson(json: unknown): CorrespondancePostes {
  const source = (json ?? {}) as Record<
    string,
    { codes?: unknown; sans_objet?: unknown } | undefined
  >;
  const sortie: Partial<Record<PosteRatioRedressement, { codes: string[]; sansObjet: boolean }>> =
    {};
  for (const poste of POSTES_RATIO_REDRESSEMENT) {
    const a = source[poste];
    if (!a) continue;
    sortie[poste] = {
      codes: Array.isArray(a.codes) ? a.codes.map(String) : [],
      sansObjet: a.sans_objet === true,
    };
  }
  return sortie;
}

/** Entrée du moteur (ou proposition indicative) → forme JSON snake_case stockée et rendue. */
export function postesVersVue(c: CorrespondancePostes): RedPostesVue {
  const sortie: RedPostesVue = {};
  for (const poste of POSTES_RATIO_REDRESSEMENT) {
    const a = c[poste];
    if (!a) continue;
    const vue: RedAffectationPosteVue = { codes: [...a.codes], sans_objet: a.sansObjet };
    sortie[poste] = vue;
  }
  return sortie;
}

/* ----- Ratios et tendances ----- */

function vueRatio(r: RatioRedressement): RedRatioVue {
  return { valeur: r.valeur, statut: r.statut, raison: r.raison, manquants: [...r.manquants] };
}

export function vueRatiosExercice(r: RatiosExercice): RedRatiosExerciceVue {
  const ratios = {} as RedRatiosExerciceVue["ratios"];
  for (const cle of CLES_RATIO_REDRESSEMENT) ratios[cle] = vueRatio(r.ratios[cle]);
  const postes: RedRatiosExerciceVue["postes"] = {};
  for (const poste of POSTES_RATIO_REDRESSEMENT) {
    const v = r.postes[poste];
    if (v !== undefined) postes[poste] = v;
  }
  return { exercice: r.exercice, devise: r.devise, postes, ratios };
}

/** Miroir → moteur (rejeu d'un score : les entrées conservées redeviennent des entrées du moteur). */
export function ratiosDepuisVue(v: RedRatiosExerciceVue): RatiosExercice {
  const ratios = {} as Record<(typeof CLES_RATIO_REDRESSEMENT)[number], RatioRedressement>;
  for (const cle of CLES_RATIO_REDRESSEMENT) {
    const r = v.ratios[cle];
    ratios[cle] = {
      valeur: r.valeur,
      statut: r.statut,
      raison: r.raison,
      manquants: [...r.manquants],
    };
  }
  const postes: Partial<Record<PosteRatioRedressement, number>> = {};
  for (const poste of POSTES_RATIO_REDRESSEMENT) {
    const x = v.postes[poste];
    if (x !== undefined) postes[poste] = x;
  }
  return { exercice: v.exercice, devise: v.devise, postes, ratios };
}

export function vueTendances(t: TendancesRedressement): RedTendancesVue {
  return {
    croissance_ca_pb: t.croissanceCaPb,
    variation_marge_brute_pb: t.variationMargeBrutePb,
    raison: t.raison,
  };
}

export function tendancesDepuisVue(v: RedTendancesVue): TendancesRedressement {
  return {
    croissanceCaPb: v.croissance_ca_pb,
    variationMargeBrutePb: v.variation_marge_brute_pb,
    raison: v.raison,
  };
}

/* ----- Urgence ----- */

export function vueResultatUrgence(r: ResultatUrgence): RedResultatUrgenceVue {
  return {
    version: r.version,
    domaines: r.domaines.map((d) => ({
      domaine: d.domaine,
      voyant: d.voyant,
      pourcentage: d.pourcentage,
      points_ponderes: d.pointsPonderes,
      points_maximum: d.pointsMaximum,
      poids_repondu: d.poidsRepondu,
      poids_total: d.poidsTotal,
      inconnues: [...d.inconnues],
      absentes: [...d.absentes],
    })),
    voyant: r.voyant,
    domaines_rouges: [...r.domainesRouges],
    domaines_oranges: [...r.domainesOranges],
    domaines_non_evalues: [...r.domainesNonEvalues],
    complet: r.complet,
    questions_repondues: r.questionsRepondues,
    questions_total: r.questionsTotal,
  };
}

/* ----- Seuils et score d'alerte ----- */

/** Seuils du moteur → JSON snake_case (stocké tel quel, rendu tel quel). */
export function seuilsVersJson(s: SeuilsAlerte): RedSeuils {
  const criteres = {} as RedSeuils["criteres"];
  for (const c of CRITERES_ALERTE) {
    criteres[c] = {
      orange: s.criteres[c].orange,
      rouge: s.criteres[c].rouge,
      poids: s.criteres[c].poids,
    };
  }
  return {
    criteres,
    niveaux: { modere: s.niveaux.modere, eleve: s.niveaux.eleve, critique: s.niveaux.critique },
    part_minimale_evaluee_pct: s.partMinimaleEvalueePct,
  };
}

/** JSON snake_case (corps validé par le schéma, ou ligne stockée) → seuils du moteur. */
export function seuilsDepuisJson(json: RedSeuils): SeuilsAlerte {
  const criteres = {} as SeuilsAlerte["criteres"] extends infer T
    ? { -readonly [K in keyof T]: T[K] }
    : never;
  for (const c of CRITERES_ALERTE) {
    const x = json.criteres[c];
    criteres[c] = { orange: x.orange, rouge: x.rouge, poids: x.poids };
  }
  return {
    criteres,
    niveaux: {
      modere: json.niveaux.modere,
      eleve: json.niveaux.eleve,
      critique: json.niveaux.critique,
    },
    partMinimaleEvalueePct: json.part_minimale_evaluee_pct,
  };
}

export function vueScoreAlerte(s: ScoreAlerte): RedScoreAlerteVue {
  return {
    version: s.version,
    score: s.score,
    niveau: s.niveau,
    criteres: s.criteres.map((c) => ({
      critere: c.critere,
      valeur: c.valeur,
      statut: c.statut,
      points: c.points,
      poids: c.poids,
      motif: c.motif,
    })),
    points_ponderes: s.pointsPonderes,
    poids_evalue: s.poidsEvalue,
    poids_total: s.poidsTotal,
    criteres_rouges: [...s.criteresRouges],
    criteres_oranges: [...s.criteresOranges],
  };
}

/** Entrées conservées d'un score → entrées du moteur (rejeu à l'identique). */
export function entreesAlerteDepuisVue(v: RedEntreesScoreVue): EntreesAlerte {
  return {
    ratios: v.ratios ? ratiosDepuisVue(v.ratios) : null,
    tendances: v.tendances ? tendancesDepuisVue(v.tendances) : null,
    incidents: {
      rejetsBancaires12m: v.incidents.rejets_bancaires_12m,
      retardsFournisseurs90j: v.incidents.retards_fournisseurs_90j,
      arrieresFiscauxSociaux: v.incidents.arrieres_fiscaux_sociaux,
    },
  };
}

/* ----- Trésorerie et point mort ----- */

export function vueProjection(p: ResultatTresorerie): RedProjectionVue {
  return {
    semaines: p.semaines.map((s) => ({
      semaine: s.semaine,
      debut: s.debut,
      fin: s.fin,
      encaissements_prevus: s.encaissementsPrevus,
      decaissements_prevus: s.decaissementsPrevus,
      flux_net_prevu: s.fluxNetPrevu,
      solde_ouverture_prevu: s.soldeOuverturePrevu,
      solde_cloture_prevu: s.soldeCloturePrevu,
      realise: s.realise
        ? {
            encaissements: s.realise.encaissements,
            decaissements: s.realise.decaissements,
            flux_net: s.realise.fluxNet,
            solde_constate: s.realise.soldeConstate,
          }
        : null,
      ecart_encaissements: s.ecartEncaissements,
      ecart_decaissements: s.ecartDecaissements,
      ecart_flux_net: s.ecartFluxNet,
      ecart_rapprochement: s.ecartRapprochement,
      solde_ouverture_retenu: s.soldeOuvertureRetenu,
      solde_cloture_retenu: s.soldeClotureRetenu,
      tension: s.tension,
      par_categorie: s.parCategorie.map((c) => ({
        sens: c.sens,
        categorie: c.categorie,
        prevu: c.prevu,
        realise: c.realise,
        ecart: c.ecart,
      })),
    })),
    solde_minimum: { semaine: p.soldeMinimum.semaine, montant: p.soldeMinimum.montant },
    semaines_tension: [...p.semainesTension],
    premiere_semaine_tension: p.premiereSemaineTension,
    besoin_financement: p.besoinFinancement,
    derniere_semaine_realisee: p.derniereSemaineRealisee,
    ecart_cumule_flux_net: p.ecartCumuleFluxNet,
    totaux: {
      encaissements_prevus: p.totaux.encaissementsPrevus,
      decaissements_prevus: p.totaux.decaissementsPrevus,
      flux_net_prevu: p.totaux.fluxNetPrevu,
    },
  };
}

export function vuePropositionEcheances(p: PropositionEcheances): RedPropositionEcheancesVue {
  return {
    lignes: p.lignes.map((l) => ({
      semaine: l.semaine,
      sens: l.sens,
      categorie: l.categorie,
      montant: l.montant,
      echeance_id: l.echeanceId,
      creancier_id: l.creancierId,
    })),
    anterieures: p.anterieures,
    ulterieures: p.ulterieures,
  };
}

export function vuePointMort(r: ResultatPointMort): RedPointMortVue {
  return {
    statut: r.statut,
    periode_jours: r.periodeJours,
    marge_cout_variable: r.margeCoutVariable,
    taux_marge_cout_variable_pb: r.tauxMargeCoutVariablePb,
    resultat_exploitation: r.resultatExploitation,
    seuil_rentabilite: r.seuilRentabilite,
    marge_securite: r.margeSecurite,
    marge_securite_pb: r.margeSecuritePb,
    point_mort_jours: r.pointMortJours,
  };
}

/* ----- Créanciers ----- */

const echeanceRestante = (e: { rang: number; date: string; montantRestant: number }) => ({
  rang: e.rang,
  date: e.date,
  montant_restant: e.montantRestant,
});

export function vueSituationCreancier(s: SituationCreancier): RedSituationCreancierVue {
  return {
    encours_initial: s.encoursInitial,
    accord: s.accord
      ? {
          statut: s.accord.statut,
          montant_convenu: s.accord.montantConvenu,
          remise: s.accord.remise,
          total_paye: s.accord.totalPaye,
          reste_a_payer: s.accord.resteAPayer,
          echeances_echues: s.accord.echeancesEchues,
          montant_echu: s.accord.montantEchu,
          retard: s.accord.retard,
          prochaine_non_soldee: s.accord.prochaineNonSoldee
            ? echeanceRestante(s.accord.prochaineNonSoldee)
            : null,
          echeances_restantes: s.accord.echeancesRestantes.map(echeanceRestante),
        }
      : null,
    encours_restant: s.encoursRestant,
    echu: s.echu,
  };
}

export function vueSynthesePassif(s: SynthesePassif): RedSynthesePassifVue {
  return {
    nombre: s.nombre,
    total_encours: s.totalEncours,
    total_echu: s.totalEchu,
    part_garantie_pb: s.partGarantiePb,
    concentration_top3_pb: s.concentrationTop3Pb,
    par_categorie: s.parCategorie.map((c) => ({
      categorie: c.categorie,
      nombre: c.nombre,
      encours: c.encours,
      echu: c.echu,
      part_pb: c.partPb,
    })),
  };
}

/* ----- Leviers ----- */

export function vueImpactLevier(i: ImpactLevier): RedImpactLevierVue {
  const base: RedImpactLevierVue["base"] = {};
  for (const poste of POSTES_RATIO_REDRESSEMENT) {
    const v = i.base[poste];
    if (v !== undefined) base[poste] = v;
  }
  return {
    code: i.code,
    devise: i.devise as Devise,
    tresorerie_unique: i.tresorerieUnique,
    resultat_annuel: i.resultatAnnuel,
    tresorerie_annee1: i.tresorerieAnnee1,
    plus_ou_moins_value: i.plusOuMoinsValue,
    base,
    hypotheses: [...i.hypotheses],
    version_catalogue: i.versionCatalogue,
  };
}

export function vueDefinitionLevier(d: DefinitionLevier): RedDefinitionLevierVue {
  return {
    code: d.code,
    famille: d.famille,
    libelle: d.libelle,
    description: d.description,
    postes_base: [...d.postesBase],
    parametres: d.parametres.map((p) => ({
      cle: p.cle,
      libelle: p.libelle,
      unite: p.unite,
      min: p.min,
      max: p.max,
    })),
    hypotheses: [...d.hypotheses],
  };
}

/* ----- Plan ----- */

export function vueEvaluationPlan(e: EvaluationPlan): RedEvaluationPlanVue {
  const volet = (v: EvaluationPlan["parVolet"]["quick_win"]) => ({
    total: v.total,
    terminees: v.terminees,
    abandonnees: v.abandonnees,
    en_retard: v.enRetard,
    avancement_pb: v.avancementPb,
  });
  return {
    par_volet: {
      quick_win: volet(e.parVolet.quick_win),
      restructuration: volet(e.parVolet.restructuration),
    },
    en_retard: [...e.enRetard],
    anomalies: e.anomalies.map((a) => ({ code: a.code, numero: a.numero, bloquante: a.bloquante })),
    bloquants_validation: [...e.bloquantsValidation],
    impact_tresorerie_unique: e.impactTresorerieUnique,
    impact_resultat_annuel: e.impactResultatAnnuel,
  };
}

export function vueEcartPlan(e: EcartPlan): RedEcartPlanVue {
  return { ajoutees: [...e.ajoutees], retirees: [...e.retirees], modifiees: [...e.modifiees] };
}
