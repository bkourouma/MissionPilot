import {
  agregerRentabilite,
  calculerMarge,
  encoursMission,
  encoursPortefeuille,
  sommer,
  sommerJours,
  zero,
  type AxeRentabilite,
  type ComposantesMarge,
  type Devise,
  type Encours,
  type Montant,
  type RentabiliteMission,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import {
  syntheseReference,
  versDeviseCabinet,
  type AnalyseMission,
  type MissionDonnees,
} from "./donnees.js";

/*
 * Encours de production (FIN-11) et rentabilité (FIN-12), calculés par le
 * moteur (encoursMission, encoursPortefeuille, calculerMarge,
 * agregerRentabilite). Montants agrégés dans la devise du cabinet.
 *
 * Règles de rentabilité sur une période [du, au] :
 * - honoraires : HT des échéances facturées (factures et avoirs émis) dans la
 *   période ;
 * - coûts internes : jours validés de la période × coût journalier chargé en
 *   vigueur à la date du temps ; sous-traitance : jours des externes × coût
 *   d'achat ; débours non refacturés : débours validés non refacturables de
 *   la période ;
 * - marge = honoraires − coûts internes − débours non refacturés −
 *   sous-traitance ; taux = marge / honoraires (moteur) ;
 * - budget : version de référence (dernière version figée) de la mission ;
 *   réalisé et atterrissage en jours : suivi de la mission.
 * - axe « associé » : directeur de la mission (associé ou directeur de mission
 *   responsable du portefeuille).
 */

export interface Exclusion {
  mission_id: string;
  raison: string;
}

/** Convertit toutes les composantes d'une mission ; null si l'une ne se convertit pas. */
function convertirTout<T extends Record<string, Montant>>(
  valeurs: T,
  mission: MissionDonnees,
  devise: Devise,
): T | null {
  const sortie: Record<string, Montant> = {};
  for (const [cle, m] of Object.entries(valeurs)) {
    const c = versDeviseCabinet(m, mission, devise);
    if (c === null) return null;
    sortie[cle] = c;
  }
  return sortie as T;
}

/* ----- Encours de production (FIN-11) ----- */

export interface EncoursMission {
  mission: MissionDonnees;
  jours_valides: number;
  jours_non_valorises: number;
  valeur_produite: Montant;
  honoraires_factures: Montant;
  encours: Encours;
}

export function encoursDesMissions(analyses: readonly AnalyseMission[]): EncoursMission[] {
  return analyses.map((a) => ({
    mission: a.mission,
    jours_valides: a.jours_valides,
    jours_non_valorises: a.jours_non_valorises,
    valeur_produite: a.valeur_produite,
    honoraires_factures: a.honoraires_factures,
    encours: encoursMission(a.valeur_produite, a.honoraires_factures),
  }));
}

/** Encours du cabinet (moteur), sans compenser l'avance d'une mission avec l'encours d'une autre. */
export function encoursCabinet(
  missions: readonly EncoursMission[],
  devise: Devise,
): { encours: Encours; exclues: Exclusion[] } {
  const exclues: Exclusion[] = [];
  const converties: Encours[] = [];
  for (const m of missions) {
    const c = convertirTout(
      { encoursProduction: m.encours.encoursProduction, factureDAvance: m.encours.factureDAvance },
      m.mission,
      devise,
    );
    if (c === null) exclues.push({ mission_id: m.mission.id, raison: "TAUX_CHANGE_ABSENT" });
    else converties.push(c);
  }
  return { encours: encoursPortefeuille(converties, devise), exclues };
}

export function vueEncours(e: Encours): Record<string, unknown> {
  return {
    encours_production: e.encoursProduction.valeur,
    facture_d_avance: e.factureDAvance.valeur,
  };
}

/* ----- Rentabilité (FIN-12) ----- */

export interface RentabiliteCalculee {
  elements: Record<string, unknown>[];
  total: Record<string, unknown>;
  exclues: Exclusion[];
}

interface Composantes extends Record<string, Montant> {
  honoraires: Montant;
  coutsInternes: Montant;
  deboursNonRefactures: Montant;
  sousTraitance: Montant;
}

interface Complement {
  budgetHonoraires: Montant;
  budgetMarge: Montant;
  valeurProduite: Montant;
}

const vueMarge = (c: ComposantesMarge) => {
  const m = calculerMarge(c);
  return {
    honoraires: c.honoraires.valeur,
    couts_internes: c.coutsInternes.valeur,
    debours_non_refactures: c.deboursNonRefactures.valeur,
    sous_traitance: c.sousTraitance.valeur,
    marge: m.marge.valeur,
    taux_marge: m.taux,
  };
};

/**
 * Rentabilité agrégée selon l'axe (moteur `agregerRentabilite`), avec le
 * budget de référence, la valeur produite et les jours (budget, réalisé,
 * atterrissage) de chaque groupe. `jours` : suivi en jours par mission.
 */
export function rentabilite(
  analyses: readonly AnalyseMission[],
  axe: AxeRentabilite,
  devise: Devise,
  joursParMission: ReadonlyMap<string, { budget: number; realise: number; atterrissage: number }>,
): RentabiliteCalculee {
  const exclues: Exclusion[] = [];
  const lignes: (RentabiliteMission & { complement: Complement; mission: MissionDonnees })[] = [];
  for (const a of analyses) {
    const reference = syntheseReference(a.tarification);
    const base: Composantes = {
      honoraires: a.honoraires_factures,
      coutsInternes: a.couts_internes,
      deboursNonRefactures: a.debours_non_refactures,
      sousTraitance: a.sous_traitance,
    };
    const composantes = convertirTout(base, a.mission, devise);
    const complement = convertirTout(
      {
        budgetHonoraires: reference?.honoraires ?? zero(a.mission.devise),
        budgetMarge: reference?.marge ?? zero(a.mission.devise),
        valeurProduite: a.valeur_produite,
      },
      a.mission,
      devise,
    );
    if (composantes === null || complement === null) {
      exclues.push({ mission_id: a.mission.id, raison: "TAUX_CHANGE_ABSENT" });
      continue;
    }
    lignes.push({
      ...composantes,
      missionId: a.mission.id,
      clientId: a.mission.client_id,
      type: a.mission.type_mission_id ?? "sans_type",
      associeId: a.mission.directeur_id ?? "sans_directeur",
      complement: complement as Complement,
      mission: a.mission,
    });
  }
  const cle = (l: (typeof lignes)[number]) =>
    axe === "mission"
      ? l.missionId
      : axe === "client"
        ? l.clientId
        : axe === "type"
          ? l.type
          : l.associeId;
  const libelle = (l: (typeof lignes)[number]) =>
    axe === "mission"
      ? l.mission.intitule
      : axe === "client"
        ? l.mission.client_raison_sociale
        : axe === "type"
          ? (l.mission.type_libelle ?? "Sans type")
          : (l.mission.directeur_nom ?? "Sans directeur");
  const elements = agregerRentabilite(lignes, axe).map((g) => {
    const groupe = lignes.filter((l) => cle(l) === g.cle);
    const joursGroupe = groupe.map((l) => joursParMission.get(l.missionId));
    const somme = (f: (c: Complement) => Montant) =>
      sommer(
        groupe.map((l) => f(l.complement)),
        devise,
      ).valeur;
    const sommeJours = (
      f: (j: { budget: number; realise: number; atterrissage: number }) => number,
    ) => sommerJours(joursGroupe.map((j) => (j ? f(j) : 0)));
    return {
      cle: g.cle,
      libelle: libelle(groupe[0] as (typeof lignes)[number]),
      nombre_missions: g.nombreMissions,
      ...vueMarge(g),
      valeur_produite: somme((c) => c.valeurProduite),
      budget: {
        honoraires: somme((c) => c.budgetHonoraires),
        marge: somme((c) => c.budgetMarge),
        jours: sommeJours((j) => j.budget),
      },
      realise: { jours: sommeJours((j) => j.realise) },
      atterrissage: { jours: sommeJours((j) => j.atterrissage) },
    };
  });
  const totalComposantes: ComposantesMarge = {
    honoraires: sommer(
      lignes.map((l) => l.honoraires),
      devise,
    ),
    coutsInternes: sommer(
      lignes.map((l) => l.coutsInternes),
      devise,
    ),
    deboursNonRefactures: sommer(
      lignes.map((l) => l.deboursNonRefactures),
      devise,
    ),
    sousTraitance: sommer(
      lignes.map((l) => l.sousTraitance),
      devise,
    ),
  };
  return {
    elements,
    total: { nombre_missions: lignes.length, ...vueMarge(totalComposantes) },
    exclues,
  };
}

/** Suivi en jours (budget, réalisé, atterrissage) des missions, sans donnée financière. */
export async function joursDesMissions(
  db: Db,
  cabinetId: string,
  missions: readonly MissionDonnees[],
  suivi: (
    db: Db,
    cabinetId: string,
    missionId: string,
  ) => Promise<{
    arbre: { suivi: { budget: number; realise: number; atterrissage: number } };
  }>,
): Promise<Map<string, { budget: number; realise: number; atterrissage: number }>> {
  const parMission = new Map<string, { budget: number; realise: number; atterrissage: number }>();
  for (const m of missions) {
    const s = (await suivi(db, cabinetId, m.id)).arbre.suivi;
    parMission.set(m.id, { budget: s.budget, realise: s.realise, atterrissage: s.atterrissage });
  }
  return parMission;
}
