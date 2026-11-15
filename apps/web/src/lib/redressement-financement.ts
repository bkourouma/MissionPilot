/**
 * Redressement, onglet « Financement » (RED-06, suite) : vue mensuelle de la trésorerie,
 * covenants financiers et plan de financement. Chemins d'API, textes fixes, libellés,
 * tonalités et mise en forme. Logique pure, testée dans `redressement-financement.test.ts`.
 *
 * Aucun chiffre n'est calculé ici : flux mensuels, marges de covenant, soldes, couvertures et
 * totaux sont ceux de l'API (moteurs). Un covenant dont le seuil n'est pas atteint est un
 * constat arithmétique, jamais une qualification juridique ; une « insuffisance » du plan est un
 * solde négatif, un excédent n'en est pas une.
 */
import {
  creerTraduire,
  type Langue,
  RED_COVENANT_FREQUENCE_LIBELLES,
  RED_COVENANT_MENTION,
  RED_COVENANT_OPERATEUR_LIBELLES,
  RED_COVENANT_RATIO_LIBELLES,
  RED_COVENANT_RAISON_LIBELLES,
  RED_COVENANT_STATUT_LIBELLES,
  RED_FINANCEMENT_NATURE_LIBELLES,
  RED_FINANCEMENT_SENS_LIBELLES,
  RED_FINANCEMENT_STATUT_LIBELLES,
  RED_FINANCEMENT_TYPE_PERIODE_LIBELLES,
  type RedCovenantRatio,
  type RedCovenantStatut,
  type RedCovenantVue,
  type RedFinancementStatut,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterNombre, VALEUR_ABSENTE } from "./format";
import {
  FORME_RATIO,
  formaterPointsDeBase,
  formaterVariationPoints,
  libelleRaisonRatio,
} from "./redressement";

const enc = encodeURIComponent;

// --- Chemins d'API ------------------------------------------------------------------------------------

const base = (dossierId: string) => `/api/redressement/dossiers/${enc(dossierId)}`;
export const cheminTresorerieMensuelle = (dossierId: string) =>
  `${base(dossierId)}/tresorerie/mensuelle`;
export const cheminCovenants = (dossierId: string) => `${base(dossierId)}/covenants`;
export const cheminVersionsCovenants = (dossierId: string) =>
  `${cheminCovenants(dossierId)}/versions`;
export const cheminFinancement = (dossierId: string) => `${base(dossierId)}/financement`;
export const cheminVersionsFinancement = (dossierId: string) =>
  `${cheminFinancement(dossierId)}/versions`;

export interface CadrePropositionFinancement {
  date_debut?: string;
  type_periode?: string;
  nombre_periodes?: number;
}

/** Proposition de lignes (lecture seule : rien n'est enregistré). */
export function cheminPropositionFinancement(
  dossierId: string,
  cadre: CadrePropositionFinancement = {},
): string {
  const r = new URLSearchParams();
  if (cadre.date_debut) r.set("date_debut", cadre.date_debut);
  if (cadre.type_periode) r.set("type_periode", cadre.type_periode);
  if (cadre.nombre_periodes !== undefined) r.set("nombre_periodes", String(cadre.nombre_periodes));
  const texte = r.toString();
  return `${cheminFinancement(dossierId)}/proposition${texte === "" ? "" : `?${texte}`}`;
}

// --- Textes fixes ---------------------------------------------------------------------------------------

export const MENTION_COVENANT = RED_COVENANT_MENTION;
export const TEXTE_CONVENTION_MOIS =
  "Une semaine appartient au mois de son lundi : les chiffres d'un mois ne couvrent que les semaines dont le lundi tombe dans ce mois.";
export const TEXTE_MOIS_PARTIEL =
  "Mois partiel : la fenêtre de 13 semaines ne couvre pas toutes les semaines de ce mois.";
export const TEXTE_MENSUEL_ABSENT =
  "Aucune prévision de trésorerie : la vue mensuelle apparaît dès qu'une première version de la prévision est enregistrée.";
export const TEXTE_COVENANTS_ABSENTS =
  "Aucun covenant saisi. Ajoutez les engagements chiffrés du contrat de financement : l'évaluation est un constat arithmétique sur le dernier exercice accepté.";
export const TEXTE_FINANCEMENT_ABSENT =
  "Aucun plan de financement. Créez-en un à la main ou pré-remplissez-le depuis la trésorerie et les accords.";
export const TEXTE_PROPOSITION =
  "Pré-remplir ne modifie rien : les lignes proposées s'ajoutent au brouillon du formulaire, à relire avant d'enregistrer.";
export const TEXTE_EXCEDENT =
  "Un excédent de ressources n'est pas une insuffisance : seule une période dont les ressources sont inférieures aux emplois est signalée.";

// --- Libellés -----------------------------------------------------------------------------------------

const RATIO_COVENANT_EN: Record<string, string> = {
  liquidite_generale: "Current ratio",
  liquidite_reduite: "Quick ratio",
  liquidite_immediate: "Cash ratio",
  autonomie_financiere: "Financial autonomy",
  solvabilite_generale: "General solvency",
  endettement: "Debt ratio (financial debt / equity)",
  couverture_charges_financieres: "Financial charges coverage",
};
const STATUT_COVENANT_EN: Record<string, string> = {
  respecte: "Threshold met",
  en_defaut: "Threshold not reached (arithmetic observation)",
  non_calculable: "Not computable",
};
const RAISON_COVENANT_EN: Record<string, string> = {
  aucun_etat_accepte: "No accepted financial statement for this client.",
  ratio_non_calculable: "The ratio is not computable: some line items are to be filled in.",
  ratio_sans_objet: "The ratio is not applicable for this fiscal year.",
  ratio_non_significatif: "The ratio is not meaningful for this fiscal year.",
};
const STATUT_FINANCEMENT_EN: Record<string, string> = {
  equilibre: "Balanced (resources at least equal to uses)",
  insuffisance: "Financing shortfall",
};
const NATURE_FINANCEMENT_EN: Record<string, string> = {
  remboursement_dettes_accords: "Repayment of debts and agreements",
  besoin_fonds_roulement: "Working capital need",
  investissements: "Investments",
  charges_restructuration: "Restructuring costs",
  apport_associes: "Partner contributions",
  nouveaux_concours_bancaires: "New bank facilities",
  cessions_actifs: "Asset disposals",
  report_echeances_obtenu: "Deferral of due dates obtained",
  autofinancement: "Self-financing",
};

export const libelleRatioCovenant = (r: RedCovenantRatio, langue: Langue = "fr") =>
  langue === "en" ? (RATIO_COVENANT_EN[r] ?? r) : (RED_COVENANT_RATIO_LIBELLES[r] ?? r);
export const libelleStatutCovenant = (s: RedCovenantStatut, langue: Langue = "fr") =>
  langue === "en" ? (STATUT_COVENANT_EN[s] ?? s) : (RED_COVENANT_STATUT_LIBELLES[s] ?? s);
export const libelleStatutFinancement = (s: RedFinancementStatut, langue: Langue = "fr") =>
  langue === "en" ? (STATUT_FINANCEMENT_EN[s] ?? s) : (RED_FINANCEMENT_STATUT_LIBELLES[s] ?? s);
export const libelleNatureFinancement = (n: string, langue: Langue = "fr") =>
  langue === "en"
    ? (NATURE_FINANCEMENT_EN[n] ?? n)
    : ((RED_FINANCEMENT_NATURE_LIBELLES as Record<string, string>)[n] ?? n);

const FREQUENCE_COVENANT_EN: Record<string, string> = {
  trimestrielle: "Quarterly",
  semestrielle: "Semi-annual",
  annuelle: "Annual",
};
const OPERATEUR_COVENANT_EN: Record<string, string> = {
  min: "At least (floor)",
  max: "At most (ceiling)",
};
const TYPE_PERIODE_EN: Record<string, string> = { annee: "Years", semestre: "Half-years" };
const SENS_FINANCEMENT_EN: Record<string, string> = { emploi: "Uses", ressource: "Resources" };

export const libelleFrequenceCovenant = (f: string, langue: Langue = "fr") =>
  langue === "en"
    ? (FREQUENCE_COVENANT_EN[f] ?? f)
    : ((RED_COVENANT_FREQUENCE_LIBELLES as Record<string, string>)[f] ?? f);
export const libelleOperateurCovenant = (o: string, langue: Langue = "fr") =>
  langue === "en"
    ? (OPERATEUR_COVENANT_EN[o] ?? o)
    : ((RED_COVENANT_OPERATEUR_LIBELLES as Record<string, string>)[o] ?? o);
export const libelleTypePeriodeFinancement = (p: string, langue: Langue = "fr") =>
  langue === "en"
    ? (TYPE_PERIODE_EN[p] ?? p)
    : ((RED_FINANCEMENT_TYPE_PERIODE_LIBELLES as Record<string, string>)[p] ?? p);
export const libelleSensFinancement = (s: string, langue: Langue = "fr") =>
  langue === "en"
    ? (SENS_FINANCEMENT_EN[s] ?? s)
    : ((RED_FINANCEMENT_SENS_LIBELLES as Record<string, string>)[s] ?? s);

/** Mention fixe des covenants (« constat arithmétique », jamais une qualification). */
export const mentionCovenant = (langue: Langue = "fr") =>
  langue === "en"
    ? "Arithmetic observation of the accepted fiscal year's ratio against the entered threshold: it does not characterize the position under the financing agreement."
    : MENTION_COVENANT;

export function tonaliteStatutCovenant(s: RedCovenantStatut): TonaliteStatut {
  if (s === "respecte") return "succes";
  if (s === "en_defaut") return "attention";
  return "neutre";
}

export function tonaliteStatutFinancement(s: RedFinancementStatut): TonaliteStatut {
  return s === "equilibre" ? "succes" : "attention";
}

const MOIS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Textes fixes de l'onglet, dans la langue demandée. */
export function textesFinancement(langue: Langue = "fr") {
  const t = creerTraduire(langue);
  return {
    conventionMois: t(
      TEXTE_CONVENTION_MOIS,
      "A week belongs to the month of its Monday: a month's figures only cover the weeks whose Monday falls in that month.",
    ),
    moisPartiel: t(
      TEXTE_MOIS_PARTIEL,
      "Partial month: the 13-week window does not cover all the weeks of this month.",
    ),
    mensuelAbsent: t(
      TEXTE_MENSUEL_ABSENT,
      "No cash forecast: the monthly view appears as soon as a first version of the forecast is saved.",
    ),
    covenantsAbsents: t(
      TEXTE_COVENANTS_ABSENTS,
      "No covenant entered. Add the quantified commitments of the financing agreement: the assessment is an arithmetic observation on the last accepted fiscal year.",
    ),
    financementAbsent: t(
      TEXTE_FINANCEMENT_ABSENT,
      "No financing plan. Create one by hand or pre-fill it from the cash forecast and the agreements.",
    ),
    proposition: t(
      TEXTE_PROPOSITION,
      "Pre-filling changes nothing: the proposed lines are added to the form draft, to be reviewed before saving.",
    ),
    excedent: t(
      TEXTE_EXCEDENT,
      "A surplus of resources is not a shortfall: only a period whose resources are lower than its uses is flagged.",
    ),
  };
}

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** « 2026-03 » devient « mars 2026 » ; une valeur illisible est rendue telle quelle. */
export function libelleMois(mois: string, langue: Langue = "fr"): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mois);
  if (!m) return mois;
  return `${(langue === "en" ? MOIS_EN : MOIS)[Number(m[2]) - 1]} ${m[1]}`;
}

/** « 2 semaines » / « 1 semaine » (semaines réalisées d'un mois). */
export const libelleNombreSemaines = (n: number, langue: Langue = "fr") =>
  `${n} ${langue === "en" ? "week" : "semaine"}${n > 1 ? "s" : ""}`;

/** « semaines 3, 4 » / « semaine 3 » ; liste vide : « — ». */
export function libelleSemainesTension(semaines: readonly number[], langue: Langue = "fr"): string {
  if (semaines.length === 0) return VALEUR_ABSENTE;
  const mot = langue === "en" ? "week" : "semaine";
  return `${mot}${semaines.length > 1 ? "s" : ""} ${semaines.join(", ")}`;
}

// --- Covenants : seuils, valeurs et marges ---------------------------------------------------------------

/** Forme d'affichage d'un ratio de covenant (celle du ratio correspondant du module). */
export const formeCovenant = (r: RedCovenantRatio): "ratio" | "pourcentage" =>
  FORME_RATIO[r] === "pourcentage" ? "pourcentage" : "ratio";

/** Seuil ou valeur en points de base : « 1,20 » (rapport) ou « 25,00 % » (pourcentage). */
export const formaterValeurCovenant = (
  r: RedCovenantRatio,
  pb: number | null | undefined,
  langue: Langue = "fr",
) => formaterPointsDeBase(pb, formeCovenant(r), langue);

/**
 * Marge (valeur moins plancher, ou plafond moins valeur) : positive quand le seuil est respecté
 * avec de la marge. Un pourcentage s'écrit en points (« +2,5 points »), un rapport en nombre
 * signé (« +0,20 »).
 */
export function formaterMargeCovenant(
  r: RedCovenantRatio,
  pb: number | null | undefined,
  langue: Langue = "fr",
): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  if (formeCovenant(r) === "pourcentage") return formaterVariationPoints(pb, langue);
  const texte = formaterPointsDeBase(pb, "ratio", langue);
  return pb > 0 ? `+${texte}` : texte;
}

/** « Au moins 1,20 » / « Au plus 2,00 ». */
export function libelleExigenceCovenant(
  c: Pick<RedCovenantVue, "ratio" | "operateur" | "seuil_pb">,
  langue: Langue = "fr",
): string {
  const mot =
    langue === "en"
      ? c.operateur === "min"
        ? "At least"
        : "At most"
      : c.operateur === "min"
        ? "Au moins"
        : "Au plus";
  return `${mot} ${formaterValeurCovenant(c.ratio, c.seuil_pb, langue)}`;
}

/** Raison d'un covenant non calculable, avec les postes à renseigner. */
export function libelleRaisonCovenant(c: RedCovenantVue): string {
  const e = c.evaluation;
  if (e.raison === null) return "";
  if (e.raison === "ratio_non_calculable" && e.manquants.length > 0) {
    return libelleRaisonRatio("postes_manquants", e.manquants);
  }
  return RED_COVENANT_RAISON_LIBELLES[e.raison] ?? e.raison;
}

/** Raison d'un covenant non calculable, dans la langue demandée. */
export function libelleRaisonCovenantLangue(c: RedCovenantVue, langue: Langue = "fr"): string {
  if (langue !== "en") return libelleRaisonCovenant(c);
  const e = c.evaluation;
  if (e.raison === null) return "";
  if (e.raison === "ratio_non_calculable" && e.manquants.length > 0) {
    return libelleRaisonRatio("postes_manquants", e.manquants, langue);
  }
  return RAISON_COVENANT_EN[e.raison] ?? e.raison;
}

/** Couverture en points de base de l'API : « 125 % » ; absente : « — ». */
export function formaterCouverture(pb: number | null | undefined, langue: Langue = "fr"): string {
  if (typeof pb !== "number" || !Number.isFinite(pb)) return VALEUR_ABSENTE;
  return langue === "en"
    ? `${formaterNombre(pb / 100, 1, langue)}%`
    : `${formaterNombre(pb / 100, 1)} %`;
}

/** Tous les textes de ce module, à scanner (aucune qualification juridique). */
export function libellesFinancement(): string[] {
  return [
    MENTION_COVENANT,
    TEXTE_CONVENTION_MOIS,
    TEXTE_MOIS_PARTIEL,
    TEXTE_MENSUEL_ABSENT,
    TEXTE_COVENANTS_ABSENTS,
    TEXTE_FINANCEMENT_ABSENT,
    TEXTE_PROPOSITION,
    TEXTE_EXCEDENT,
    ...Object.values(RED_COVENANT_STATUT_LIBELLES),
    ...Object.values(RED_COVENANT_RAISON_LIBELLES),
    ...Object.values(RED_FINANCEMENT_STATUT_LIBELLES),
  ];
}
