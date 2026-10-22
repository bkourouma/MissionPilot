/**
 * Chemins d'API et appels de l'ingestion de documents (lot 6, ADR-009), un jeu de chemins par
 * domaine : DOS-03 (états financiers d'un client), DD-02 / DD-10 (documents d'un dossier de due
 * diligence) et STD-13 (amorçage d'une version de méthode). Une configuration `ApiIngestion` est de
 * la donnée simple (chaînes à trous) : elle passe sans risque d'un composant serveur à un composant
 * client. Aucune donnée de document n'est mise en cache dans le navigateur.
 */
import { api, type OptionsAppel } from "./api";
import { televerser, type OptionsTeleversement } from "./televersement";
import type {
  DetailDocumentIngestion,
  DocumentIngestion,
  ExtractionIngestion,
  PageDocumentsIngestion,
  PageIngestion,
} from "./ingestion";

const enc = encodeURIComponent;

/**
 * Chemins d'API d'un domaine d'ingestion. Les trous `{docId}`, `{numero}` et `{id}` (extraction)
 * sont remplis par les fonctions `cheminXxx`. `null` : le domaine n'a pas cette route.
 */
export interface ApiIngestion {
  domaine: "dossier" | "dd" | "standard";
  /** Liste des documents (GET), requête `limite` et `curseur` ajoutées à la demande. */
  liste: string;
  /** Détail d'un document (GET). */
  detail: string;
  /** Texte d'une page (GET). */
  page: string;
  /** Relance de la lecture (POST) ; `null` pour un état financier. */
  relance: string | null;
  /** Correction d'une extraction (PATCH). */
  extraction: string | null;
  /** Décision sur une extraction (POST). */
  decision: string | null;
}

/** DOS-03 : documents d'états financiers d'un client (aucune extraction : l'état naît des contrôles). */
export function apiIngestionDossier(clientId: string): ApiIngestion {
  const base = `/api/dossiers/${enc(clientId)}/ingestions`;
  return {
    domaine: "dossier",
    liste: base,
    detail: `${base}/{docId}`,
    page: `${base}/{docId}/pages/{numero}`,
    relance: null,
    extraction: null,
    decision: null,
  };
}

/** DD-02 / DD-10 : rapports et salle de données d'un dossier de due diligence. */
export function apiIngestionDd(dossierId: string): ApiIngestion {
  return {
    domaine: "dd",
    liste: `/api/dd/dossiers/${enc(dossierId)}/documents`,
    detail: "/api/dd/documents/{docId}",
    page: "/api/dd/documents/{docId}/pages/{numero}",
    relance: "/api/dd/documents/{docId}/lecture",
    extraction: "/api/dd/extractions/{id}",
    decision: "/api/dd/extractions/{id}/decision",
  };
}

/** STD-13 : documents historiques d'une version (brouillon) de méthode. */
export function apiIngestionStandard(versionId: string): ApiIngestion {
  return {
    domaine: "standard",
    liste: `/api/methodes/versions/${enc(versionId)}/amorcage/documents`,
    detail: "/api/amorcage/documents/{docId}",
    page: "/api/amorcage/documents/{docId}/pages/{numero}",
    relance: "/api/amorcage/documents/{docId}/proposition",
    extraction: "/api/amorcage/extractions/{id}",
    decision: "/api/amorcage/extractions/{id}/decision",
  };
}

function remplir(modele: string, valeurs: Record<string, string | number>): string {
  return modele.replace(/\{(\w+)\}/g, (_, cle: string) => enc(String(valeurs[cle] ?? "")));
}

function exigerChemin(modele: string | null, nom: string): string {
  if (modele === null) throw new Error(`Route « ${nom} » absente de ce domaine d'ingestion.`);
  return modele;
}

export const cheminListe = (a: ApiIngestion) => a.liste;
export const cheminDocument = (a: ApiIngestion, docId: string) => remplir(a.detail, { docId });
export const cheminPageDocument = (a: ApiIngestion, docId: string, numero: number) =>
  remplir(a.page, { docId, numero });
export const cheminRelance = (a: ApiIngestion, docId: string) =>
  remplir(exigerChemin(a.relance, "relance"), { docId });
export const cheminExtraction = (a: ApiIngestion, extractionId: string) =>
  remplir(exigerChemin(a.extraction, "extraction"), { id: extractionId });
export const cheminDecisionExtraction = (a: ApiIngestion, extractionId: string) =>
  remplir(exigerChemin(a.decision, "décision"), { id: extractionId });

/** Ajoute des paramètres de requête (valeurs vides ignorées) à un chemin d'API. */
export function avecRequete(
  chemin: string,
  champs: Record<string, string | number | boolean | null | undefined>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(champs)) {
    if (v === null || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${chemin}${chemin.includes("?") ? "&" : "?"}${s}` : chemin;
}

/** Numéro de page cité par `?page=N` (entier de 1 à 200), sinon null. */
export function pageCitee(valeur: string | string[] | null | undefined): number | null {
  const v = Array.isArray(valeur) ? valeur[0] : valeur;
  if (!v || !/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 200 ? n : null;
}

// --- Appels ----------------------------------------------------------------------------------

type OptionsLecture = Omit<OptionsAppel, "methode" | "corps">;

export function listerDocumentsIngestion(
  a: ApiIngestion,
  options: { limite?: number; curseur?: string | null; type?: string } & OptionsLecture = {},
): Promise<PageDocumentsIngestion> {
  const { limite, curseur, type, ...reste } = options;
  return api.get<PageDocumentsIngestion>(
    avecRequete(cheminListe(a), { limite, curseur, type }),
    reste,
  );
}

export const lireDocumentIngestion = (a: ApiIngestion, docId: string, options?: OptionsLecture) =>
  api.get<DetailDocumentIngestion>(cheminDocument(a, docId), options);

export const lirePageIngestion = (
  a: ApiIngestion,
  docId: string,
  numero: number,
  options?: OptionsLecture,
) => api.get<PageIngestion>(cheminPageDocument(a, docId, numero), options);

/** Relance l'analyse d'un document terminé (DD et standard ; pas d'équivalent pour un état financier). */
export const relancerDocumentIngestion = (a: ApiIngestion, docId: string) =>
  api.post<DocumentIngestion>(cheminRelance(a, docId));

/** Correction humaine : le contenu complet remplace le précédent ; le serveur recalcule les vérifications. */
export const modifierExtraction = (
  a: ApiIngestion,
  extractionId: string,
  contenu: Record<string, unknown>,
) => api.patch<ExtractionIngestion>(cheminExtraction(a, extractionId), { contenu });

export interface DecisionExtraction {
  decision: "validee" | "rejetee";
  motif?: string;
  /** Obligatoire pour valider un brouillon qui contient des éléments non vérifiés. */
  acquitte_chiffres?: boolean;
}

export const deciderExtraction = (
  a: ApiIngestion,
  extractionId: string,
  decision: DecisionExtraction,
) => api.post<ExtractionIngestion>(cheminDecisionExtraction(a, extractionId), decision);

/**
 * Téléverse un document (multipart, champ « fichier ») vers `chemin` (point d'API complet, requête
 * comprise). Répond la vue du document (statut `en_file`). Rejette une `ErreurApi`.
 */
export function televerserDocument(
  chemin: string,
  fichier: File,
  options?: OptionsTeleversement,
): Promise<DocumentIngestion> {
  return televerser<DocumentIngestion>(chemin, fichier, fichier.name, options);
}

// --- DD-02 / DD-10 ---------------------------------------------------------------------------

/** Point de téléversement d'un document de due diligence (le type va dans la requête `type`). */
export const cheminTeleversementDd = (dossierId: string) =>
  `/api/dd/dossiers/${enc(dossierId)}/documents`;

const baseDocumentsDd = (missionId: string, dossierId: string) =>
  `/missions/${enc(missionId)}/due-diligence/${enc(dossierId)}/documents`;

export const hrefDocumentsDd = baseDocumentsDd;
export const hrefDocumentDd = (
  missionId: string,
  dossierId: string,
  docId: string,
  page?: number | null,
) => `${baseDocumentsDd(missionId, dossierId)}/${enc(docId)}${page ? `?page=${page}` : ""}`;

// --- STD-13 ----------------------------------------------------------------------------------

export const cheminTeleversementAmorcage = (versionId: string) =>
  `/api/methodes/versions/${enc(versionId)}/amorcage/documents`;

export const hrefAmorcage = (versionId: string) => `/methodes/versions/${enc(versionId)}/amorcage`;
export const hrefDocumentAmorcage = (versionId: string, docId: string, page?: number | null) =>
  `${hrefAmorcage(versionId)}/${enc(docId)}${page ? `?page=${page}` : ""}`;
export const hrefEditeurVersion = (versionId: string) => `/methodes/versions/${enc(versionId)}`;

// --- DOS-03 ----------------------------------------------------------------------------------

/** Préfixe d'API d'un client, pour l'import d'un état financier (téléversement). */
export const cheminApiDossierIngestion = (clientId: string) => `/api/dossiers/${enc(clientId)}`;

export const cheminTeleversementEtat = (
  clientId: string,
  e: { exercice: number; date_cloture: string; devise: string; tolerance: number },
) =>
  avecRequete(`${cheminApiDossierIngestion(clientId)}/etats-financiers/document`, {
    exercice: e.exercice,
    date_cloture: e.date_cloture,
    devise: e.devise,
    tolerance: e.tolerance,
  });

export const hrefEtatFinancier = (clientId: string, etatId: string) =>
  `/dossiers/${enc(clientId)}/finances/${enc(etatId)}`;

export const hrefDocumentEtat = (clientId: string, docId: string, page?: number | null) =>
  `/dossiers/${enc(clientId)}/finances/documents/${enc(docId)}${page ? `?page=${page}` : ""}`;

export const TEXTE_ACCEPTATION_AUTO =
  "L'IA propose, les contrôles décident : l'état est accepté automatiquement seulement si tous " +
  "les contrôles passent (équilibre actif = passif, résultat cohérent) à tolérance nulle, sans " +
  "ligne non lue et avec un texte lu directement dans le document ; sinon il part en revue avec " +
  "ses écarts.";

export const TEXTE_TOLERANCE =
  "En unités mineures (FCFA, centimes) ; 0 par défaut. Seule une tolérance nulle permet " +
  "l'acceptation automatique : avec une tolérance positive, l'état part toujours en revue.";

/** Lien vers une page citée d'un document : `?page=N` la met en évidence, `#page-N` y fait défiler. */
export const hrefPageCitee = (hrefDocument: string, numero: number) =>
  `${hrefDocument.split(/[?#]/)[0]}?page=${numero}#page-${numero}`;
