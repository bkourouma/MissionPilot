/**
 * Chemins de l'API et des pages du pilotage augmenté des KPI, téléchargement du dossier de
 * revue. Voir `kpi-pilotage.ts`, point d'entrée du module.
 */
import { ErreurApi, erreurDepuisReponse, MESSAGE_RESEAU } from "./api";

// --- Chemins --------------------------------------------------------------------------------

const seg = encodeURIComponent;

export const cheminArbres = (m: string) => `/api/missions/${seg(m)}/kpi/arbres`;
export const cheminArbre = (id: string) => `/api/kpi/arbres/${seg(id)}`;
export const cheminNoeuds = (arbre: string) => `/api/kpi/arbres/${seg(arbre)}/noeuds`;
export const cheminNoeud = (id: string) => `/api/kpi/arbres/noeuds/${seg(id)}`;
export const cheminContributions = (arbre: string, avant: string, apres: string) =>
  `/api/kpi/arbres/${seg(arbre)}/contributions?avant=${seg(avant)}&apres=${seg(apres)}`;
export const cheminQualite = (m: string, date: string) =>
  `/api/missions/${seg(m)}/kpi/qualite-donnees?date=${seg(date)}`;
export const cheminActionsMission = (m: string, requete = "") =>
  `/api/missions/${seg(m)}/kpi/actions${requete ? `?${requete}` : ""}`;
export const cheminAction = (id: string) => `/api/kpi/actions/${seg(id)}`;
export const cheminStatutAction = (id: string) => `/api/kpi/actions/${seg(id)}/statut`;
export const cheminCommentairesAction = (id: string) => `/api/kpi/actions/${seg(id)}/commentaires`;
export const cheminRevues = (m: string, requete = "") =>
  `/api/missions/${seg(m)}/kpi/revues${requete ? `?${requete}` : ""}`;
export const cheminRevue = (id: string) => `/api/kpi/revues/${seg(id)}`;
export const cheminOrdreDuJour = (id: string) => `/api/kpi/revues/${seg(id)}/ordre-du-jour`;
export const cheminGenererOrdreDuJour = (id: string) => `${cheminOrdreDuJour(id)}/generer`;
export const cheminActionRevue = (id: string, action: "tenir" | "cloturer" | "annuler") =>
  `/api/kpi/revues/${seg(id)}/${action}`;
export const cheminDecisionsRevue = (id: string) => `/api/kpi/revues/${seg(id)}/decisions`;
export const cheminStatutDecision = (id: string) => `/api/kpi/revues/decisions/${seg(id)}/statut`;
export const cheminDossierRevue = (id: string, format: "pdf" | "docx" | "pptx") =>
  `/api/kpi/revues/${seg(id)}/dossier?format=${format}`;

export const EXTENSIONS_DOSSIER_REVUE = { pdf: "pdf", docx: "docx", pptx: "pptx" } as const;
export type FormatDossierRevue = keyof typeof EXTENSIONS_DOSSIER_REVUE;

/** Nom du fichier téléchargé : « revue-kpi-3.docx » (ASCII, sans donnée du client). */
export const nomFichierDossierRevue = (numero: number, format: FormatDossierRevue) =>
  `revue-kpi-${numero}.${EXTENSIONS_DOSSIER_REVUE[format]}`;

/**
 * Télécharge le dossier de la revue par un appel authentifié (cookie httpOnly), jamais par un
 * lien : une erreur de l'API (429 trop de dossiers, rendu PDF indisponible…) devient une
 * `ErreurApi` affichée en français, au lieu d'un JSON brut dans l'onglet.
 */
export async function telechargerDossierRevue(
  revueId: string,
  format: FormatDossierRevue,
): Promise<Blob> {
  let reponse: Response;
  try {
    reponse = await fetch(cheminDossierRevue(revueId, format), {
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ErreurApi("RESEAU_INDISPONIBLE", MESSAGE_RESEAU, 0);
  }
  if (!reponse.ok) {
    let corps: unknown;
    try {
      corps = await reponse.json();
    } catch {
      corps = undefined;
    }
    throw erreurDepuisReponse(reponse.status, corps);
  }
  return reponse.blob();
}

export const hrefArbres = (m: string) => `/missions/${seg(m)}/kpi/arbres`;
export const hrefArbre = (m: string, id: string, params = "") =>
  `/missions/${seg(m)}/kpi/arbres/${seg(id)}${params ? `?${params}` : ""}`;
export const hrefActions = (m: string) => `/missions/${seg(m)}/kpi/actions`;
/**
 * Formulaire « Nouvelle action corrective » prérempli : KPI, alerte d'origine, ou décision d'une
 * revue (avec la revue, pour retrouver la décision même si la revue n'est plus tenue).
 */
export function hrefNouvelleAction(
  m: string,
  prerempli: {
    kpi?: string | null;
    alerte?: string | null;
    decision?: string | null;
    revue?: string | null;
  } = {},
): string {
  const p = new URLSearchParams();
  if (prerempli.kpi) p.set("kpi", prerempli.kpi);
  if (prerempli.alerte) p.set("alerte", prerempli.alerte);
  if (prerempli.decision) p.set("decision", prerempli.decision);
  if (prerempli.revue) p.set("revue", prerempli.revue);
  const t = p.toString();
  return `${hrefActions(m)}${t ? `?${t}` : ""}#nouvelle-action`;
}
export const hrefAction = (m: string, id: string) => `/missions/${seg(m)}/kpi/actions/${seg(id)}`;
export const hrefRevues = (m: string) => `/missions/${seg(m)}/kpi/revues`;
export const hrefRevue = (m: string, id: string) => `/missions/${seg(m)}/kpi/revues/${seg(id)}`;
