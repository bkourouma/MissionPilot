/** Redressement : mise en forme des ratios, de l'alerte précoce, de la synthèse du dossier et de la trésorerie. Aucun recalcul. */
import {
  LOCALES_INTL,
  RED_RAISON_RATIO_LIBELLES,
  RED_SOURCE_SEUILS_LIBELLES,
  RED_STATUT_RATIO_LIBELLES,
  type Langue,
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

const traducteur = (langue: Langue) => (fr: string, en: string) => (langue === "en" ? en : fr);

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

/** Version anglaise des formules (même clés). */
export const FORMULES_RATIO_EN: Record<RedCleRatio, string> = {
  liquidite_generale: "(Inventory + receivables + cash) ÷ short-term debt",
  liquidite_reduite: "(Receivables + cash) ÷ short-term debt",
  liquidite_immediate: "Cash ÷ short-term debt",
  autonomie_financiere: "Equity ÷ total liabilities and equity",
  solvabilite_generale: "Total assets ÷ debt (liabilities − equity)",
  endettement: "Financial debt ÷ equity",
  marge_brute: "(Revenue − cost of sales) ÷ revenue",
  marge_nette: "Net income ÷ revenue",
  couverture_charges_financieres: "Operating income ÷ financial expenses",
  bfr_jours: "(Inventory + trade receivables − trade payables) ÷ revenue × 360 days",
};

/** Formule d'un ratio dans la langue demandée. */
export const formuleRatio = (cle: RedCleRatio, langue: Langue = "fr"): string =>
  (langue === "en" ? FORMULES_RATIO_EN : FORMULES_RATIO)[cle];

const formatDeuxDecimales = (langue: Langue) =>
  new Intl.NumberFormat(LOCALES_INTL[langue], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const formatPourcentage = (langue: Langue) =>
  new Intl.NumberFormat(LOCALES_INTL[langue], {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Points de base (10 000 = 1) → « 1,36 » ou « 18,75 % » selon la forme ; `null` → « — ». */
export function formaterPointsDeBase(
  valeur: number | null | undefined,
  forme: "ratio" | "pourcentage",
  langue: Langue = "fr",
): string {
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  return forme === "pourcentage"
    ? formatPourcentage(langue).format(valeur / 10_000)
    : formatDeuxDecimales(langue).format(valeur / 10_000);
}

function formaterSelonForme(
  forme: FormeValeur,
  valeur: number | null | undefined,
  langue: Langue,
): string {
  const t = traducteur(langue);
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) return VALEUR_ABSENTE;
  if (forme === "ratio" || forme === "pourcentage") {
    return formaterPointsDeBase(valeur, forme, langue);
  }
  if (forme === "points") return formaterVariationPoints(valeur, langue);
  if (forme === "jours") {
    const unite = Math.abs(valeur) > 1 ? t("jours", "days") : t("jour", "day");
    return `${formaterNombre(valeur, 0, langue)} ${unite}`;
  }
  if (forme === "oui_non") return valeur > 0 ? t("Oui", "Yes") : t("Non", "No");
  return formaterNombre(valeur, 0, langue);
}

/**
 * Valeur d'un ratio : liquidités, solvabilité, couverture et endettement en rapport (13636 →
 * « 1,36 ») ; autonomie et marges en pourcentage (1875 → « 18,75 % ») ; BFR en jours (54 →
 * « 54 jours »).
 */
export function formaterValeurRatio(
  cle: RedCleRatio,
  valeur: number | null | undefined,
  langue: Langue = "fr",
): string {
  return formaterSelonForme(FORME_RATIO[cle] ?? "nombre", valeur, langue);
}

/** Valeur d'un critère de l'alerte précoce (même mise en forme que le ratio correspondant). */
export function formaterValeurCritere(
  critere: RedCritereAlerte,
  valeur: number | null | undefined,
  langue: Langue = "fr",
): string {
  return formaterSelonForme(FORME_CRITERE[critere] ?? "nombre", valeur, langue);
}

/** Seuil d'un critère : même mise en forme que la valeur, sauf « oui / non » (valeur technique). */
export function formaterSeuil(
  critere: RedCritereAlerte,
  valeur: number | null | undefined,
  langue: Langue = "fr",
): string {
  if (FORME_CRITERE[critere] === "oui_non") return formaterNombre(valeur, 0, langue);
  return formaterValeurCritere(critere, valeur, langue);
}

const enMinuscule = (t: string) => (t === "" ? t : t.charAt(0).toLowerCase() + t.slice(1));

const RAISON_RATIO_EN: Record<RedRaisonRatio, string> = {
  postes_manquants: "Items to fill in",
  totaux_absents: "Balance sheet totals missing",
  denominateur_non_positif: "Zero or negative denominator",
  sans_dette: "No debt",
  sans_charges_financieres: "No financial expenses",
};
const STATUT_RATIO_EN: Record<string, string> = {
  calcule: "Computed",
  sans_objet: "Not applicable",
  non_calculable: "Not computable",
  non_significatif: "Not meaningful",
};
const SOURCE_SEUILS_EN: Record<RedSourceSeuils, string> = {
  cabinet: "Firm thresholds",
  defaut_moteur: "Default thresholds (provisional)",
};

/** « Postes à renseigner : Stocks, Créances clients » ; les autres raisons gardent leur libellé. */
export function libelleRaisonRatio(
  raison: RedRaisonRatio | null,
  manquants: readonly string[] = [],
  langue: Langue = "fr",
): string {
  if (raison === null) return "";
  const libelle =
    (langue === "en" ? RAISON_RATIO_EN[raison] : RED_RAISON_RATIO_LIBELLES[raison]) ?? raison;
  if (raison === "postes_manquants" && manquants.length > 0) {
    return `${libelle} : ${manquants.map((p) => libellePoste(p, langue)).join(", ")}`;
  }
  return libelle;
}

/**
 * Texte d'une cellule du tableau des ratios : la valeur formatée, ou le statut avec sa raison
 * (« Non calculable : postes à renseigner (Stocks, …) », « Non significatif : capitaux propres
 * négatifs ou nuls »).
 */
export function libelleStatutRatio(
  cle: RedCleRatio,
  ratio: RedRatioVue,
  langue: Langue = "fr",
): string {
  const t = traducteur(langue);
  if (ratio.statut === "calcule") return formaterValeurRatio(cle, ratio.valeur, langue);
  const statut =
    (langue === "en" ? STATUT_RATIO_EN[ratio.statut] : RED_STATUT_RATIO_LIBELLES[ratio.statut]) ??
    ratio.statut;
  if (ratio.statut === "non_significatif" && ratio.raison === "denominateur_non_positif") {
    return `${statut} : ${t("capitaux propres négatifs ou nuls", "negative or zero equity")}`;
  }
  if (ratio.raison === "postes_manquants") {
    const noms = ratio.manquants.map((p) => libellePoste(p, langue)).join(", ");
    return `${statut} : ${t("postes à renseigner", "items to fill in")}${noms ? ` (${noms})` : ""}`;
  }
  if (ratio.raison === null) return statut;
  return `${statut} : ${enMinuscule(libelleRaisonRatio(ratio.raison, [], langue))}`;
}

/** Motif d'un critère de l'alerte précoce (« — » quand le critère est évalué normalement). */
export function motifCritere(
  motif: "signal_critique" | "sans_objet" | "non_calculable" | "non_renseigne" | null,
  langue: Langue = "fr",
): string {
  const t = traducteur(langue);
  if (motif === "signal_critique") return t("Signal critique", "Critical signal");
  if (motif === "sans_objet") return t("Sans objet", "Not applicable");
  if (motif === "non_calculable") return t("Non calculable", "Not computable");
  if (motif === "non_renseigne") return t("Non renseigné", "Not provided");
  return VALEUR_ABSENTE;
}

/** Tendances : « +12,50 % » / « -3,00 % » (points de base de l'API) ; `null` → « — ». */
export function formaterTendance(pb: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  const texte = formaterPointsDeBase(pb, "pourcentage", langue);
  return pb > 0 ? `+${texte}` : texte;
}

/**
 * Variation d'un ratio exprimé en pourcentage (marge brute, marge nette…), en POINTS de
 * pourcentage et non en pourcentage : 250 points de base → « +2,5 points », -100 → « -1 point »,
 * 0 → « 0 point ». Une marge qui passe de 20 % à 22,5 % gagne 2,5 points (et non 12,5 %).
 */
export function formaterVariationPoints(
  pb: number | null | undefined,
  langue: Langue = "fr",
): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  const points = pb / 100;
  const texte = formaterNombre(points, 2, langue);
  const unite = Math.abs(points) >= 2 ? "points" : "point";
  return `${points > 0 ? "+" : ""}${texte} ${unite}`;
}

// --- Alerte précoce -------------------------------------------------------------------------------

/** « Seuils du cabinet, secteur Général, version 2 » ou « Seuils par défaut du moteur (provisoires) ». */
export function libelleSourceSeuils(
  source: RedSourceSeuils,
  secteur: RedSecteur | null,
  version: number | null,
  langue: Langue = "fr",
): string {
  const t = traducteur(langue);
  if (source === "defaut_moteur") {
    return t(
      "Seuils par défaut du moteur (provisoires)",
      "Engine default thresholds (provisional)",
    );
  }
  const base = (langue === "en" ? SOURCE_SEUILS_EN : RED_SOURCE_SEUILS_LIBELLES)[source];
  const sect = secteur ? `, ${t("secteur", "sector")} ${libelleSecteur(secteur, langue)}` : "";
  const v = version !== null ? `, version ${version}` : "";
  return `${base}${sect}${v}`;
}

/** Score sur 100 ou « Données insuffisantes ». */
export function libelleScore(
  score: number | null,
  niveau: RedNiveauAlerte,
  langue: Langue = "fr",
): string {
  const t = traducteur(langue);
  if (score === null || niveau === "insuffisant") {
    return t("Données insuffisantes", "Insufficient data");
  }
  return `${formaterNombre(score, 0, langue)} ${t("sur", "out of")} 100`;
}

/** Unité affichée à côté des seuils d'un critère (aide de l'éditeur). */
export function uniteCritere(critere: RedCritereAlerte, langue: Langue = "fr"): string {
  const t = traducteur(langue);
  const forme = FORME_CRITERE[critere];
  if (forme === "ratio") return t("rapport (1,00 = 100 %)", "ratio (1.00 = 100%)");
  if (forme === "pourcentage") return t("pourcentage", "percentage");
  if (forme === "points") return t("points de pourcentage", "percentage points");
  if (forme === "jours") return t("jours", "days");
  if (forme === "oui_non") {
    return t(
      "0 : un arriéré déclaré suffit (valeur technique)",
      "0: a single declared arrear is enough (technical value)",
    );
  }
  return t("nombre d'incidents", "number of incidents");
}

/** Sens de lecture d'un critère, en français (affiché dans le tableau des seuils). */
export function libelleSensCritere(sens: "bas_pire" | "haut_pire", langue: Langue = "fr"): string {
  const t = traducteur(langue);
  return sens === "bas_pire"
    ? t(
        "Plus la valeur est basse, plus c'est préoccupant",
        "The lower the value, the more concerning",
      )
    : t(
        "Plus la valeur est haute, plus c'est préoccupant",
        "The higher the value, the more concerning",
      );
}

// --- Synthèse du dossier ------------------------------------------------------------------------

/** Libellé de la carte Trésorerie de la synthèse. */
export function libellePremiereTension(
  tresorerie: RedDossierVue["tresorerie"],
  langue: Langue = "fr",
): string {
  const t = traducteur(langue);
  if (tresorerie === null) return t("Aucune prévision", "No forecast");
  if (tresorerie.premiere_semaine_tension === null) {
    return t("Aucune semaine de tension sur 13 semaines", "No tight week over the 13-week window");
  }
  return `${t("Première semaine de tension : semaine", "First tight week: week")} ${tresorerie.premiere_semaine_tension}`;
}

/** « 33 % » : avancement en points de base de l'API ; `null` → « Sans objet ». */
export function libelleAvancement(pb: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof pb !== "number" || !Number.isFinite(pb))
    return traducteur(langue)("Sans objet", "N/A");
  return `${formaterNombre(pb / 100, 0, langue)} %`;
}

/** Largeur (0 à 100) d'une barre d'avancement ; la valeur est celle de l'API, bornée pour l'affichage. */
export function largeurBarre(pb: number | null | undefined): number {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return 0;
  return Math.min(100, Math.max(0, Math.round(pb / 100)));
}

/** « Écart avec la version validée : 1 ajoutée(s), 0 retirée(s), 2 modifiée(s) ». */
export function libelleEcartPlan(e: RedEcartPlanVue, langue: Langue = "fr"): string {
  if (langue === "en") {
    return `Difference from the approved version: ${e.ajoutees.length} added, ${e.retirees.length} removed, ${e.modifiees.length} edited`;
  }
  return `Écart avec la version validée : ${e.ajoutees.length} ajoutée(s), ${e.retirees.length} retirée(s), ${e.modifiees.length} modifiée(s)`;
}

// --- Trésorerie -----------------------------------------------------------------------------------

/** « 2 nov. 2026 au 8 nov. 2026 » (dates de début et de fin d'une semaine de la fenêtre). */
export function formaterSemaine(debut: string, fin: string, langue: Langue = "fr"): string {
  return `${formaterDate(debut, "UTC", langue)} ${langue === "en" ? "to" : "au"} ${formaterDate(fin, "UTC", langue)}`;
}

/** Abréviation d'une semaine : « S4 » (« W4 » en anglais). */
export const abregerSemaine = (n: number, langue: Langue = "fr") =>
  `${langue === "en" ? "W" : "S"}${n}`;
