/**
 * Redressement, tableau de bord (RED-15, version INTERNE) : chemins d'API, liens, filtres lus de
 * l'URL, libellés, tonalités et mise en forme. Logique pure, testée dans `redressement-tableau.test.ts`.
 *
 * Aucun calcul métier : voyant, motifs, soldes, ratios (points de base) et totaux sortent de l'API
 * et de ses moteurs ; ce module les MET EN FORME et ne les additionne jamais. Le voyant est
 * INDICATIF : une aide de pilotage, jamais une qualification juridique de la situation du client.
 * Réservé au cabinet : aucun lien de partage, aucune route du portail.
 */
import {
  creerTraduire,
  type Langue,
  RED_GRAVITE_MOTIF_LIBELLES,
  RED_STATUT_CLOTURE_DOSSIER_LIBELLES,
  RED_TABLEAU_LIMITE_DEFAUT,
  RED_TABLEAU_LIMITE_MAX,
  RED_TABLEAU_MENTION,
  RED_VOYANT_PILOTAGE_LIBELLES,
  RED_VOYANTS_PILOTAGE,
  type RedGraviteMotif,
  type RedIndicateurTableauVue,
  type RedNiveauAlerte,
  type RedSecteur,
  type RedStatutDossier,
  type RedVoyant,
  type RedVoyantPilotage,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterNombre, VALEUR_ABSENTE } from "./format";
import {
  libelleNiveauAlerte,
  libelleVoyant,
  lireFiltresPortefeuille,
  type SectionRedressement,
} from "./redressement";

const enc = encodeURIComponent;

// --- Chemins d'API et liens ---------------------------------------------------------------------------

export const cheminTableauDossier = (dossierId: string) =>
  `/api/redressement/dossiers/${enc(dossierId)}/tableau-de-bord`;

export interface FiltresTableau {
  statut?: RedStatutDossier;
  secteur?: RedSecteur;
  limite: number;
  curseur?: string;
}

export const HREF_TABLEAU_PORTEFEUILLE = "/redressement/tableau-de-bord";
export const LIMITES_TABLEAU = [10, 25] as const;

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filtres lus dans l'URL : une valeur hors liste est ignorée ; la limite est bornée (1 à 25). */
export function lireFiltresTableau(
  p: Record<string, string | string[] | undefined>,
): FiltresTableau {
  const base = lireFiltresPortefeuille(p);
  const brut = Number.parseInt(un(p.limite), 10);
  const limite =
    Number.isInteger(brut) && brut >= 1
      ? Math.min(brut, RED_TABLEAU_LIMITE_MAX)
      : RED_TABLEAU_LIMITE_DEFAUT;
  return { statut: base.statut, secteur: base.secteur, curseur: base.curseur, limite };
}

function requete(filtres: FiltresTableau, avecLimiteDefaut: boolean): string {
  const r = new URLSearchParams();
  if (avecLimiteDefaut || filtres.limite !== RED_TABLEAU_LIMITE_DEFAUT) {
    r.set("limite", String(filtres.limite));
  }
  if (filtres.statut) r.set("statut", filtres.statut);
  if (filtres.secteur) r.set("secteur", filtres.secteur);
  if (filtres.curseur) r.set("curseur", filtres.curseur);
  return r.toString();
}

export const cheminTableauPortefeuille = (filtres: FiltresTableau) =>
  `/api/redressement/tableau-de-bord?${requete(filtres, true)}`;

/** Lien de la page du portefeuille ; la limite par défaut n'est pas répétée dans l'URL. */
export function hrefTableauPortefeuille(filtres: FiltresTableau): string {
  const texte = requete(filtres, false);
  return texte === "" ? HREF_TABLEAU_PORTEFEUILLE : `${HREF_TABLEAU_PORTEFEUILLE}?${texte}`;
}

// --- Textes fixes -----------------------------------------------------------------------------------------

export const MENTION_TABLEAU = RED_TABLEAU_MENTION;
export const TEXTE_TABLEAU_INTERNE =
  "Tableau réservé aux utilisateurs du cabinet : il n'est pas partagé avec le portail client. Il peut être présenté en séance depuis votre poste (bouton « Imprimer »).";
export const TEXTE_PORTEFEUILLE_PAGE =
  "La synthèse ci-dessous porte uniquement sur les dossiers de la page affichée, pas sur l'ensemble du portefeuille.";
export const TEXTE_PORTEFEUILLE_VIDE =
  "Aucun dossier de redressement ne correspond à ces filtres parmi les missions que vous pouvez consulter.";
export const TEXTE_CAUSES_NON_VALIDEES =
  "Proposition à valider : ces causes n'ont pas encore été validées par un expert.";
export const TEXTE_CAUSES_PLUS_RECENTE =
  "Une version plus récente existe mais n'est pas encore validée.";
export const TEXTE_COVENANT_CONSTAT =
  "Constat arithmétique du ratio saisi par rapport au seuil renseigné ; il ne qualifie pas la situation du client.";

/** Textes fixes du tableau de bord, dans la langue demandée. */
export function textesTableau(langue: Langue = "fr") {
  const t = creerTraduire(langue);
  return {
    mention: t(
      MENTION_TABLEAU,
      "The steering light is an internal indicator, computed from the data entered in the file: it helps order priorities and does not characterize the client's legal situation.",
    ),
    interne: t(
      TEXTE_TABLEAU_INTERNE,
      'Dashboard reserved for firm users: it is not shared with the client portal. It can be presented in a meeting from your workstation ("Print" button).',
    ),
    portefeuillePage: t(
      TEXTE_PORTEFEUILLE_PAGE,
      "The summary below only covers the files on the displayed page, not the whole portfolio.",
    ),
    portefeuilleVide: t(
      TEXTE_PORTEFEUILLE_VIDE,
      "No turnaround file matches these filters among the engagements you can view.",
    ),
    causesNonValidees: t(
      TEXTE_CAUSES_NON_VALIDEES,
      "Proposal pending approval: these causes have not yet been approved by an expert.",
    ),
    causesPlusRecente: t(
      TEXTE_CAUSES_PLUS_RECENTE,
      "A more recent version exists but is not yet approved.",
    ),
    covenantConstat: t(
      TEXTE_COVENANT_CONSTAT,
      "Arithmetic observation of the entered ratio against the entered threshold; it does not characterize the client's situation.",
    ),
  };
}

export type BlocTableau =
  | "tresorerie"
  | "covenants"
  | "financement"
  | "plan"
  | "creanciers"
  | "causes"
  | "cloture"
  | "suivi";

export interface BlocVide {
  titre: string;
  texte: string;
  section: SectionRedressement;
  lien: string;
}

/** Blocs absents : explication et onglet où renseigner la donnée. */
export const BLOCS_VIDES: Record<BlocTableau, BlocVide> = {
  tresorerie: {
    titre: "Trésorerie",
    texte: "Aucune version du plan de trésorerie n'est enregistrée.",
    section: "tresorerie",
    lien: "Ouvrir l'onglet Trésorerie",
  },
  covenants: {
    titre: "Covenants",
    texte: "Aucune version de covenants n'est enregistrée.",
    section: "financement",
    lien: "Ouvrir l'onglet Financement",
  },
  financement: {
    titre: "Plan de financement",
    texte: "Aucune version du plan de financement n'est enregistrée.",
    section: "financement",
    lien: "Ouvrir l'onglet Financement",
  },
  plan: {
    titre: "Plan d'actions",
    texte: "Aucune action n'est enregistrée dans le plan.",
    section: "plan",
    lien: "Ouvrir l'onglet Plan",
  },
  creanciers: {
    titre: "Créanciers",
    texte: "Aucun créancier n'est enregistré.",
    section: "creanciers",
    lien: "Ouvrir l'onglet Créanciers",
  },
  causes: {
    titre: "Causes racines",
    texte: "Aucune cartographie des causes n'est établie.",
    section: "diagnostic",
    lien: "Ouvrir l'onglet Diagnostic",
  },
  cloture: {
    titre: "Bilan de clôture",
    texte: "Le bilan de clôture apparaît une fois le dossier clos.",
    section: "cloture",
    lien: "Ouvrir l'onglet Clôture",
  },
  suivi: {
    titre: "Suivi après mission",
    texte: "Le suivi après mission apparaît une fois le dossier clos et son plan de suivi créé.",
    section: "suivi",
    lien: "Ouvrir l'onglet Suivi",
  },
};

const BLOCS_VIDES_EN: Record<BlocTableau, { titre: string; texte: string; lien: string }> = {
  tresorerie: {
    titre: "Cash",
    texte: "No version of the cash plan is saved.",
    lien: "Open the Cash tab",
  },
  covenants: {
    titre: "Covenants",
    texte: "No version of covenants is saved.",
    lien: "Open the Financing tab",
  },
  financement: {
    titre: "Financing plan",
    texte: "No version of the financing plan is saved.",
    lien: "Open the Financing tab",
  },
  plan: {
    titre: "Action plan",
    texte: "No action is saved in the plan.",
    lien: "Open the Plan tab",
  },
  creanciers: {
    titre: "Creditors",
    texte: "No creditor is saved.",
    lien: "Open the Creditors tab",
  },
  causes: {
    titre: "Root causes",
    texte: "No root-cause map has been established.",
    lien: "Open the Diagnosis tab",
  },
  cloture: {
    titre: "Close-out review",
    texte: "The close-out review appears once the file is closed.",
    lien: "Open the Close-out tab",
  },
  suivi: {
    titre: "Post-engagement follow-up",
    texte:
      "Post-engagement follow-up appears once the file is closed and its follow-up plan created.",
    lien: "Open the Follow-up tab",
  },
};

/** Bloc vide d'un onglet, dans la langue demandée. */
export function blocVide(bloc: BlocTableau, langue: Langue = "fr"): BlocVide {
  const fr = BLOCS_VIDES[bloc];
  return langue === "en" ? { ...fr, ...BLOCS_VIDES_EN[bloc] } : fr;
}

// --- Libellés et tonalités ----------------------------------------------------------------------------------

const VOYANT_PILOTAGE_EN: Record<string, string> = {
  rouge: "High priority",
  orange: "Watch",
  vert: "Under control",
  inconnu: "Not determined",
};
const GRAVITE_MOTIF_EN: Record<string, string> = {
  critique: "Critical point",
  vigilance: "Watch point",
  information: "Information",
};

export const libelleVoyantPilotage = (v: RedVoyantPilotage, langue: Langue = "fr") =>
  langue === "en" ? (VOYANT_PILOTAGE_EN[v] ?? v) : (RED_VOYANT_PILOTAGE_LIBELLES[v] ?? v);
export const libelleGravite = (g: RedGraviteMotif, langue: Langue = "fr") =>
  langue === "en" ? (GRAVITE_MOTIF_EN[g] ?? g) : (RED_GRAVITE_MOTIF_LIBELLES[g] ?? g);

export function tonaliteVoyantPilotage(v: RedVoyantPilotage): TonaliteStatut {
  if (v === "rouge") return "danger";
  if (v === "orange") return "attention";
  if (v === "vert") return "succes";
  return "neutre";
}

export function tonaliteGravite(g: RedGraviteMotif): TonaliteStatut {
  if (g === "critique") return "danger";
  if (g === "vigilance") return "attention";
  return "neutre";
}

const STATUT_CLOTURE_DOSSIER_EN: Record<string, string> = {
  absent: "No review",
  brouillon: "Draft review",
  valide: "Approved review",
};

/** Statut du bilan de clôture résumé dans le tableau de bord. */
export const libelleStatutClotureDossier = (s: string, langue: Langue = "fr") =>
  langue === "en"
    ? (STATUT_CLOTURE_DOSSIER_EN[s] ?? s)
    : ((RED_STATUT_CLOTURE_DOSSIER_LIBELLES as Record<string, string>)[s] ?? s);

/** Texte alternatif du voyant : état en toutes lettres, jamais la couleur seule. */
export const texteAlternatifVoyant = (v: RedVoyantPilotage, langue: Langue = "fr") =>
  langue === "en"
    ? `Steering light: ${libelleVoyantPilotage(v, langue).toLowerCase()} (indicative)`
    : `Voyant de pilotage : ${libelleVoyantPilotage(v).toLowerCase()} (indicatif)`;

/** Valeur d'un indicateur : codes de voyant et de niveau libellés, nombres en fr-FR, absence « — ». */
export function formaterIndicateur(
  i: Pick<RedIndicateurTableauVue, "cle" | "valeur">,
  langue: Langue = "fr",
): string {
  if (i.valeur === null || i.valeur === undefined) return VALEUR_ABSENTE;
  if (i.cle === "voyant_urgence") return libelleVoyant(i.valeur as RedVoyant, langue);
  if (i.cle === "niveau_alerte") return libelleNiveauAlerte(i.valeur as RedNiveauAlerte, langue);
  return typeof i.valeur === "number" ? formaterNombre(i.valeur, 0, langue) : String(i.valeur);
}

export const libelleNombre = (n: number | null | undefined, langue: Langue = "fr") =>
  formaterNombre(n, 0, langue);

/** Les voyants dans l'ordre d'attention, pour la synthèse de la page. */
export const VOYANTS_ORDRE: readonly RedVoyantPilotage[] = RED_VOYANTS_PILOTAGE;

/** Tous les textes de ce module, à scanner (aucune qualification juridique). */
export function libellesTableau(): string[] {
  return [
    RED_TABLEAU_MENTION,
    TEXTE_TABLEAU_INTERNE,
    TEXTE_PORTEFEUILLE_PAGE,
    TEXTE_PORTEFEUILLE_VIDE,
    TEXTE_CAUSES_NON_VALIDEES,
    TEXTE_CAUSES_PLUS_RECENTE,
    TEXTE_COVENANT_CONSTAT,
    ...Object.values(RED_VOYANT_PILOTAGE_LIBELLES),
    ...Object.values(RED_GRAVITE_MOTIF_LIBELLES),
    ...Object.values(BLOCS_VIDES).flatMap((b) => [b.titre, b.texte, b.lien]),
  ];
}
