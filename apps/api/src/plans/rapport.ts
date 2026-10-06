import {
  REFERENCES_SYSCOHADA,
  TAUX_ACTUALISATION_DEFAUT,
  tauxRendementInterne,
  valeurActuelleNette,
  type ExercicePrevisionnel,
  type ResultatPlanFinancier,
} from "@missionpilot/engines";
import {
  STATUT_INITIATIVE_LIBELLES,
  TYPE_ELEMENT_PLAN_LIBELLES,
  type StatutInitiative,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { exigerPlanVisible } from "./acces.js";
import { elementsCourants, vueElement, type ElementCourant } from "./elements.js";
import { derniereVersionModele, SERIES_CLES, versionReference } from "./modele.js";
import { contenuValide, vuePlan } from "./plans.js";

/*
 * Lectures dérivées du plan : feuille de route (PLA-05), ROI par initiative
 * (PLA-07 : VAN et TRI du moteur) et données du rapport (PLA-11), exposées
 * en tableaux et séries pour un futur export PDF/DOCX/PPTX. Aucun appel IA ;
 * aucun chiffre n'est calculé ici : les montants sont ceux du résultat figé
 * du moteur ou de la saisie, réorganisés sans arithmétique.
 */

/* ----- Feuille de route ----- */

/** Rang de la période d'un mois (1 à 12) : trimestre 1 à 4, semestre 1 à 2. */
const RANG_DU_MOIS = {
  trimestre: [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4],
  semestre: [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
} as const;
const PERIODES_PAR_AN = { trimestre: 4, semestre: 2 } as const;
const LETTRE = { trimestre: "T", semestre: "S" } as const;

type Pas = keyof typeof RANG_DU_MOIS;
interface Periode {
  annee: number;
  rang: number;
}

function periodeDe(date: string, pas: Pas): Periode {
  const mois = Number(date.slice(5, 7));
  return { annee: Number(date.slice(0, 4)), rang: RANG_DU_MOIS[pas][mois - 1] as number };
}

const libellePeriode = (p: Periode, pas: Pas) => `${p.annee}-${LETTRE[pas]}${p.rang}`;
const avant = (a: Periode, b: Periode) =>
  a.annee < b.annee || (a.annee === b.annee && a.rang <= b.rang);

function suivante(p: Periode, pas: Pas): Periode {
  return p.rang === PERIODES_PAR_AN[pas]
    ? { annee: p.annee + 1, rang: 1 }
    : { ...p, rang: p.rang + 1 };
}

interface DonneesInitiative {
  titre: string;
  responsable_id: string | null;
  debut: string | null;
  echeance: string;
  budget: number;
  statut: StatutInitiative;
  gains_annuels?: number[];
}

const initiativesActives = (elements: readonly ElementCourant[]) =>
  elements.filter((e) => e.type === "initiative" && !e.retire);

/** Feuille de route par trimestre ou semestre : initiatives actives sur chaque période. */
export function feuilleDeRoute(elements: readonly ElementCourant[], pas: Pas) {
  const initiatives = initiativesActives(elements).map((e) => {
    const d = e.donnees as unknown as DonneesInitiative;
    const fin = periodeDe(d.echeance, pas);
    return {
      id: e.id,
      parent_id: e.parent_id,
      titre: d.titre,
      responsable_id: d.responsable_id,
      debut: d.debut,
      echeance: d.echeance,
      statut: d.statut,
      statut_libelle: STATUT_INITIATIVE_LIBELLES[d.statut],
      statut_contenu: e.statut_contenu,
      periode_debut: libellePeriode(d.debut ? periodeDe(d.debut, pas) : fin, pas),
      periode_fin: libellePeriode(fin, pas),
      _debut: d.debut ? periodeDe(d.debut, pas) : fin,
      _fin: fin,
    };
  });
  initiatives.sort((a, b) => (a.echeance < b.echeance ? -1 : a.echeance > b.echeance ? 1 : 0));
  const periodes: { periode: string; initiatives: string[] }[] = [];
  if (initiatives.length) {
    let p = initiatives.reduce(
      (m, i) => (avant(i._debut, m) ? i._debut : m),
      initiatives[0]!._debut,
    );
    const derniere = initiatives.reduce(
      (m, i) => (avant(m, i._fin) ? i._fin : m),
      initiatives[0]!._fin,
    );
    while (avant(p, derniere)) {
      const courante = p;
      periodes.push({
        periode: libellePeriode(courante, pas),
        initiatives: initiatives
          .filter((i) => avant(i._debut, courante) && avant(courante, i._fin))
          .map((i) => i.id),
      });
      p = suivante(p, pas);
    }
  }
  return {
    pas,
    periodes,
    initiatives: initiatives.map(({ _debut: _d, _fin: _f, ...reste }) => reste),
  };
}

export async function lireFeuilleDeRoute(db: Db, auth: Auth, planId: string, pas: Pas) {
  await exigerPlanVisible(db, auth, planId);
  const elements = (await elementsCourants(db, planId)).map(vueElement);
  return { plan_id: planId, ...feuilleDeRoute(elements, pas) };
}

/* ----- ROI par initiative ----- */

/** VAN (flux de l'année 0 non actualisé) et TRI du moteur sur [−budget, gains annuels]. */
export function roiInitiatives(elements: readonly ElementCourant[], taux: number) {
  return initiativesActives(elements).map((e) => {
    const d = e.donnees as unknown as DonneesInitiative;
    const base = {
      id: e.id,
      titre: d.titre,
      statut_contenu: e.statut_contenu,
      budget: d.budget,
      gains_annuels: d.gains_annuels ?? null,
    };
    if (!d.gains_annuels) {
      return { ...base, flux: null, valeur_actuelle_nette: null, taux_rendement_interne: null };
    }
    const flux = [-d.budget, ...d.gains_annuels];
    return {
      ...base,
      flux,
      valeur_actuelle_nette: valeurActuelleNette(flux, taux, 0),
      taux_rendement_interne: tauxRendementInterne(flux),
    };
  });
}

export async function lireRoi(db: Db, auth: Auth, planId: string, version: number | undefined) {
  await exigerPlanVisible(db, auth, planId);
  const reference = await versionReference(db, planId, version);
  const taux = reference?.resultat.base.hypotheses.tauxActualisation ?? TAUX_ACTUALISATION_DEFAUT;
  const elements = (await elementsCourants(db, planId)).map(vueElement);
  return {
    plan_id: planId,
    modele_version: reference?.resume.version ?? null,
    taux_actualisation: taux,
    source_taux: reference ? "modele" : "defaut",
    initiatives: roiInitiatives(elements, taux),
  };
}

/* ----- Données du rapport ----- */

type Ligne = readonly [string, string, (a: ExercicePrevisionnel) => number | null, string | null];

const R = REFERENCES_SYSCOHADA;

const COMPTE_RESULTAT: readonly Ligne[] = [
  [
    "chiffre_affaires",
    "Chiffre d'affaires",
    (a) => a.compteResultat.chiffreAffaires,
    R.compteResultat.chiffreAffaires,
  ],
  ["achats_consommes", "Achats consommés", (a) => a.compteResultat.achatsConsommes, null],
  ["marge_brute", "Marge brute", (a) => a.compteResultat.margeBrute, null],
  [
    "charges_externes_variables",
    "Charges externes variables",
    (a) => a.compteResultat.chargesExternesVariables,
    null,
  ],
  [
    "charges_externes_fixes",
    "Charges externes fixes",
    (a) => a.compteResultat.chargesExternesFixes,
    null,
  ],
  [
    "valeur_ajoutee",
    "Valeur ajoutée",
    (a) => a.compteResultat.valeurAjoutee,
    R.compteResultat.valeurAjoutee,
  ],
  ["charges_personnel", "Charges de personnel", (a) => a.compteResultat.chargesPersonnel, null],
  [
    "excedent_brut_exploitation",
    "Excédent brut d'exploitation",
    (a) => a.compteResultat.excedentBrutExploitation,
    R.compteResultat.excedentBrutExploitation,
  ],
  [
    "dotations_amortissements",
    "Dotations aux amortissements",
    (a) => a.compteResultat.dotationsAmortissements,
    null,
  ],
  [
    "resultat_exploitation",
    "Résultat d'exploitation",
    (a) => a.compteResultat.resultatExploitation,
    R.compteResultat.resultatExploitation,
  ],
  ["frais_financiers", "Frais financiers", (a) => a.compteResultat.fraisFinanciers, null],
  [
    "resultat_financier",
    "Résultat financier",
    (a) => a.compteResultat.resultatFinancier,
    R.compteResultat.resultatFinancier,
  ],
  [
    "resultat_activites_ordinaires",
    "Résultat des activités ordinaires",
    (a) => a.compteResultat.resultatActivitesOrdinaires,
    R.compteResultat.resultatActivitesOrdinaires,
  ],
  [
    "impot_sur_resultat",
    "Impôt sur le résultat",
    (a) => a.compteResultat.impotSurResultat,
    R.compteResultat.impotSurResultat,
  ],
  [
    "resultat_net",
    "Résultat net",
    (a) => a.compteResultat.resultatNet,
    R.compteResultat.resultatNet,
  ],
];

const BILAN: readonly Ligne[] = [
  [
    "immobilisations_nettes",
    "Immobilisations nettes",
    (a) => a.bilan.immobilisationsNettes,
    R.bilan.immobilisationsNettes,
  ],
  ["stocks", "Stocks", (a) => a.bilan.stocks, R.bilan.stocks],
  ["creances_clients", "Créances clients", (a) => a.bilan.creancesClients, R.bilan.creancesClients],
  ["tresorerie_actif", "Trésorerie-actif", (a) => a.bilan.tresorerieActif, R.bilan.tresorerieActif],
  ["total_actif", "Total actif", (a) => a.bilan.totalActif, R.bilan.totalActif],
  ["capital", "Capital", (a) => a.bilan.capital, R.bilan.capital],
  ["reserves", "Réserves et report à nouveau", (a) => a.bilan.reserves, null],
  [
    "resultat_exercice",
    "Résultat de l'exercice",
    (a) => a.bilan.resultatExercice,
    R.bilan.resultatExercice,
  ],
  ["capitaux_propres", "Capitaux propres", (a) => a.bilan.capitauxPropres, R.bilan.capitauxPropres],
  [
    "dettes_financieres",
    "Dettes financières",
    (a) => a.bilan.dettesFinancieres,
    R.bilan.dettesFinancieres,
  ],
  [
    "dettes_fournisseurs",
    "Dettes fournisseurs",
    (a) => a.bilan.dettesFournisseurs,
    R.bilan.dettesFournisseurs,
  ],
  [
    "tresorerie_passif",
    "Trésorerie-passif",
    (a) => a.bilan.tresoreriePassif,
    R.bilan.tresoreriePassif,
  ],
  ["total_passif", "Total passif", (a) => a.bilan.totalPassif, R.bilan.totalPassif],
  [
    "besoin_fonds_roulement",
    "Besoin en fonds de roulement",
    (a) => a.bilan.besoinFondsRoulement,
    null,
  ],
];

const FLUX: readonly Ligne[] = [
  [
    "tresorerie_ouverture",
    "Trésorerie d'ouverture",
    (a) => a.fluxTresorerie.tresorerieOuverture,
    R.fluxTresorerie.tresorerieOuverture,
  ],
  [
    "capacite_autofinancement",
    "Capacité d'autofinancement",
    (a) => a.fluxTresorerie.capaciteAutofinancement,
    R.fluxTresorerie.capaciteAutofinancement,
  ],
  [
    "variation_bfr",
    "Variation du besoin en fonds de roulement",
    (a) => a.fluxTresorerie.variationBesoinFondsRoulement,
    null,
  ],
  [
    "flux_activites_operationnelles",
    "Flux des activités opérationnelles",
    (a) => a.fluxTresorerie.fluxActivitesOperationnelles,
    R.fluxTresorerie.fluxActivitesOperationnelles,
  ],
  [
    "flux_investissement",
    "Flux des activités d'investissement",
    (a) => a.fluxTresorerie.fluxInvestissement,
    R.fluxTresorerie.fluxInvestissement,
  ],
  [
    "flux_capitaux_propres",
    "Flux des capitaux propres",
    (a) => a.fluxTresorerie.fluxCapitauxPropres,
    R.fluxTresorerie.fluxCapitauxPropres,
  ],
  [
    "flux_capitaux_etrangers",
    "Flux des capitaux étrangers",
    (a) => a.fluxTresorerie.fluxCapitauxEtrangers,
    R.fluxTresorerie.fluxCapitauxEtrangers,
  ],
  [
    "flux_financement",
    "Flux des activités de financement",
    (a) => a.fluxTresorerie.fluxFinancement,
    R.fluxTresorerie.fluxFinancement,
  ],
  [
    "variation_tresorerie",
    "Variation de la trésorerie",
    (a) => a.fluxTresorerie.variationTresorerie,
    R.fluxTresorerie.variationTresorerie,
  ],
  [
    "tresorerie_cloture",
    "Trésorerie de clôture",
    (a) => a.fluxTresorerie.tresorerieCloture,
    R.fluxTresorerie.tresorerieCloture,
  ],
];

const INDICATEURS: readonly Ligne[] = [
  ["point_mort", "Point mort (chiffre d'affaires)", (a) => a.indicateurs.pointMort, null],
  ["point_mort_jours", "Point mort (jours)", (a) => a.indicateurs.pointMortJours, null],
  [
    "taux_marge_couts_variables",
    "Taux de marge sur coûts variables",
    (a) => a.indicateurs.tauxMargeCoutsVariables,
    null,
  ],
  ["flux_libre", "Flux de trésorerie disponible", (a) => a.indicateurs.fluxLibre, null],
  ["endettement_net", "Endettement net", (a) => a.indicateurs.endettementNet, null],
  [
    "ratio_endettement",
    "Dettes financières / capitaux propres",
    (a) => a.indicateurs.ratioEndettement,
    null,
  ],
  [
    "capacite_remboursement",
    "Capacité de remboursement (années)",
    (a) => a.indicateurs.capaciteRemboursement,
    null,
  ],
  ["autonomie_financiere", "Autonomie financière", (a) => a.indicateurs.autonomieFinanciere, null],
  [
    "couverture_service_dette",
    "Couverture du service de la dette",
    (a) => a.indicateurs.couvertureServiceDette,
    null,
  ],
];

function tableau(titre: string, r: ResultatPlanFinancier, lignes: readonly Ligne[]) {
  return {
    titre,
    colonnes: r.annees.map((a) => a.exercice),
    lignes: lignes.map(([cle, libelle, extraire, reference]) => ({
      cle,
      libelle,
      reference_syscohada: reference,
      valeurs: r.annees.map(extraire),
    })),
  };
}

function donneesFinancieres(reference: NonNullable<Awaited<ReturnType<typeof versionReference>>>) {
  const { resultat, resume: version } = reference;
  const base = resultat.base;
  const scenarios = { base, optimiste: resultat.optimiste, pessimiste: resultat.pessimiste };
  return {
    version,
    devise: base.devise,
    horizon: base.horizon,
    tableaux: {
      compte_resultat: tableau("Compte de résultat prévisionnel", base, COMPTE_RESULTAT),
      bilan: tableau("Bilan prévisionnel", base, BILAN),
      flux_tresorerie: tableau("Tableau des flux de trésorerie", base, FLUX),
      indicateurs: tableau("Indicateurs", base, INDICATEURS),
    },
    series: SERIES_CLES.map(([cle, libelle, extraire]) => ({
      cle,
      libelle,
      scenarios: Object.fromEntries(
        Object.entries(scenarios).map(([nom, r]) => [
          nom,
          r.annees.map((a) => ({ exercice: a.exercice, valeur: extraire(a) })),
        ]),
      ),
    })),
    scenarios: resultat.synthese,
    alertes: base.alertes,
    echeanciers: base.echeanciers,
  };
}

/** Données structurées du rapport du plan, pour un futur export (PDF, DOCX, PPTX). */
export async function donneesRapport(
  db: Db,
  auth: Auth,
  planId: string,
  version: number | undefined,
) {
  const plan = await exigerPlanVisible(db, auth, planId);
  const elements = (await elementsCourants(db, planId)).map(vueElement);
  const reference = await versionReference(db, planId, version);
  const derniere = await derniereVersionModele(db, planId);
  const taux = reference?.resultat.base.hypotheses.tauxActualisation ?? TAUX_ACTUALISATION_DEFAUT;
  const actifs = elements.filter((e) => !e.retire);
  const sections = (
    ["diagnostic", "swot", "vision_mission", "axe", "objectif", "initiative"] as const
  ).map((type) => ({
    type,
    libelle: TYPE_ELEMENT_PLAN_LIBELLES[type],
    elements: actifs.filter((e) => e.type === type),
  }));
  return {
    plan: { ...vuePlan(plan), client_id: plan.client_id },
    /**
     * Même règle que le partage (déclencheur 0181) : tout le contenu validé,
     * la dernière version du modèle validée, et la version retenue aussi.
     */
    pret_pour_client:
      contenuValide(elements) &&
      (derniere === null || derniere.validation !== null) &&
      (reference === null || reference.resume.validation !== null),
    sections,
    feuille_de_route: feuilleDeRoute(elements, "trimestre"),
    roi: { taux_actualisation: taux, initiatives: roiInitiatives(elements, taux) },
    financier: reference ? donneesFinancieres(reference) : null,
  };
}
