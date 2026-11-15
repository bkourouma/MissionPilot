/**
 * Rapports de mission (SOC-07) : « État d'avancement » généré en PDF, Word ou PowerPoint.
 * Logique pure, testée dans `rapports.test.ts`.
 *
 * Le NIVEAU d'un rapport (base, jours, finance) dépend des droits de celui qui le génère :
 * l'API n'y met que ce qu'il peut lire, et ne le montre ensuite qu'aux personnes qui ont au
 * moins ces droits (`apps/api/src/rapports/niveaux.ts`). Le miroir ci-dessous sert seulement à
 * EXPLIQUER à l'avance ce que contiendra le rapport : l'API reste seule juge. Aucun montant
 * n'est affiché sur l'écran des rapports, quel que soit le niveau.
 *
 * Aucun fichier ni aucune donnée de rapport n'est conservé dans le navigateur (ni stockage
 * local, ni cache) : la liste vient du serveur à chaque affichage, le fichier se télécharge par
 * le lien authentifié de `lib/fichiers.ts` (réponse `no-store` de l'API).
 */
import {
  aPermission,
  creerTraduire,
  type Langue,
  type Permission,
  type Role,
} from "@missionpilot/shared";
import {
  CODE_TFA_A_CONFIGURER,
  ErreurApi,
  MESSAGE_TFA_A_CONFIGURER,
  MESSAGE_TFA_A_CONFIGURER_EN,
  messageErreur,
} from "./api";
import type { FichierMeta } from "./fichiers";
import { nomPersonne, type Personne } from "./personnes";

export const FORMATS_RAPPORT = ["pdf", "docx", "pptx"] as const;
export type FormatRapport = (typeof FORMATS_RAPPORT)[number];

export const NIVEAUX_RAPPORT = ["base", "jours", "finance"] as const;
export type NiveauRapport = (typeof NIVEAUX_RAPPORT)[number];

/** Niveaux propres aux services (miroir de `rapports/niveaux.ts`) : notation publiée, plan, due diligence, clôture du redressement, état financier du dossier client. */
export const NIVEAUX_SERVICE = ["notation", "plan", "dd", "red", "dossier"] as const;
export type NiveauService = (typeof NIVEAUX_SERVICE)[number];

/** Tous les niveaux qu'un rapport listé peut porter. */
export const TOUS_NIVEAUX = [...NIVEAUX_RAPPORT, ...NIVEAUX_SERVICE] as const;
export type NiveauAffichable = NiveauRapport | NiveauService;

/** Rapport tel que listé par GET /api/missions/:id/rapports (métadonnées, jamais le contenu). */
export interface RapportMission {
  id: string;
  mission_id: string;
  modele: string;
  /** Note au comité seulement : variante du rendu (`executive` ou `detaillee`). */
  variante?: "executive" | "detaillee" | null;
  format: FormatRapport;
  statut: string;
  niveau: NiveauAffichable;
  genere_par: string;
  genere_le: string;
  fichier: FichierMeta;
}

export interface PageRapports {
  elements: RapportMission[];
  curseur_suivant: string | null;
}

/** Réponse 201 de POST /api/missions/:id/rapports. */
export interface RapportCree {
  rapport: Omit<RapportMission, "fichier">;
  fichier: FichierMeta;
}

// --- Formats -----------------------------------------------------------------------------

export const FORMATS: Record<FormatRapport, { libelle: string; court: string; aide: string }> = {
  pdf: {
    libelle: "PDF",
    court: "PDF",
    aide: "Pour lire et imprimer. Rendu plus long : jusqu'à 30 secondes.",
  },
  docx: { libelle: "Word (.docx)", court: "Word", aide: "Document modifiable avant diffusion." },
  pptx: {
    libelle: "PowerPoint (.pptx)",
    court: "PowerPoint",
    aide: "Présentation à projeter en réunion.",
  },
};

const FORMATS_EN: Record<FormatRapport, { libelle: string; court: string; aide: string }> = {
  pdf: {
    libelle: "PDF",
    court: "PDF",
    aide: "For reading and printing. Longer rendering: up to 30 seconds.",
  },
  docx: {
    libelle: "Word (.docx)",
    court: "Word",
    aide: "Editable document before distribution.",
  },
  pptx: {
    libelle: "PowerPoint (.pptx)",
    court: "PowerPoint",
    aide: "Presentation to project in meetings.",
  },
};

/** Libellés d'un format dans la langue demandée. */
export const formatRapport = (f: FormatRapport, langue: Langue = "fr") =>
  langue === "en" ? FORMATS_EN[f] : FORMATS[f];

export const estFormatRapport = (v: unknown): v is FormatRapport =>
  typeof v === "string" && (FORMATS_RAPPORT as readonly string[]).includes(v);

/** Libellé court d'un format reçu de l'API ; repli neutre si inconnu. */
export const libelleFormat = (f: string) => (estFormatRapport(f) ? FORMATS[f].court : "Fichier");

/** Idem, dans la langue demandée (fonction à part : `libelleFormat` sert de rappel à `map`). */
export const libelleFormatRapport = (f: string, langue: Langue = "fr") =>
  estFormatRapport(f) ? formatRapport(f, langue).court : langue === "en" ? "File" : "Fichier";

// --- Niveaux -----------------------------------------------------------------------------

/** Permissions exigées pour lire un niveau (miroir de `rapports/niveaux.ts`, cumulatives). */
const PERMISSIONS_NIVEAU: Record<NiveauAffichable, readonly Permission[]> = {
  base: [],
  jours: ["budget.lire_jours"],
  finance: ["budget.lire_jours", "finance.lire"],
  notation: ["notation.lire"],
  plan: ["plan.lire"],
  dd: ["dd.lire"],
  red: ["redressement.lire"],
  dossier: ["dossier.lire"],
};

export type IconeNiveau = "courbe" | "horloge" | "cadenas";

/**
 * Libellé (toujours affiché : la couleur ne porte jamais seule le sens), icône propre au
 * niveau, tonalité du badge et explication de ce que le rapport contiendra.
 */
export const NIVEAUX: Record<
  NiveauAffichable,
  { libelle: string; icone: IconeNiveau; tonalite: "neutre" | "attention"; explication: string }
> = {
  base: {
    libelle: "Avancement",
    icone: "courbe",
    tonalite: "neutre",
    explication:
      "Avec vos droits, le rapport présente l'avancement et les jalons de la mission, sans jours ni données financières.",
  },
  jours: {
    libelle: "Avancement et jours",
    icone: "horloge",
    tonalite: "neutre",
    explication:
      "Avec vos droits, le rapport ajoute le budget et le temps consommé en jours. Il ne contient aucune donnée financière.",
  },
  finance: {
    libelle: "Confidentiel : avec finances",
    icone: "cadenas",
    tonalite: "attention",
    explication:
      "Avec vos droits, le rapport inclut aussi les données financières internes du cabinet. Seules les personnes autorisées à lire les finances pourront l'ouvrir.",
  },
  notation: {
    libelle: "Notation",
    icone: "courbe",
    tonalite: "neutre",
    explication:
      "Rapport de la notation publiée. Seules les personnes autorisées à lire la notation pourront l'ouvrir.",
  },
  plan: {
    libelle: "Plan stratégique",
    icone: "cadenas",
    tonalite: "attention",
    explication:
      "Rapport du plan stratégique, modèle financier du client compris. Seules les personnes autorisées à lire les plans pourront l'ouvrir.",
  },
  dd: {
    libelle: "Due diligence",
    icone: "cadenas",
    tonalite: "attention",
    explication:
      "Note au comité de la due diligence : analyses, verdicts, marché et plan de l'opération étudiée. Seules les personnes autorisées à lire la due diligence pourront l'ouvrir.",
  },
  red: {
    libelle: "Redressement",
    icone: "cadenas",
    tonalite: "attention",
    explication:
      "Rapport de clôture du redressement : bilan chiffré du client. Seules les personnes autorisées à lire le redressement pourront l'ouvrir.",
  },
  dossier: {
    libelle: "Dossier client",
    icone: "cadenas",
    tonalite: "attention",
    explication:
      "Le rapport reprend les états financiers acceptés du dossier du client ; il ne contient aucune donnée financière du cabinet.",
  },
};

const NIVEAUX_EN: Record<NiveauAffichable, { libelle: string; explication: string }> = {
  base: {
    libelle: "Progress",
    explication:
      "With your rights, the report presents the progress and milestones of the engagement, without days or financial data.",
  },
  jours: {
    libelle: "Progress and days",
    explication:
      "With your rights, the report adds the budget and time spent in days. It contains no financial data.",
  },
  finance: {
    libelle: "Confidential: with financials",
    explication:
      "With your rights, the report also includes the firm's internal financial data. Only people authorized to read financials will be able to open it.",
  },
  notation: {
    libelle: "Rating",
    explication:
      "Report of the published rating. Only people authorized to read the rating will be able to open it.",
  },
  plan: {
    libelle: "Strategic plan",
    explication:
      "Strategic plan report, including the client's financial model. Only people authorized to read plans will be able to open it.",
  },
  dd: {
    libelle: "Due diligence",
    explication:
      "Due diligence committee note: analyses, verdicts, market and plan of the transaction under review. Only people authorized to read due diligence will be able to open it.",
  },
  red: {
    libelle: "Turnaround",
    explication:
      "Turnaround close-out report: the client's figures. Only people authorized to read turnarounds will be able to open it.",
  },
  dossier: {
    libelle: "Client file",
    explication:
      "The report reproduces the accepted financial statements of the client's file; it contains no financial data of the firm.",
  },
};

/** Niveau d'un rapport (libellé, icône, tonalité, explication) dans la langue demandée. */
export const niveauRapport = (n: NiveauAffichable, langue: Langue = "fr") =>
  langue === "en" ? { ...NIVEAUX[n], ...NIVEAUX_EN[n] } : NIVEAUX[n];

export const estNiveauRapport = (v: unknown): v is NiveauAffichable =>
  typeof v === "string" && (TOUS_NIVEAUX as readonly string[]).includes(v);

/** Ces rôles détiennent-ils toutes les permissions du niveau ? */
export function peutLireNiveau(roles: readonly Role[], niveau: NiveauAffichable): boolean {
  return PERMISSIONS_NIVEAU[niveau].every((p) => aPermission(roles, p));
}

/** Niveau du rapport que ces rôles généreront : le plus élevé qu'ils peuvent relire. */
export function niveauGenere(roles: readonly Role[]): NiveauRapport {
  if (peutLireNiveau(roles, "finance")) return "finance";
  if (peutLireNiveau(roles, "jours")) return "jours";
  return "base";
}

const SECTIONS: Record<NiveauRapport, readonly string[]> = {
  base: [
    "Synthèse : statut de la mission et avancement physique",
    "Fiche de la mission : client, dates, directeur et chef de mission",
    "Jalons et leur état (atteint, à venir, en retard)",
    "Méthode de calcul des indicateurs",
  ],
  jours: [
    "Budget, réalisé, reste à faire et atterrissage, en jours",
    "Budget en jours par phase",
    "Temps consommé par collaborateur",
  ],
  finance: [
    "Données financières confidentielles : honoraires, valeur produite, coûts internes, sous-traitance, débours, marges",
  ],
};

const SECTIONS_EN: Record<NiveauRapport, readonly string[]> = {
  base: [
    "Summary: engagement status and physical progress",
    "Engagement sheet: client, dates, director and engagement manager",
    "Milestones and their status (reached, upcoming, overdue)",
    "Method used to compute the indicators",
  ],
  jours: [
    "Budget, actual, remaining work and landing, in days",
    "Budget in days by phase",
    "Time spent by team member",
  ],
  finance: [
    "Confidential financial data: fees, value produced, internal costs, subcontracting, expenses, margins",
  ],
};

const ABSENTS: Record<Exclude<NiveauRapport, "base">, string> = {
  jours: "Jours : budget, réalisé, temps consommé",
  finance: "Données financières : coûts, taux, marges",
};

const ABSENTS_EN: Record<Exclude<NiveauRapport, "base">, string> = {
  jours: "Days: budget, actual, time spent",
  finance: "Financial data: costs, rates, margins",
};

/** Sections incluses à ce niveau, et ce qui en est exclu (sans aucun chiffre). */
export function contenuRapport(
  niveau: NiveauRapport,
  langue: Langue = "fr",
): { inclus: string[]; exclus: string[] } {
  const rang = NIVEAUX_RAPPORT.indexOf(niveau);
  const sections = langue === "en" ? SECTIONS_EN : SECTIONS;
  const absents = langue === "en" ? ABSENTS_EN : ABSENTS;
  const inclus = NIVEAUX_RAPPORT.slice(0, rang + 1).flatMap((n) => sections[n]);
  const exclus = NIVEAUX_RAPPORT.slice(rang + 1).map(
    (n) => absents[n as Exclude<NiveauRapport, "base">],
  );
  return { inclus, exclus };
}

// --- Présentation de la liste ------------------------------------------------------------

const MODELES: Record<string, string> = {
  etat_avancement: "État d'avancement",
  notation: "Rapport de notation",
  plan_strategique: "Plan stratégique",
  dossier_bancaire: "Dossier bancaire",
  note_comite: "Note au comité",
  cloture_redressement: "Rapport de clôture du redressement",
  etat_financier: "Rapport d'état financier",
};
const MODELES_EN: Record<string, string> = {
  etat_avancement: "Progress report",
  notation: "Rating report",
  plan_strategique: "Strategic plan",
  dossier_bancaire: "Bank file",
  note_comite: "Committee note",
  cloture_redressement: "Turnaround close-out report",
  etat_financier: "Financial statement report",
};
export const libelleModele = (m: string, langue: Langue = "fr") =>
  (langue === "en" ? MODELES_EN : MODELES)[m] ?? (langue === "en" ? "Report" : "Rapport");

/** Libellé d'un rapport avec sa variante éventuelle : « Note au comité (synthèse exécutive) ». */
export function libelleModeleVariante(
  modele: string,
  variante?: string | null,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const base = libelleModele(modele, langue);
  if (variante === "executive") return `${base} (${t("synthèse exécutive", "executive summary")})`;
  if (variante === "detaillee") return `${base} (${t("version détaillée", "detailed version")})`;
  return base;
}

const STATUTS: Record<string, string> = {
  brouillon: "Brouillon",
  valide: "Validé",
};
const STATUTS_EN: Record<string, string> = {
  brouillon: "Draft",
  valide: "Approved",
};
export const libelleStatutRapport = (s: string, langue: Langue = "fr") =>
  (langue === "en" ? STATUTS_EN : STATUTS)[s] ??
  (langue === "en" ? "Unrecognized status" : "Statut non reconnu");

/** Personnes dont le nom est connu : référentiel du cabinet puis équipe de la mission. */
export function personnesConnues(
  cabinet: readonly Personne[],
  equipe: readonly { utilisateur_id: string; nom: string }[],
): Personne[] {
  const connues = [...cabinet];
  for (const e of equipe) {
    if (!connues.some((p) => p.utilisateur_id === e.utilisateur_id)) {
      connues.push({ utilisateur_id: e.utilisateur_id, nom: e.nom, grade_libelle: null });
    }
  }
  return connues;
}

/** Auteur affichable : « Vous », le nom connu, sinon un libellé neutre. */
export function nomAuteur(
  id: string,
  moiId: string,
  personnes: readonly Personne[],
  langue: Langue = "fr",
): string {
  return id === moiId ? creerTraduire(langue)("Vous", "You") : nomPersonne(id, personnes, langue);
}

// --- Chemins et pagination ---------------------------------------------------------------

/** Rapports par page de la liste. */
export const RAPPORTS_PAR_PAGE = 20;

/** Curseur opaque de l'API (base64url) ; toute autre valeur est ignorée. */
const CURSEUR = /^[A-Za-z0-9_-]{1,500}$/;

export function lireCurseur(v: string | string[] | undefined): string {
  const brut = Array.isArray(v) ? v[0] : v;
  return typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
}

const segment = (id: string) => encodeURIComponent(id);

/** GET de la liste (page `curseur`, ou la première). */
export function cheminListeRapports(missionId: string, curseur = ""): string {
  const q = new URLSearchParams({ limite: String(RAPPORTS_PAR_PAGE) });
  if (curseur) q.set("curseur", curseur);
  return `/api/missions/${segment(missionId)}/rapports?${q.toString()}`;
}

/** POST de génération. */
export function cheminGenerationRapport(missionId: string, format: FormatRapport): string {
  return `/api/missions/${segment(missionId)}/rapports?format=${format}`;
}

/** Page de l'onglet Rapports (première page sans curseur). */
export function hrefRapports(missionId: string, curseur?: string | null): string {
  const base = `/missions/${segment(missionId)}/rapports`;
  return curseur ? `${base}?curseur=${encodeURIComponent(curseur)}` : base;
}

// --- Génération : attente et erreurs -----------------------------------------------------

/**
 * Délai d'attente de la réponse côté navigateur : le rendu PDF peut durer jusqu'à 30 s côté
 * serveur (504 au-delà), plus le lancement du navigateur de rendu et l'enregistrement.
 */
export const DELAI_GENERATION_MS = 60_000;

/**
 * Message d'attente annoncé aux lecteurs d'écran. Il ne change qu'à quelques paliers (et non à
 * chaque seconde) pour ne pas saturer l'annonce.
 */
export function messageAttente(
  format: FormatRapport,
  secondes: number,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (secondes < 10) {
    return format === "pdf"
      ? t(
          "Génération du rapport PDF en cours. Le rendu peut prendre jusqu'à 30 secondes : ne fermez pas la page.",
          "Generating the PDF report. Rendering can take up to 30 seconds: do not close the page.",
        )
      : t(
          `Génération du rapport ${FORMATS[format].court} en cours : ne fermez pas la page.`,
          `Generating the ${FORMATS[format].court} report: do not close the page.`,
        );
  }
  if (secondes < 25)
    return t("Génération toujours en cours, merci de patienter.", "Still generating, please wait.");
  return t(
    "La génération prend plus de temps que d'habitude : encore quelques instants.",
    "Generation is taking longer than usual: a few more moments.",
  );
}

/** Durée écoulée lisible : « 8 s », « 1 min 05 s ». */
export function formaterDuree(secondes: number): string {
  const s = Number.isFinite(secondes) && secondes > 0 ? Math.floor(secondes) : 0;
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

export const MESSAGE_LIMITE_RAPPORTS =
  "Vous avez atteint la limite de 10 rapports par 10 minutes. Patientez quelques minutes avant d'en générer un nouveau.";

export const MESSAGE_LIMITE_RAPPORTS_EN =
  "You have reached the limit of 10 reports per 10 minutes. Wait a few minutes before generating a new one.";

const PEUT_ETRE_CREE =
  "Le rapport a peut-être été créé malgré tout : actualisez la liste avant de réessayer.";
const PEUT_ETRE_CREE_EN =
  "The report may have been created anyway: refresh the list before trying again.";

/**
 * La requête a pu aboutir côté serveur sans que la réponse arrive (délai du navigateur ou du
 * relais, réseau coupé) : proposer d'actualiser la liste avant de relancer (doublon évité).
 */
export function peutEtreCree(e: unknown): boolean {
  if (!(e instanceof ErreurApi)) return false;
  return (
    e.code === "DELAI_DEPASSE" ||
    e.code === "RESEAU_INDISPONIBLE" ||
    e.code === "SERVICE_INDISPONIBLE"
  );
}

/** Refus momentané du serveur (rendu occupé, délai de rendu) : relancer tel quel a un sens. */
export function reessayable(e: unknown): boolean {
  return (
    e instanceof ErreurApi &&
    !peutEtreCree(e) &&
    (e.code === "RENDU_OCCUPE" || e.code === "RENDU_TROP_LONG" || e.statut === 504)
  );
}

/** L'état de la mission a changé (clôturée, plus visible) : recharger la page. */
export function etatMissionChange(e: unknown): boolean {
  return e instanceof ErreurApi && ((e.statut === 409 && e.code === "CONFLIT") || e.statut === 404);
}

/** Message français pour chaque refus de la génération (POST /api/missions/:id/rapports). */
export function messageRapport(e: unknown, langue: Langue = "fr"): string {
  if (!(e instanceof ErreurApi)) return messageErreur(e, langue);
  if (e.code === CODE_TFA_A_CONFIGURER) {
    return langue === "en" ? MESSAGE_TFA_A_CONFIGURER_EN : MESSAGE_TFA_A_CONFIGURER;
  }
  const t = creerTraduire(langue);
  const limite = t(MESSAGE_LIMITE_RAPPORTS, MESSAGE_LIMITE_RAPPORTS_EN);
  const peutEtre = t(PEUT_ETRE_CREE, PEUT_ETRE_CREE_EN);
  const tropVolumineux = t(
    "Le rapport produit dépasse la taille de fichier autorisée. Essayez un autre format, ou contactez un associé.",
    "The generated report exceeds the allowed file size. Try another format, or contact a partner.",
  );
  const tropLong = t(
    "Délai dépassé : le rendu du rapport a pris trop de temps. Réessayez, ou choisissez Word ou PowerPoint, plus rapides à produire.",
    "Timed out: rendering the report took too long. Try again, or choose Word or PowerPoint, which are faster to produce.",
  );
  switch (e.code) {
    case "TROP_DE_RAPPORTS":
      return limite;
    case "RENDU_OCCUPE":
      return t(
        "Trop de rapports sont en cours de rendu en ce moment. Réessayez dans quelques instants.",
        "Too many reports are being rendered right now. Try again in a few moments.",
      );
    case "RENDU_PDF_INDISPONIBLE":
      return t(
        "Le rendu PDF est indisponible pour le moment. Choisissez Word ou PowerPoint, ou réessayez plus tard.",
        "PDF rendering is currently unavailable. Choose Word or PowerPoint, or try again later.",
      );
    case "RENDU_TROP_LONG":
      return tropLong;
    case "RAPPORT_TROP_VOLUMINEUX":
    case "FICHIER_TROP_VOLUMINEUX":
      return tropVolumineux;
    case "QUOTA_STOCKAGE_ATTEINT":
      return t(
        "L'espace de stockage du cabinet est plein : contactez un associé pour libérer de la place.",
        "The firm's storage space is full: contact a partner to free up space.",
      );
    case "DELAI_DEPASSE":
      return t(
        `Le serveur met trop de temps à répondre. ${peutEtre}`,
        `The server is taking too long to respond. ${peutEtre}`,
      );
    case "RESEAU_INDISPONIBLE":
      return t(
        `Connexion au serveur interrompue. Vérifiez votre réseau. ${peutEtre}`,
        `Connection to the server was interrupted. Check your network. ${peutEtre}`,
      );
    case "SERVICE_INDISPONIBLE":
      return t(
        `Le serveur n'a pas répondu à temps ou est momentanément indisponible. ${peutEtre}`,
        `The server did not respond in time or is temporarily unavailable. ${peutEtre}`,
      );
    case "ANNULE":
      return t(
        "Génération interrompue avant la réponse du serveur.",
        "Generation interrupted before the server responded.",
      );
  }
  switch (e.statut) {
    case 400:
      return t(
        "Demande refusée par le serveur (format ou paramètre invalide). Rechargez la page puis réessayez.",
        "Request refused by the server (invalid format or parameter). Reload the page and try again.",
      );
    case 401:
      return t(
        "Votre session a expiré. Reconnectez-vous.",
        "Your session has expired. Sign in again.",
      );
    case 403:
      return t(
        "Votre rôle ne vous permet pas de générer de rapport pour cette mission.",
        "Your role does not allow you to generate a report for this engagement.",
      );
    case 404:
      return t(
        "Cette mission est introuvable ou ne vous est plus accessible.",
        "This engagement cannot be found or is no longer accessible to you.",
      );
    case 409:
      return t(
        "La mission est clôturée : plus aucun rapport ne peut être généré.",
        "The engagement is closed: no more reports can be generated.",
      );
    case 413:
      return tropVolumineux;
    case 429:
      return limite;
    case 503:
      return t(
        "Le service de rendu des rapports est momentanément indisponible. Réessayez dans quelques instants.",
        "The report rendering service is temporarily unavailable. Try again in a few moments.",
      );
    case 504:
      return tropLong;
  }
  return messageErreur(e, langue);
}
