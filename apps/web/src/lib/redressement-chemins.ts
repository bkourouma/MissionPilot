/** Redressement : chemins d'API, liens des pages et filtres du portefeuille (paramètres d'URL). */
import {
  RED_SECTEURS,
  RED_STATUTS_DOSSIER,
  type RedSecteur,
  type RedStatutDossier,
} from "@missionpilot/shared";

// --- Chemins d'API (un par route de SPEC-3a §9.3) -----------------------------------------------

export const enc = encodeURIComponent;

export const CHEMIN_REFERENTIEL_RED = "/api/redressement/referentiel";
export const CHEMIN_SEUILS_RED = "/api/redressement/seuils";

export interface FiltresPortefeuille {
  statut?: RedStatutDossier;
  secteur?: RedSecteur;
  q?: string;
  curseur?: string;
}

function requete(parametres: Record<string, string | undefined>): string {
  const r = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined && valeur !== "") r.set(cle, valeur);
  }
  const texte = r.toString();
  return texte === "" ? "" : `?${texte}`;
}

/** Route 2 : portefeuille (la `limite` est celle par défaut de l'API, 30). */
export function cheminDossiersRed(filtres: FiltresPortefeuille = {}): string {
  return `/api/redressement/dossiers${requete({
    statut: filtres.statut,
    secteur: filtres.secteur,
    q: filtres.q,
    curseur: filtres.curseur,
  })}`;
}

/** Routes 3 et 4 : ouvrir (POST) et lire (GET) le dossier d'une mission. */
export const cheminDossierMission = (missionId: string) =>
  `/api/missions/${enc(missionId)}/redressement`;
/** Routes 5 et 6. */
export const cheminDossierRed = (id: string) => `/api/redressement/dossiers/${enc(id)}`;
/** Route 7. */
export const cheminStatutDossier = (id: string) => `${cheminDossierRed(id)}/statut`;
/** Routes 8 et 9. */
export const cheminCorrespondances = (id: string) => `${cheminDossierRed(id)}/correspondances`;
/** Route 10. */
export const cheminRatios = (id: string) => `${cheminDossierRed(id)}/ratios`;
/** Routes 11 et 12 (`limite` : 50 au plus, `RED_LIMITE_HISTORIQUE_MAX`). */
export const cheminUrgences = (id: string, curseur?: string | null) =>
  `${cheminDossierRed(id)}/urgences${requete({ curseur: curseur ?? undefined })}`;
/** Route 13 (le secteur est facultatif). */
export const cheminSeuilsSecteur = (secteur?: RedSecteur) =>
  `${CHEMIN_SEUILS_RED}${requete({ secteur })}`;
/** Route 15. */
export const cheminPublicationSeuils = (versionId: string) =>
  `${CHEMIN_SEUILS_RED}/${enc(versionId)}/publication`;
/** Routes 16 et 17. */
export const cheminScores = (id: string, curseur?: string | null) =>
  `${cheminDossierRed(id)}/scores${requete({ curseur: curseur ?? undefined })}`;
/** Route 18. */
export const cheminTresorerie = (id: string) => `${cheminDossierRed(id)}/tresorerie`;
/** Route 19. */
export const cheminVersionsTresorerie = (id: string) => `${cheminTresorerie(id)}/versions`;
/** Route 20. */
export const cheminRealises = (id: string) => `${cheminTresorerie(id)}/realises`;
/** Route 21. */
export const cheminEcheancesAccords = (id: string) => `${cheminTresorerie(id)}/echeances-accords`;
/** Route 22. */
export const cheminPointMort = (id: string) => `${cheminDossierRed(id)}/point-mort`;
/** Routes 23 et 24 : `actifs` vaut `true` (défaut), `false` ou `tous`. */
export const cheminCreanciers = (id: string, actifs: "true" | "false" | "tous" = "true") =>
  `${cheminDossierRed(id)}/creanciers${requete({ actifs: actifs === "true" ? undefined : actifs })}`;
/** Routes 25 et 26. */
export const cheminCreancier = (id: string) => `/api/redressement/creanciers/${enc(id)}`;
/** Route 27. */
export const cheminCreances = (id: string) => `${cheminCreancier(id)}/creances`;
/** Route 28. */
export const cheminEvenements = (id: string) => `${cheminCreancier(id)}/evenements`;
/** Routes 29. */
export const cheminPlan = (id: string) => `${cheminDossierRed(id)}/plan`;
/** Route 30. */
export const cheminActionsDossier = (id: string) => `${cheminDossierRed(id)}/actions`;
/** Routes 31 et 34. */
export const cheminAction = (id: string) => `/api/redressement/actions/${enc(id)}`;
/** Route 32. */
export const cheminDeplacementAction = (id: string) => `${cheminAction(id)}/deplacement`;
/** Route 33. */
export const cheminCommentairesAction = (id: string) => `${cheminAction(id)}/commentaires`;
/** Route 35. */
export const cheminVersionsPlan = (id: string) => `${cheminPlan(id)}/versions`;
/** Route 36. */
export const cheminValidationPlan = (versionId: string) =>
  `/api/redressement/plan/versions/${enc(versionId)}/validation`;
/** Route 37. */
export const cheminSimulationLevier = (id: string) => `${cheminDossierRed(id)}/leviers/simulation`;

// --- Liens des pages ------------------------------------------------------------------------------

export const HREF_PORTEFEUILLE_RED = "/redressement";
export const HREF_SEUILS_RED = "/redressement/seuils";

export type SectionRedressement =
  | "ratios"
  | "urgence"
  | "diagnostic"
  | "alerte"
  | "tresorerie"
  | "financement"
  | "creanciers"
  | "plan"
  | "leviers"
  | "cloture"
  | "suivi"
  | "tableau-de-bord";

/** Synthèse du dossier (sans `section`) ou l'une de ses sections. */
export function hrefRedressement(missionId: string, section?: SectionRedressement): string {
  const base = `/missions/${enc(missionId)}/redressement`;
  return section ? `${base}/${section}` : base;
}

export const hrefCreancierRed = (missionId: string, creancierId: string) =>
  `${hrefRedressement(missionId, "creanciers")}/${enc(creancierId)}`;

/** Lien « Créer une action avec ce levier » (le formulaire du plan préremplit le levier). */
export const hrefPlanAvecLevier = (missionId: string, code: string) =>
  `${hrefRedressement(missionId, "plan")}${requete({ levier: code })}`;

export function hrefPortefeuille(filtres: FiltresPortefeuille = {}): string {
  return `${HREF_PORTEFEUILLE_RED}${requete({
    statut: filtres.statut,
    secteur: filtres.secteur,
    q: filtres.q,
    curseur: filtres.curseur,
  })}`;
}

export const hrefSeuilsSecteur = (secteur: RedSecteur) =>
  `${HREF_SEUILS_RED}${requete({ secteur })}`;

/** Lien vers les finances du client (états financiers du dossier client). */
export const hrefFinancesClient = (clientId: string) => `/dossiers/${enc(clientId)}/finances`;

/** Sections du dossier, dans l'ordre des onglets. */
export function sousPagesRedressement(
  missionId: string,
): { id: string; libelle: string; href: string }[] {
  return [
    { id: "synthese", libelle: "Synthèse", href: hrefRedressement(missionId) },
    { id: "ratios", libelle: "Ratios", href: hrefRedressement(missionId, "ratios") },
    { id: "urgence", libelle: "Urgence", href: hrefRedressement(missionId, "urgence") },
    { id: "diagnostic", libelle: "Diagnostic", href: hrefRedressement(missionId, "diagnostic") },
    { id: "alerte", libelle: "Alerte précoce", href: hrefRedressement(missionId, "alerte") },
    { id: "tresorerie", libelle: "Trésorerie", href: hrefRedressement(missionId, "tresorerie") },
    { id: "financement", libelle: "Financement", href: hrefRedressement(missionId, "financement") },
    { id: "creanciers", libelle: "Créanciers", href: hrefRedressement(missionId, "creanciers") },
    { id: "plan", libelle: "Plan", href: hrefRedressement(missionId, "plan") },
    { id: "leviers", libelle: "Leviers", href: hrefRedressement(missionId, "leviers") },
    { id: "cloture", libelle: "Clôture", href: hrefRedressement(missionId, "cloture") },
    { id: "suivi", libelle: "Suivi", href: hrefRedressement(missionId, "suivi") },
    {
      id: "tableau-de-bord",
      libelle: "Tableau de bord",
      href: hrefRedressement(missionId, "tableau-de-bord"),
    },
  ];
}

// --- Filtres du portefeuille (paramètres d'URL) --------------------------------------------------

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filtres lus dans l'URL : une valeur hors liste est ignorée (l'API refuserait la requête). */
export function lireFiltresPortefeuille(
  p: Record<string, string | string[] | undefined>,
): FiltresPortefeuille {
  const statut = un(p.statut);
  const secteur = un(p.secteur);
  const q = un(p.q).trim().slice(0, 100);
  const curseur = un(p.curseur);
  return {
    statut: (RED_STATUTS_DOSSIER as readonly string[]).includes(statut)
      ? (statut as RedStatutDossier)
      : undefined,
    secteur: (RED_SECTEURS as readonly string[]).includes(secteur)
      ? (secteur as RedSecteur)
      : undefined,
    q: q === "" ? undefined : q,
    curseur: curseur === "" || curseur.length > 500 ? undefined : curseur,
  };
}

/** Secteur lu dans l'URL de la page des seuils (« Général » par défaut). */
export function lireSecteur(v: string | string[] | undefined): RedSecteur {
  const brut = un(v);
  return (RED_SECTEURS as readonly string[]).includes(brut) ? (brut as RedSecteur) : "general";
}
