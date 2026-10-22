/** Redressement : mise en forme des ratios, de l'alerte précoce, de la synthèse du dossier et de la trésorerie. Aucun recalcul. */
import {
  RED_RAISON_RATIO_LIBELLES,
  RED_SOURCE_SEUILS_LIBELLES,
  RED_STATUT_RATIO_LIBELLES,
  type RedCleRatio,
  type RedCritereAlerte,
  type RedDossierVue,
  type RedEcartPlanVue,
  type RedNiveauAlerte,
  type RedRaisonRatio,
  type RedRatioVue,
  type RedSecteur,
  type RedSourceSeuils,
} from "@missionpilot/shared";
import { formaterDate, formaterNombre, VALEUR_ABSENTE } from "./format";
import { libelleSecteur, libellePoste } from "./redressement-libelles";

// --- Ratios -----------------------------------------------------------------------------------------

/** Forme d'affichage de la valeur d'un ratio ou d'un critère (la valeur vient de l'API). */
export type FormeValeur = "ratio" | "pourcentage" | "points" | "jours" | "nombre" | "oui_non";

export const FORME_RATIO: Record<RedCleRatio, FormeValeur> = {
  liquidite_generale: "ratio",
  liquidite_reduite: "ratio",
  liquidite_immediate: "ratio",
  autonomie_financiere: "pourcentage",
  solvabilite_generale: "ratio",
  endettement: "ratio",
  marge_brute: "pourcentage",
  marge_nette: "pourcentage",
  couverture_charges_financieres: "ratio",
  bfr_jours: "jours",
};

export const FORME_CRITERE: Record<RedCritereAlerte, FormeValeur> = {
  liquidite_generale: "ratio",
  liquidite_immediate: "ratio",
  autonomie_financiere: "pourcentage",
  endettement: "ratio",
  couverture_charges_financieres: "ratio",
  marge_nette: "pourcentage",
  bfr_jours: "jours",
  croissance_ca: "pourcentage",
  variation_marge_brute: "points",
  rejets_bancaires_12m: "nombre",
  retards_fournisseurs_90j: "nombre",
  arrieres_fiscaux_sociaux: "oui_non",
};

/** Formule courte de chaque ratio (aide à la lecture : le calcul est celui du moteur). */
export const FORMULES_RATIO: Record<RedCleRatio, string> = {
  liquidite_generale: "(Stocks + créances + trésorerie) ÷ dettes à court terme",
  liquidite_reduite: "(Créances + trésorerie) ÷ dettes à court terme",
  liquidite_immediate: "Trésorerie ÷ dettes à court terme",
  autonomie_financiere: "Capitaux propres ÷ total du passif",
  solvabilite_generale: "Total de l'actif ÷ dettes (passif − capitaux propres)",
  endettement: "Dettes financières ÷ capitaux propres",
  marge_brute: "(Chiffre d'affaires − coût des ventes) ÷ chiffre d'affaires",
  marge_nette: "Résultat net ÷ chiffre d'affaires",
  couverture_charges_financieres: "Résultat d'exploitation ÷ charges financières",
  bfr_jours: "(Stocks + créances clients − dettes fournisseurs) ÷ chiffre d'affaires × 360 jours",
};

const DEUX_DECIMALES = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const POURCENTAGE = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Points de base (10 000 = 1) → « 1,36 » ou « 18,75 % » selon la forme ; `null` → « — ». */
export function formaterPointsDeBase(
  valeur: number | null | undefined,
  forme: "ratio" | "pourcentage",
): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  return forme === "pourcentage"
    ? POURCENTAGE.format(valeur / 10_000)
    : DEUX_DECIMALES.format(valeur / 10_000);
}

function formaterSelonForme(forme: FormeValeur, valeur: number | null | undefined): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  if (forme === "ratio" || forme === "pourcentage") return formaterPointsDeBase(valeur, forme);
  if (forme === "points") return formaterVariationPoints(valeur);
  if (forme === "jours")
    return `${formaterNombre(valeur, 0)} ${Math.abs(valeur) > 1 ? "jours" : "jour"}`;
  if (forme === "oui_non") return valeur > 0 ? "Oui" : "Non";
  return formaterNombre(valeur, 0);
}

/**
 * Valeur d'un ratio : liquidités, solvabilité, couverture et endettement en rapport (13636 →
 * « 1,36 ») ; autonomie et marges en pourcentage (1875 → « 18,75 % ») ; BFR en jours (54 →
 * « 54 jours »).
 */
export function formaterValeurRatio(cle: RedCleRatio, valeur: number | null | undefined): string {
  return formaterSelonForme(FORME_RATIO[cle] ?? "nombre", valeur);
}

/** Valeur d'un critère de l'alerte précoce (même mise en forme que le ratio correspondant). */
export function formaterValeurCritere(
  critere: RedCritereAlerte,
  valeur: number | null | undefined,
): string {
  return formaterSelonForme(FORME_CRITERE[critere] ?? "nombre", valeur);
}

/** Seuil d'un critère : même mise en forme que la valeur, sauf « oui / non » (valeur technique). */
export function formaterSeuil(
  critere: RedCritereAlerte,
  valeur: number | null | undefined,
): string {
  if (FORME_CRITERE[critere] === "oui_non") return formaterNombre(valeur, 0);
  return formaterValeurCritere(critere, valeur);
}

const enMinuscule = (t: string) => (t === "" ? t : t.charAt(0).toLowerCase() + t.slice(1));

/** « Postes à renseigner : Stocks, Créances clients » ; les autres raisons gardent leur libellé. */
export function libelleRaisonRatio(
  raison: RedRaisonRatio | null,
  manquants: readonly string[] = [],
): string {
  if (raison === null) return "";
  const libelle = RED_RAISON_RATIO_LIBELLES[raison] ?? raison;
  if (raison === "postes_manquants" && manquants.length > 0) {
    return `${libelle} : ${manquants.map(libellePoste).join(", ")}`;
  }
  return libelle;
}

/**
 * Texte d'une cellule du tableau des ratios : la valeur formatée, ou le statut avec sa raison
 * (« Non calculable : postes à renseigner (Stocks, …) », « Non significatif : capitaux propres
 * négatifs ou nuls »).
 */
export function libelleStatutRatio(cle: RedCleRatio, ratio: RedRatioVue): string {
  if (ratio.statut === "calcule") return formaterValeurRatio(cle, ratio.valeur);
  const statut = RED_STATUT_RATIO_LIBELLES[ratio.statut] ?? ratio.statut;
  if (ratio.statut === "non_significatif" && ratio.raison === "denominateur_non_positif") {
    return `${statut} : capitaux propres négatifs ou nuls`;
  }
  if (ratio.raison === "postes_manquants") {
    const noms = ratio.manquants.map(libellePoste).join(", ");
    return `${statut} : postes à renseigner${noms ? ` (${noms})` : ""}`;
  }
  if (ratio.raison === null) return statut;
  return `${statut} : ${enMinuscule(libelleRaisonRatio(ratio.raison))}`;
}

/** Motif d'un critère de l'alerte précoce (« — » quand le critère est évalué normalement). */
export function motifCritere(
  motif: "signal_critique" | "sans_objet" | "non_calculable" | "non_renseigne" | null,
): string {
  if (motif === "signal_critique") return "Signal critique";
  if (motif === "sans_objet") return "Sans objet";
  if (motif === "non_calculable") return "Non calculable";
  if (motif === "non_renseigne") return "Non renseigné";
  return VALEUR_ABSENTE;
}

/** Tendances : « +12,50 % » / « -3,00 % » (points de base de l'API) ; `null` → « — ». */
export function formaterTendance(pb: number | null | undefined): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  const texte = formaterPointsDeBase(pb, "pourcentage");
  return pb > 0 ? `+${texte}` : texte;
}

/**
 * Variation d'un ratio exprimé en pourcentage (marge brute, marge nette…), en POINTS de
 * pourcentage et non en pourcentage : 250 points de base → « +2,5 points », -100 → « -1 point »,
 * 0 → « 0 point ». Une marge qui passe de 20 % à 22,5 % gagne 2,5 points (et non 12,5 %).
 */
export function formaterVariationPoints(pb: number | null | undefined): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  const points = pb / 100;
  const texte = formaterNombre(points, 2);
  const unite = Math.abs(points) >= 2 ? "points" : "point";
  return `${points > 0 ? "+" : ""}${texte} ${unite}`;
}

// --- Alerte précoce -------------------------------------------------------------------------------

/** « Seuils du cabinet, secteur Général, version 2 » ou « Seuils par défaut du moteur (provisoires) ». */
export function libelleSourceSeuils(
  source: RedSourceSeuils,
  secteur: RedSecteur | null,
  version: number | null,
): string {
  if (source === "defaut_moteur") return "Seuils par défaut du moteur (provisoires)";
  const base = RED_SOURCE_SEUILS_LIBELLES[source];
  const sect = secteur ? `, secteur ${libelleSecteur(secteur)}` : "";
  const v = version !== null ? `, version ${version}` : "";
  return `${base}${sect}${v}`;
}

/** Score sur 100 ou « Données insuffisantes ». */
export function libelleScore(score: number | null, niveau: RedNiveauAlerte): string {
  if (score === null || niveau === "insuffisant") return "Données insuffisantes";
  return `${formaterNombre(score, 0)} sur 100`;
}

/** Unité affichée à côté des seuils d'un critère (aide de l'éditeur). */
export function uniteCritere(critere: RedCritereAlerte): string {
  const forme = FORME_CRITERE[critere];
  if (forme === "ratio") return "rapport (1,00 = 100 %)";
  if (forme === "pourcentage") return "pourcentage";
  if (forme === "points") return "points de pourcentage";
  if (forme === "jours") return "jours";
  if (forme === "oui_non") return "0 : un arriéré déclaré suffit (valeur technique)";
  return "nombre d'incidents";
}

/** Sens de lecture d'un critère, en français (affiché dans le tableau des seuils). */
export function libelleSensCritere(sens: "bas_pire" | "haut_pire"): string {
  return sens === "bas_pire"
    ? "Plus la valeur est basse, plus c'est préoccupant"
    : "Plus la valeur est haute, plus c'est préoccupant";
}

// --- Synthèse du dossier ------------------------------------------------------------------------

/** Libellé de la carte Trésorerie de la synthèse. */
export function libellePremiereTension(t: RedDossierVue["tresorerie"]): string {
  if (t === null) return "Aucune prévision";
  if (t.premiere_semaine_tension === null) return "Aucune semaine de tension sur 13 semaines";
  return `Première semaine de tension : semaine ${t.premiere_semaine_tension}`;
}

/** « 33 % » : avancement en points de base de l'API ; `null` → « Sans objet ». */
export function libelleAvancement(pb: number | null | undefined): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return "Sans objet";
  return `${formaterNombre(pb / 100, 0)} %`;
}

/** Largeur (0 à 100) d'une barre d'avancement ; la valeur est celle de l'API, bornée pour l'affichage. */
export function largeurBarre(pb: number | null | undefined): number {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return 0;
  return Math.min(100, Math.max(0, Math.round(pb / 100)));
}

/** « Écart avec la version validée : 1 ajoutée(s), 0 retirée(s), 2 modifiée(s) ». */
export function libelleEcartPlan(e: RedEcartPlanVue): string {
  return `Écart avec la version validée : ${e.ajoutees.length} ajoutée(s), ${e.retirees.length} retirée(s), ${e.modifiees.length} modifiée(s)`;
}

// --- Trésorerie -----------------------------------------------------------------------------------

/** « 2 nov. 2026 au 8 nov. 2026 » (dates de début et de fin d'une semaine de la fenêtre). */
export function formaterSemaine(debut: string, fin: string): string {
  return `${formaterDate(debut)} au ${formaterDate(fin)}`;
}

/** Abréviation d'une semaine : « S4 ». */
export const abregerSemaine = (n: number) => `S${n}`;
