import type {
  ControleArbre,
  ControleNote,
  IndicationVerdict,
  RecoupementDd,
  ResultatDimensionnement,
  SyntheseChaine,
  SyntheseEs,
  SynthesePlanCentJours,
  SyntheseRisquesDd,
} from "@missionpilot/engines";

/*
 * Traduction des sorties des moteurs (`packages/engines/src/due-diligence`, camelCase) en JSON
 * snake_case de l'API. Aucune valeur n'est calculée ici : seuls les noms changent.
 */

export function vueSyntheseRisques(s: SyntheseRisquesDd) {
  return {
    total: s.total,
    familles: s.familles.map((f) => ({
      famille: f.famille,
      total: f.total,
      par_niveau: f.parNiveau,
      niveau_max: f.niveauMax,
    })),
    a_documenter: s.aDocumenter,
    par_etape: s.parEtape.map((e) => ({
      etape_id: e.etapeId,
      total: e.total,
      niveau_max: e.niveauMax,
    })),
  };
}

export function vueSyntheseChaine(s: SyntheseChaine) {
  return {
    etapes: s.etapes.map((e) => ({
      id: e.id,
      ordre: e.ordre,
      part_cout_bp: e.partCoutBp,
      part_marge_bp: e.partMargeBp,
      rang_marge: e.rangMarge,
    })),
    total_cout_bp: s.totalCoutBp,
    total_marge_bp: s.totalMargeBp,
    coherence_cout: s.coherenceCout,
    coherence_marge: s.coherenceMarge,
    etape_marge_max: s.etapeMargeMax,
  };
}

export function vueIndication(i: IndicationVerdict) {
  return {
    indication: i.indication,
    raison: i.raison,
    conflit: i.conflit,
    soutien: i.soutien,
    contre: i.contre,
  };
}

export function vueArbre(a: ControleArbre) {
  return {
    total: a.total,
    racines: a.racines,
    profondeur_max: a.profondeurMax,
    par_etat: a.parEtat,
    incoherences: a.incoherences.map((i) => ({ noeud: i.noeud, code: i.code })),
  };
}

export function vueRecoupement(r: RecoupementDd) {
  return {
    ecart_bp: r.ecartBp,
    plus_eleve: r.plusEleve,
    alerte: r.alerte,
    chevauchement: r.chevauchement,
  };
}

export function vueResultatDimensionnement(r: ResultatDimensionnement) {
  return {
    methode: r.methode,
    etages: r.etages.map((e) => ({ code: e.code, valeurs: { ...e.valeurs } })),
    avant_ajustement: { ...r.avantAjustement },
    resultat: { ...r.resultat },
    ajuste: r.ajuste,
    ajustements_appliques: r.ajustementsAppliques.map((a) => ({
      libelle: a.libelle,
      facteur_bp: a.facteurBp,
      base: a.base,
    })),
    sensibilite: r.sensibilite.map((s) => ({
      code: s.code,
      resultat_bas: s.resultatBas,
      resultat_haut: s.resultatHaut,
      amplitude: s.amplitude,
      part_amplitude_bp: s.partAmplitudeBp,
    })),
    couverture: {
      total: r.couverture.total,
      preuve: r.couverture.preuve,
      avis_expert: r.couverture.avisExpert,
      absente: [...r.couverture.absente],
    },
  };
}

export type ResultatFige = ReturnType<typeof vueResultatDimensionnement>;

export function vueSyntheseEs(s: SyntheseEs) {
  return {
    niveau_global: s.niveauGlobal,
    par_niveau: s.parNiveau,
    manquants: s.manquants,
    complet: s.complet,
    a_documenter: s.aDocumenter,
    touches_bloquantes: s.touchesBloquantes,
    bloquant: s.bloquant,
  };
}

export function vuePlan(s: SynthesePlanCentJours) {
  return {
    actions: s.actions.map((a) => ({
      id: a.id,
      phase: a.phase,
      date_debut: a.dateDebut,
      date_fin: a.dateFin,
      en_retard: a.enRetard,
    })),
    par_phase: s.parPhase,
    total: s.total,
    terminees: s.terminees,
    taux_realisation_bp: s.tauxRealisationBp,
    en_retard: s.enRetard,
    jour_courant: s.jourCourant,
    sans_responsable: s.sansResponsable,
    sans_indicateur: s.sansIndicateur,
    sans_plan: s.sansPlan,
  };
}

export function vueControleNote(c: ControleNote) {
  return {
    bloquants: [...c.bloquants],
    avertissements: [...c.avertissements],
    soumissible: c.soumissible,
  };
}
