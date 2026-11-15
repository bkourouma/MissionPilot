/**
 * Brief quotidien (AUT-07) : libellés, tonalités et formats d'affichage. Logique pure, testée dans
 * `brief.test.ts`. Le brief est un calcul du moteur servi par `GET /api/brief` : rien n'est
 * recalculé ici (gravité, ordre, bornage, total viennent de l'API), seulement mis en forme.
 */
import {
  creerTraduire,
  dateIsoBorneeSchema,
  LIBELLES_FAMILLE_BRIEF,
  LIBELLES_GRAVITE_BRIEF,
  type BriefApi,
  type ElementBriefApi,
  type FamilleBriefApi,
  type FamilleComposeeBriefApi,
  type GraviteBriefApi,
  type Langue,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { NomIcone } from "../components/ui/Icone";
import { DEVISES, formaterDate, formaterMontantMineur, type Devise } from "./format";

export type {
  BriefApi,
  ElementBriefApi,
  FamilleBriefApi,
  FamilleComposeeBriefApi,
  GraviteBriefApi,
};

export const CHEMIN_BRIEF = "/brief";

/** Ordre d'affichage des trois cartes. */
export const FAMILLES_AFFICHEES: readonly FamilleBriefApi[] = ["decider", "deriver", "envoyer"];

interface PresentationFamille {
  titre: string;
  icone: NomIcone;
  /** Sous-titre de la carte : ce que la famille regroupe. */
  description: string;
  /** État vide de la carte (la famille n'a rien ce jour). */
  vide: string;
}

export const PRESENTATION_FAMILLE: Record<FamilleBriefApi, PresentationFamille> = {
  decider: {
    titre: LIBELLES_FAMILLE_BRIEF.decider,
    icone: "taches",
    description: "Ce qui attend votre décision : des validations que vous êtes habilité à faire.",
    vide: "Aucune décision n'attend votre réponse.",
  },
  deriver: {
    titre: LIBELLES_FAMILLE_BRIEF.deriver,
    icone: "attention",
    description: "Ce qui s'écarte de ce qui était prévu : indicateurs, budgets, retards.",
    vide: "Rien ne dérive dans votre périmètre.",
  },
  envoyer: {
    titre: LIBELLES_FAMILLE_BRIEF.envoyer,
    icone: "envoyer",
    description: "Ce qui est déjà validé et attend d'être envoyé ou transmis.",
    vide: "Rien n'attend d'être envoyé.",
  },
};

const PRESENTATION_FAMILLE_EN: Record<FamilleBriefApi, PresentationFamille> = {
  decider: {
    titre: "To decide",
    icone: "taches",
    description: "What awaits your decision: approvals you are authorized to give.",
    vide: "No decision is awaiting your answer.",
  },
  deriver: {
    titre: "Drifting",
    icone: "attention",
    description: "What departs from the plan: indicators, budgets, delays.",
    vide: "Nothing is drifting in your scope.",
  },
  envoyer: {
    titre: "Ready to send",
    icone: "envoyer",
    description: "What is already approved and waiting to be sent or passed on.",
    vide: "Nothing is waiting to be sent.",
  },
};

/** Présentation d'une carte du brief, dans la langue demandée. */
export const presentationFamille = (
  f: FamilleBriefApi,
  langue: Langue = "fr",
): PresentationFamille => (langue === "en" ? PRESENTATION_FAMILLE_EN : PRESENTATION_FAMILLE)[f];

/** Texte de l'état vide du brief entier. */
export const MESSAGE_BRIEF_VIDE = "Rien à signaler";
export const DETAIL_BRIEF_VIDE =
  "Aucune décision en attente, rien qui dérive et rien à envoyer dans votre périmètre aujourd'hui.";
export const MESSAGE_BRIEF_VIDE_EN = "Nothing to report";
export const DETAIL_BRIEF_VIDE_EN =
  "No decision pending, nothing drifting and nothing to send in your scope today.";

/** Gravité calculée par le moteur → tonalité du badge (la couleur ne porte jamais seule le sens). */
export const TONALITE_GRAVITE: Record<GraviteBriefApi, TonaliteStatut> = {
  haute: "danger",
  moyenne: "attention",
  basse: "neutre",
};

const LIBELLES_GRAVITE_BRIEF_EN: Record<GraviteBriefApi, string> = {
  haute: "Urgent",
  moyenne: "To watch",
  basse: "Recent",
};

export const libelleGravite = (g: GraviteBriefApi, langue: Langue = "fr"): string =>
  (langue === "en" ? LIBELLES_GRAVITE_BRIEF_EN : LIBELLES_GRAVITE_BRIEF)[g];

/**
 * « Aujourd'hui », « Depuis 1 jour », « Depuis 12 jours ». Pour un brief rejoué à une date passée
 * (`rejoue`), l'ancienneté est relative à cette date : « Ce jour-là » et non « Aujourd'hui ».
 */
export function libelleAnciennete(jours: number, rejoue = false, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (!Number.isFinite(jours) || jours <= 0) {
    return rejoue ? t("Ce jour-là", "That day") : t("Aujourd'hui", "Today");
  }
  const n = Math.floor(jours);
  return t(`Depuis ${n} jour${n > 1 ? "s" : ""}`, `For ${n} day${n > 1 ? "s" : ""}`);
}

/**
 * Lien interne seulement : le brief ne mène jamais hors de l'application, même si une réponse
 * contenait une autre adresse (« // », « http: », « javascript: »).
 */
export function lienInterne(lien: string): string | null {
  return lien.startsWith("/") && !lien.startsWith("//") && !/[\s\\]/.test(lien) ? lien : null;
}

/** Montant servi par l'API (`finance.lire` seulement) ; absent sans ce droit, jamais un zéro. */
export function libelleMontant(element: ElementBriefApi, langue: Langue = "fr"): string | null {
  if (element.montant === undefined || element.devise === undefined) return null;
  const devise = DEVISES.find((d) => d === element.devise) as Devise | undefined;
  return devise ? formaterMontantMineur(element.montant, devise, langue) : null;
}

/** Motifs d'un voyant de redressement au rouge (texte, sans montant) ; null s'il n'y en a pas. */
/** Libellés anglais des types d'élément (le moteur compose le libellé en français). */
const LIBELLES_TYPE_BRIEF_EN: Readonly<Record<ElementBriefApi["type"], string>> = {
  facture_a_approuver: "Invoice to approve",
  debours_a_valider: "Expenses to approve",
  feuille_a_valider: "Timesheet to approve",
  conge_a_valider: "Leave request to approve",
  proposition_a_valider: "Proposal to approve",
  notation_a_publier: "Rating to publish",
  livrable_a_relire: "Deliverable to review",
  livrable_a_signer: "Deliverable to sign",
  derogation_a_accorder: "Waiver to grant",
  piece_a_examiner: "Client document to examine",
  brouillon_automatisation: "Automation draft to decide",
  retour_a_valider: "Lessons learned to approve",
  cloture_en_attente: "Engagement closure pending",
  offre_technique_a_valider: "Technical proposal to approve",
  plan_a_valider: "Strategic plan to approve",
  revision_budget_a_valider: "Budget revision to approve",
  kpi_rouge: "KPI in the red",
  kpi_orange_consecutif: "KPI amber two periods in a row",
  atterrissage_depasse: "Landing above budget",
  facture_echue: "Overdue invoice",
  jalon_en_retard: "Late milestone",
  tache_en_retard: "Late task",
  feuille_non_soumise: "Timesheet not submitted",
  questionnaire_sans_reponse: "Unanswered questionnaire",
  voyant_rouge: "Turnaround indicator in the red",
  proposition_a_envoyer: "Approved proposal to send",
  facture_a_emettre: "Approved invoice to issue",
  facture_a_envoyer: "Issued invoice to send",
  relance_prete: "Invoice reminder ready",
  demande_salle_a_envoyer: "Document request ready to send",
  livrable_signe: "Signed deliverable to send",
};

/**
 * Libellé d'un élément dans la langue de l'interface. Le moteur le compose en français :
 * « <type>[ : <élément>][ (<suite>)] » ; en anglais, le type est remplacé par son libellé anglais
 * et les gabarits connus de l'élément et de la suite sont traduits (les noms restent tels quels).
 */
export function libelleElementBrief(element: ElementBriefApi, langue: Langue = "fr"): string {
  if (langue !== "en") return element.libelle;
  const base = LIBELLES_TYPE_BRIEF_EN[element.type] ?? element.libelle;
  const i = element.libelle.indexOf(" : ");
  let reste = i >= 0 ? element.libelle.slice(i + 3) : "";
  let suite = "";
  const m = /( \((?:\d+ jours? de retard|\+[^)]*%)\))$/.exec(i >= 0 ? reste : element.libelle);
  if (m) {
    suite = m[1] ?? "";
    if (i >= 0) reste = reste.slice(0, reste.length - suite.length);
  }
  const entite = reste
    .replace(/^semaine du /, "week of ")
    .replace(/, semaine du /, ", week of ")
    .replace(/, à partir du /, ", from ")
    .replace(/^révision n° /, "revision no. ")
    .replace(/^n° /, "no. ");
  const suiteEn = suite
    .replace(/\((\d+) jours? de retard\)/, (_, n: string) =>
      Number(n) > 1 ? `(${n} days overdue)` : `(${n} day overdue)`,
    )
    .replace(/(\d),(\d)/g, "$1.$2");
  return `${entite ? `${base}: ${entite}` : base}${suiteEn}`;
}

export function libelleMotifs(element: ElementBriefApi): string | null {
  return element.motifs && element.motifs.length > 0 ? element.motifs.join(" ") : null;
}

/** « 3 éléments », « 1 élément », « Aucun élément ». */
export function libelleNombre(n: number, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (n <= 0) return t("Aucun élément", "No items");
  return t(`${n} élément${n > 1 ? "s" : ""}`, `${n} item${n > 1 ? "s" : ""}`);
}

/**
 * Note sous une carte tronquée : « 10 affichés sur 14 » (le total est celui du moteur). Quand tout
 * ce qui est connu est affiché mais que la famille est tronquée, c'est que certaines sources n'ont
 * pas pu être lues en entier : le total est un minimum, jamais un nombre exact.
 */
export function noteTroncature(
  famille: FamilleComposeeBriefApi,
  langue: Langue = "fr",
): string | null {
  const t = creerTraduire(langue);
  if (!famille.tronque) return null;
  if (famille.total === 0) {
    return t(
      "D'autres éléments peuvent exister au-delà de ceux qui ont pu être examinés.",
      "Other items may exist beyond those that could be examined.",
    );
  }
  if (famille.elements.length >= famille.total) {
    return t(
      `Au moins ${famille.total} élément${famille.total > 1 ? "s" : ""} : d'autres peuvent exister au-delà de ceux qui ont pu être examinés.`,
      `At least ${famille.total} item${famille.total > 1 ? "s" : ""}: others may exist beyond those that could be examined.`,
    );
  }
  return t(
    `${famille.elements.length} affiché${famille.elements.length > 1 ? "s" : ""} sur ${famille.total} : les plus urgents et les plus anciens d'abord.`,
    `${famille.elements.length} shown of ${famille.total}: the most urgent and the oldest first.`,
  );
}

/** Statut HTTP du plafond de débit du brief (`TROP_DE_REQUETES_BRIEF`). */
export const STATUT_TROP_DE_REQUETES = 429;

/** Message français quand le brief n'a pas pu être chargé : le plafond de débit a son propre texte. */
export function messageBriefIndisponible(
  statut: number,
  message: string,
  langue: Langue = "fr",
): string {
  if (statut === STATUT_TROP_DE_REQUETES) {
    return creerTraduire(langue)(
      "vous avez consulté le brief très souvent en peu de temps ; il sera de nouveau disponible dans quelques minutes.",
      "you have opened the brief very often in a short time; it will be available again in a few minutes.",
    );
  }
  return message;
}

/** Titre de l'erreur de la page « Mon brief ». */
export function titreErreurBrief(statut: number, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  return statut === STATUT_TROP_DE_REQUETES
    ? t("Trop de consultations du brief.", "Too many brief views.")
    : t("Le brief n'a pas pu être chargé.", "The brief could not be loaded.");
}

/** « 4 » ou « au moins 4 » quand la famille est tronquée sans plus d'éléments connus à montrer. */
function nombreOuMinimum(f: FamilleComposeeBriefApi, langue: Langue): string {
  return f.tronque && f.total > 0 && f.elements.length >= f.total
    ? creerTraduire(langue)(`au moins ${f.total}`, `at least ${f.total}`)
    : String(f.total);
}

/** Résumé d'une ligne du brief (carte du tableau de bord). */
export function resumeBrief(brief: BriefApi, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (brief.vide) return t(MESSAGE_BRIEF_VIDE, MESSAGE_BRIEF_VIDE_EN);
  const f = brief.familles;
  const derive = f.deriver.total > 1 ? "qui dérivent" : "qui dérive";
  return [
    t(
      `${nombreOuMinimum(f.decider, langue)} à décider`,
      `${nombreOuMinimum(f.decider, langue)} to decide`,
    ),
    t(
      `${nombreOuMinimum(f.deriver, langue)} ${derive}`,
      `${nombreOuMinimum(f.deriver, langue)} drifting`,
    ),
    t(
      `${nombreOuMinimum(f.envoyer, langue)} prêt${f.envoyer.total > 1 ? "s" : ""} à envoyer`,
      `${nombreOuMinimum(f.envoyer, langue)} ready to send`,
    ),
  ].join(" · ");
}

/** Chemin de l'API (date de rejeu facultative, déjà validée). */
export function requeteBrief(date?: string): string {
  return date ? `/api/brief?date=${encodeURIComponent(date)}` : "/api/brief";
}

/** Date `?date=` de la page : valide et bornée (2000 à 2100), sinon ignorée. */
export function lireDateBrief(
  recherche: Record<string, string | string[] | undefined>,
): string | undefined {
  const brut = recherche.date;
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  if (typeof valeur !== "string") return undefined;
  const lu = dateIsoBorneeSchema.safeParse(valeur);
  return lu.success ? lu.data : undefined;
}

/** Adresse de la page « Mon brief » (avec `?date=` si le brief est rejoué à une autre date). */
export function hrefBrief(date?: string): string {
  return date ? `${CHEMIN_BRIEF}?date=${encodeURIComponent(date)}` : CHEMIN_BRIEF;
}

/** « Brief du 12 oct. 2026 (rejeu) » ; sans date rejouée, le brief est celui du jour. */
export function libelleRejeuBrief(date?: string, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  return date
    ? t(
        `Brief du ${formaterDate(date)} (rejeu)`,
        `Brief of ${formaterDate(date, "UTC", langue)} (replay)`,
      )
    : t("Brief du jour", "Today's brief");
}

/** Date saisie dans le sélecteur : valide et bornée (2000 à 2100), sinon undefined. */
export function dateSaisieBrief(valeur: string): string | undefined {
  const lu = dateIsoBorneeSchema.safeParse(valeur);
  return lu.success ? lu.data : undefined;
}
