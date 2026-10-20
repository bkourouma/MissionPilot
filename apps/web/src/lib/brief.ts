/**
 * Brief quotidien (AUT-07) : libellés, tonalités et formats d'affichage. Logique pure, testée dans
 * `brief.test.ts`. Le brief est un calcul du moteur servi par `GET /api/brief` : rien n'est
 * recalculé ici (gravité, ordre, bornage, total viennent de l'API), seulement mis en forme.
 */
import {
  dateIsoBorneeSchema,
  LIBELLES_FAMILLE_BRIEF,
  LIBELLES_GRAVITE_BRIEF,
  type BriefApi,
  type ElementBriefApi,
  type FamilleBriefApi,
  type FamilleComposeeBriefApi,
  type GraviteBriefApi,
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

/** Texte de l'état vide du brief entier. */
export const MESSAGE_BRIEF_VIDE = "Rien à signaler";
export const DETAIL_BRIEF_VIDE =
  "Aucune décision en attente, rien qui dérive et rien à envoyer dans votre périmètre aujourd'hui.";

/** Gravité calculée par le moteur → tonalité du badge (la couleur ne porte jamais seule le sens). */
export const TONALITE_GRAVITE: Record<GraviteBriefApi, TonaliteStatut> = {
  haute: "danger",
  moyenne: "attention",
  basse: "neutre",
};

export const libelleGravite = (g: GraviteBriefApi): string => LIBELLES_GRAVITE_BRIEF[g];

/** « Aujourd'hui », « Depuis 1 jour », « Depuis 12 jours ». */
export function libelleAnciennete(jours: number): string {
  if (!Number.isFinite(jours) || jours <= 0) return "Aujourd'hui";
  const n = Math.floor(jours);
  return `Depuis ${n} jour${n > 1 ? "s" : ""}`;
}

/**
 * Lien interne seulement : le brief ne mène jamais hors de l'application, même si une réponse
 * contenait une autre adresse (« // », « http: », « javascript: »).
 */
export function lienInterne(lien: string): string | null {
  return lien.startsWith("/") && !lien.startsWith("//") && !/[\s\\]/.test(lien) ? lien : null;
}

/** Montant servi par l'API (`finance.lire` seulement) ; absent sans ce droit, jamais un zéro. */
export function libelleMontant(element: ElementBriefApi): string | null {
  if (element.montant === undefined || element.devise === undefined) return null;
  const devise = DEVISES.find((d) => d === element.devise) as Devise | undefined;
  return devise ? formaterMontantMineur(element.montant, devise) : null;
}

/** « 3 éléments », « 1 élément », « Aucun élément ». */
export function libelleNombre(n: number): string {
  if (n <= 0) return "Aucun élément";
  return `${n} élément${n > 1 ? "s" : ""}`;
}

/**
 * Note sous une carte tronquée : « 10 affichés sur 14 » (le total est celui du moteur). Quand tout
 * ce qui est connu est affiché mais que la famille est tronquée, c'est que certaines sources n'ont
 * pas pu être lues en entier : le total est un minimum, jamais un nombre exact.
 */
export function noteTroncature(famille: FamilleComposeeBriefApi): string | null {
  if (!famille.tronque) return null;
  if (famille.total === 0) {
    return "D'autres éléments peuvent exister au-delà de ceux qui ont pu être examinés.";
  }
  if (famille.elements.length >= famille.total) {
    return `Au moins ${famille.total} élément${famille.total > 1 ? "s" : ""} : d'autres peuvent exister au-delà de ceux qui ont pu être examinés.`;
  }
  return `${famille.elements.length} affiché${famille.elements.length > 1 ? "s" : ""} sur ${famille.total} : les plus urgents et les plus anciens d'abord.`;
}

/** Statut HTTP du plafond de débit du brief (`TROP_DE_REQUETES_BRIEF`). */
export const STATUT_TROP_DE_REQUETES = 429;

/** Message français quand le brief n'a pas pu être chargé : le plafond de débit a son propre texte. */
export function messageBriefIndisponible(statut: number, message: string): string {
  if (statut === STATUT_TROP_DE_REQUETES) {
    return "vous avez consulté le brief très souvent en peu de temps ; il sera de nouveau disponible dans quelques minutes.";
  }
  return message;
}

/** Titre de l'erreur de la page « Mon brief ». */
export function titreErreurBrief(statut: number): string {
  return statut === STATUT_TROP_DE_REQUETES
    ? "Trop de consultations du brief."
    : "Le brief n'a pas pu être chargé.";
}

/** « 4 » ou « au moins 4 » quand la famille est tronquée sans plus d'éléments connus à montrer. */
function nombreOuMinimum(f: FamilleComposeeBriefApi): string {
  return f.tronque && f.total > 0 && f.elements.length >= f.total
    ? `au moins ${f.total}`
    : String(f.total);
}

/** Résumé d'une ligne du brief (carte du tableau de bord). */
export function resumeBrief(brief: BriefApi): string {
  if (brief.vide) return MESSAGE_BRIEF_VIDE;
  const f = brief.familles;
  const derive = f.deriver.total > 1 ? "qui dérivent" : "qui dérive";
  return [
    `${nombreOuMinimum(f.decider)} à décider`,
    `${nombreOuMinimum(f.deriver)} ${derive}`,
    `${nombreOuMinimum(f.envoyer)} prêt${f.envoyer.total > 1 ? "s" : ""} à envoyer`,
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
export function libelleRejeuBrief(date?: string): string {
  return date ? `Brief du ${formaterDate(date)} (rejeu)` : "Brief du jour";
}

/** Date saisie dans le sélecteur : valide et bornée (2000 à 2100), sinon undefined. */
export function dateSaisieBrief(valeur: string): string | undefined {
  const lu = dateIsoBorneeSchema.safeParse(valeur);
  return lu.success ? lu.data : undefined;
}
