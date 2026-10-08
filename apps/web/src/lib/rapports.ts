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
import { aPermission, type Permission, type Role } from "@missionpilot/shared";
import { CODE_TFA_A_CONFIGURER, ErreurApi, MESSAGE_TFA_A_CONFIGURER, messageErreur } from "./api";
import type { FichierMeta } from "./fichiers";
import { nomPersonne, type Personne } from "./personnes";

export const FORMATS_RAPPORT = ["pdf", "docx", "pptx"] as const;
export type FormatRapport = (typeof FORMATS_RAPPORT)[number];

export const NIVEAUX_RAPPORT = ["base", "jours", "finance"] as const;
export type NiveauRapport = (typeof NIVEAUX_RAPPORT)[number];

/** Niveaux propres aux services (miroir de `rapports/niveaux.ts`) : notation publiée, plan. */
export const NIVEAUX_SERVICE = ["notation", "plan"] as const;
export type NiveauService = (typeof NIVEAUX_SERVICE)[number];

/** Tous les niveaux qu'un rapport listé peut porter. */
export const TOUS_NIVEAUX = [...NIVEAUX_RAPPORT, ...NIVEAUX_SERVICE] as const;
export type NiveauAffichable = NiveauRapport | NiveauService;

/** Rapport tel que listé par GET /api/missions/:id/rapports (métadonnées, jamais le contenu). */
export interface RapportMission {
  id: string;
  mission_id: string;
  modele: string;
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

export const estFormatRapport = (v: unknown): v is FormatRapport =>
  typeof v === "string" && (FORMATS_RAPPORT as readonly string[]).includes(v);

/** Libellé court d'un format reçu de l'API ; repli neutre si inconnu. */
export const libelleFormat = (f: string) => (estFormatRapport(f) ? FORMATS[f].court : "Fichier");

// --- Niveaux -----------------------------------------------------------------------------

/** Permissions exigées pour lire un niveau (miroir de `rapports/niveaux.ts`, cumulatives). */
const PERMISSIONS_NIVEAU: Record<NiveauAffichable, readonly Permission[]> = {
  base: [],
  jours: ["budget.lire_jours"],
  finance: ["budget.lire_jours", "finance.lire"],
  notation: ["notation.lire"],
  plan: ["plan.lire"],
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
};

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

const ABSENTS: Record<Exclude<NiveauRapport, "base">, string> = {
  jours: "Jours : budget, réalisé, temps consommé",
  finance: "Données financières : coûts, taux, marges",
};

/** Sections incluses à ce niveau, et ce qui en est exclu (sans aucun chiffre). */
export function contenuRapport(niveau: NiveauRapport): { inclus: string[]; exclus: string[] } {
  const rang = NIVEAUX_RAPPORT.indexOf(niveau);
  const inclus = NIVEAUX_RAPPORT.slice(0, rang + 1).flatMap((n) => SECTIONS[n]);
  const exclus = NIVEAUX_RAPPORT.slice(rang + 1).map(
    (n) => ABSENTS[n as Exclude<NiveauRapport, "base">],
  );
  return { inclus, exclus };
}

// --- Présentation de la liste ------------------------------------------------------------

const MODELES: Record<string, string> = {
  etat_avancement: "État d'avancement",
  notation: "Rapport de notation",
  plan_strategique: "Plan stratégique",
};
export const libelleModele = (m: string) => MODELES[m] ?? "Rapport";

const STATUTS: Record<string, string> = {
  brouillon: "Brouillon",
  valide: "Validé",
};
export const libelleStatutRapport = (s: string) => STATUTS[s] ?? "Statut non reconnu";

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
export function nomAuteur(id: string, moiId: string, personnes: readonly Personne[]): string {
  return id === moiId ? "Vous" : nomPersonne(id, personnes);
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
export function messageAttente(format: FormatRapport, secondes: number): string {
  if (secondes < 10) {
    return format === "pdf"
      ? "Génération du rapport PDF en cours. Le rendu peut prendre jusqu'à 30 secondes : ne fermez pas la page."
      : `Génération du rapport ${FORMATS[format].court} en cours : ne fermez pas la page.`;
  }
  if (secondes < 25) return "Génération toujours en cours, merci de patienter.";
  return "La génération prend plus de temps que d'habitude : encore quelques instants.";
}

/** Durée écoulée lisible : « 8 s », « 1 min 05 s ». */
export function formaterDuree(secondes: number): string {
  const s = Number.isFinite(secondes) && secondes > 0 ? Math.floor(secondes) : 0;
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

export const MESSAGE_LIMITE_RAPPORTS =
  "Vous avez atteint la limite de 10 rapports par 10 minutes. Patientez quelques minutes avant d'en générer un nouveau.";

const PEUT_ETRE_CREE =
  "Le rapport a peut-être été créé malgré tout : actualisez la liste avant de réessayer.";

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
export function messageRapport(e: unknown): string {
  if (!(e instanceof ErreurApi)) return messageErreur(e);
  if (e.code === CODE_TFA_A_CONFIGURER) return MESSAGE_TFA_A_CONFIGURER;
  switch (e.code) {
    case "TROP_DE_RAPPORTS":
      return MESSAGE_LIMITE_RAPPORTS;
    case "RENDU_OCCUPE":
      return "Trop de rapports sont en cours de rendu en ce moment. Réessayez dans quelques instants.";
    case "RENDU_PDF_INDISPONIBLE":
      return "Le rendu PDF est indisponible pour le moment. Choisissez Word ou PowerPoint, ou réessayez plus tard.";
    case "RENDU_TROP_LONG":
      return "Délai dépassé : le rendu du rapport a pris trop de temps. Réessayez, ou choisissez Word ou PowerPoint, plus rapides à produire.";
    case "RAPPORT_TROP_VOLUMINEUX":
    case "FICHIER_TROP_VOLUMINEUX":
      return "Le rapport produit dépasse la taille de fichier autorisée. Essayez un autre format, ou contactez un associé.";
    case "QUOTA_STOCKAGE_ATTEINT":
      return "L'espace de stockage du cabinet est plein : contactez un associé pour libérer de la place.";
    case "DELAI_DEPASSE":
      return `Le serveur met trop de temps à répondre. ${PEUT_ETRE_CREE}`;
    case "RESEAU_INDISPONIBLE":
      return `Connexion au serveur interrompue. Vérifiez votre réseau. ${PEUT_ETRE_CREE}`;
    case "SERVICE_INDISPONIBLE":
      return `Le serveur n'a pas répondu à temps ou est momentanément indisponible. ${PEUT_ETRE_CREE}`;
    case "ANNULE":
      return "Génération interrompue avant la réponse du serveur.";
  }
  switch (e.statut) {
    case 400:
      return "Demande refusée par le serveur (format ou paramètre invalide). Rechargez la page puis réessayez.";
    case 401:
      return "Votre session a expiré. Reconnectez-vous.";
    case 403:
      return "Votre rôle ne vous permet pas de générer de rapport pour cette mission.";
    case 404:
      return "Cette mission est introuvable ou ne vous est plus accessible.";
    case 409:
      return "La mission est clôturée : plus aucun rapport ne peut être généré.";
    case 413:
      return "Le rapport produit dépasse la taille de fichier autorisée. Essayez un autre format, ou contactez un associé.";
    case 429:
      return MESSAGE_LIMITE_RAPPORTS;
    case 503:
      return "Le service de rendu des rapports est momentanément indisponible. Réessayez dans quelques instants.";
    case 504:
      return "Délai dépassé : le rendu du rapport a pris trop de temps. Réessayez, ou choisissez Word ou PowerPoint, plus rapides à produire.";
  }
  return messageErreur(e);
}
