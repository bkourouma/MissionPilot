/**
 * Import de l'historique des temps (TPS-10) depuis un classeur Excel .xlsx ou un fichier CSV :
 * contrôle local du fichier, étapes de l'écran (simulation obligatoire, confirmation explicite,
 * exécution), messages d'erreur de l'API et résumé du rapport. Logique pure (hors
 * `preparerSource`, `envoyerImport` et `telechargerModele`, qui lisent un fichier ou appellent
 * l'API), testée dans `import-temps.test.ts`.
 *
 * Le contrôle local donne un retour immédiat et épargne la connexion ; l'API reste seule juge :
 * elle relit le fichier, contrôle chaque ligne et refuse l'exécution d'un import qui comporte la
 * moindre erreur (tout ou rien). Rien n'est conservé dans le navigateur (ni stockage local, ni
 * URL) : le contenu simulé ne vit que dans l'état de la page.
 */
import { IMPORT_TEMPS_MAX_LIGNES, type TypeFichier } from "@missionpilot/shared";
import {
  api,
  CODE_TFA_A_CONFIGURER,
  ErreurApi,
  erreurDepuisReponse,
  MESSAGE_DELAI,
  MESSAGE_INATTENDU,
  MESSAGE_RESEAU,
  MESSAGE_TFA_A_CONFIGURER,
  messageErreur,
} from "./api";
import { extensionDe, formaterTaille } from "./fichiers";
import { formaterJours, formaterNombre } from "./format";
import { televerser } from "./televersement";
import {
  executionPossible,
  IMPORT_MAX_OCTETS_FICHIER,
  validerCsv,
  type RapportImport,
} from "./temps-admin";

export type { RapportImport } from "./temps-admin";

export type FormatImport = "xlsx" | "csv";

// --- Contrôle local du fichier -------------------------------------------------------------------

/** Plafond d'un classeur, égal à celui de l'API (`IMPORT_EXCEL_TAILLE_MAX`) : 2 Mio. */
export const IMPORT_EXCEL_MAX_OCTETS = 2 * 1024 * 1024;
/** Plafond d'un CSV : il part en JSON, dans un corps de 1 Mio au plus côté API. */
export const IMPORT_CSV_MAX_OCTETS = IMPORT_MAX_OCTETS_FICHIER;

const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Types proposés au choix de fichier (sous-ensemble de la liste blanche partagée). */
export const TYPES_IMPORT: readonly TypeFichier[] = [TYPE_XLSX, "text/csv"];

export const AIDE_FICHIER_IMPORT =
  `Classeur Excel .xlsx (2 Mo au plus) ou fichier CSV encodé en UTF-8 (1 Mo au plus), ` +
  `${formaterNombre(IMPORT_TEMPS_MAX_LIGNES, 0)} lignes au plus. Un ancien classeur .xls ` +
  `s'enregistre d'abord au format « Classeur Excel (.xlsx) ».`;

const LIMITES: Record<FormatImport, { octets: number; libelle: string }> = {
  xlsx: { octets: IMPORT_EXCEL_MAX_OCTETS, libelle: "2 Mo au plus pour un classeur Excel" },
  csv: { octets: IMPORT_CSV_MAX_OCTETS, libelle: "1 Mo au plus pour un fichier CSV" },
};

/** Formats voisins refusés, avec la marche à suivre (Map : pas de clé héritée d'Object). */
const AUTRES_FORMATS = new Map<string, string>([
  [
    "xls",
    "Ancien format Excel (.xls) non pris en charge : ouvrez le fichier dans Excel et enregistrez-le au format « Classeur Excel (.xlsx) ».",
  ],
  [
    "xlsm",
    "Classeur à macros (.xlsm) refusé : enregistrez-le au format « Classeur Excel (.xlsx) ».",
  ],
  [
    "xlsb",
    "Classeur binaire (.xlsb) non pris en charge : enregistrez-le au format « Classeur Excel (.xlsx) ».",
  ],
  [
    "ods",
    "Classeur OpenDocument (.ods) non pris en charge : enregistrez-le au format .xlsx ou .csv.",
  ],
]);

const FORMAT_NON_ACCEPTE =
  "Format non accepté : choisissez un classeur Excel (.xlsx) ou un fichier CSV (.csv).";

/** Format d'import d'après l'extension du nom, ou `null`. */
export function formatDe(nom: string): FormatImport | null {
  const ext = extensionDe(nom);
  return ext === "xlsx" || ext === "csv" ? ext : null;
}

export type ControleImport = { ok: true; format: FormatImport } | { ok: false; message: string };

/**
 * Contrôle local d'un fichier choisi : extension .xlsx ou .csv, non vide, sous le plafond de son
 * format. Le type MIME annoncé par le navigateur n'est pas cru ; l'API détecte le vrai format.
 */
export function controlerFichierImport(f: { name: string; size: number }): ControleImport {
  const format = formatDe(f.name);
  if (!format) {
    return { ok: false, message: AUTRES_FORMATS.get(extensionDe(f.name)) ?? FORMAT_NON_ACCEPTE };
  }
  if (f.size <= 0) return { ok: false, message: "Ce fichier est vide : choisissez-en un autre." };
  const limite = LIMITES[format];
  if (f.size > limite.octets) {
    return {
      ok: false,
      message: `Fichier trop volumineux (${formaterTaille(f.size)}) : ${limite.libelle}. Découpez l'historique en plusieurs fichiers.`,
    };
  }
  return { ok: true, format };
}

// --- Source envoyée à l'API ----------------------------------------------------------------------

/** Contenu figé au moment de la simulation : l'exécution renvoie exactement celui-ci. */
export type SourceImport = { format: "xlsx"; contenu: Blob } | { format: "csv"; csv: string };

export type PreparationImport =
  { ok: true; source: SourceImport } | { ok: false; champ: "fichier" | "csv"; message: string };

const LECTURE_IMPOSSIBLE =
  "Lecture du fichier impossible (déplacé ou modifié depuis son choix) : choisissez-le de nouveau.";

/**
 * Source de l'import : le fichier choisi s'il y en a un (contrôlé de nouveau), sinon le CSV
 * collé. Le fichier est lu en mémoire tout de suite : modifié ensuite sur le disque, il ne
 * change pas ce qui a été simulé. Un CSV part en texte (JSON), un classeur tel quel (multipart).
 */
export async function preparerSource(
  fichier: (Blob & { name: string }) | null,
  csvColle: string,
): Promise<PreparationImport> {
  if (!fichier) {
    if (csvColle.trim() === "") {
      return {
        ok: false,
        champ: "fichier",
        message: "Choisissez un fichier .xlsx ou .csv, ou collez le contenu d'un CSV.",
      };
    }
    const v = validerCsv(csvColle);
    if (!v.ok) return { ok: false, champ: "csv", message: v.erreurs.csv ?? MESSAGE_INATTENDU };
    return { ok: true, source: { format: "csv", csv: v.charge.csv } };
  }
  const c = controlerFichierImport(fichier);
  if (!c.ok) return { ok: false, champ: "fichier", message: c.message };
  try {
    if (c.format === "xlsx") {
      const contenu = new Blob([await fichier.arrayBuffer()], { type: TYPE_XLSX });
      return { ok: true, source: { format: "xlsx", contenu } };
    }
    const v = validerCsv(await fichier.text());
    if (!v.ok) return { ok: false, champ: "fichier", message: v.erreurs.csv ?? MESSAGE_INATTENDU };
    return { ok: true, source: { format: "csv", csv: v.charge.csv } };
  } catch {
    return { ok: false, champ: "fichier", message: LECTURE_IMPOSSIBLE };
  }
}

/** Route de l'import ; `simulation` est toujours explicite (l'API simule par défaut). */
export function cheminImport(format: FormatImport, simulation: boolean): string {
  const base = format === "xlsx" ? "/api/temps/import/excel" : "/api/temps/import";
  return `${base}?simulation=${simulation ? "true" : "false"}`;
}

const estEntierPositif = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

function listeMessages(v: unknown): RapportImport["erreurs"] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const ok = v.every(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      estEntierPositif((e as { ligne?: unknown }).ligne) &&
      typeof (e as { message?: unknown }).message === "string",
  );
  return ok ? (v as RapportImport["erreurs"]) : null;
}

/** Rapport renvoyé par l'API, vérifié (une réponse inattendue du relais ne casse pas l'écran). */
export function lireRapport(v: unknown): RapportImport | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const erreurs = listeMessages(r.erreurs);
  const avertissements = listeMessages(r.avertissements);
  const valide =
    typeof r.simulation === "boolean" &&
    typeof r.executee === "boolean" &&
    estEntierPositif(r.lignes_lues) &&
    estEntierPositif(r.lignes_valides) &&
    estEntierPositif(r.feuilles) &&
    typeof r.jours_total === "number" &&
    Number.isFinite(r.jours_total) &&
    r.erreurs !== undefined &&
    erreurs !== null &&
    avertissements !== null;
  if (!valide) return null;
  return {
    simulation: r.simulation as boolean,
    executee: r.executee as boolean,
    lignes_lues: r.lignes_lues as number,
    lignes_valides: r.lignes_valides as number,
    feuilles: r.feuilles as number,
    jours_total: r.jours_total as number,
    erreurs,
    avertissements,
  };
}

/** Nom neutre joint au classeur : le nom d'origine ne sert pas à l'API et ne quitte pas le poste. */
const NOM_ENVOI_XLSX = "import-temps.xlsx";
/** Un CSV de 500 000 caractères en 3G : marge confortable. */
const DELAI_CSV_MS = 60_000;

/** Simulation ou exécution ; rejette une `ErreurApi` (statut HTTP, code, message de l'API). */
export async function envoyerImport(
  source: SourceImport,
  simulation: boolean,
  onProgression?: (fraction: number) => void,
): Promise<RapportImport> {
  const brut =
    source.format === "xlsx"
      ? await televerser<unknown>(
          cheminImport("xlsx", simulation),
          source.contenu,
          NOM_ENVOI_XLSX,
          {
            onProgression,
          },
        )
      : await api.post<unknown>(
          cheminImport("csv", simulation),
          { csv: source.csv },
          { delaiMs: DELAI_CSV_MS },
        );
  const rapport = lireRapport(brut);
  if (!rapport) throw new ErreurApi("REPONSE_INVALIDE", MESSAGE_INATTENDU, 200);
  return rapport;
}

// --- Modèle Excel ------------------------------------------------------------------------------

export const CHEMIN_MODELE = "/api/temps/import/modele.xlsx";
export const NOM_MODELE = "modele-import-temps.xlsx";
const DELAI_MODELE_MS = 30_000;

/**
 * Modèle .xlsx par un appel authentifié (cookie de session, même origine) : une erreur de l'API
 * devient un message au lieu d'un faux classeur enregistré sur le poste.
 */
export async function telechargerModele(): Promise<Blob> {
  let reponse: Response;
  try {
    reponse = await fetch(CHEMIN_MODELE, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: `${TYPE_XLSX}, application/json` },
      signal:
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(DELAI_MODELE_MS)
          : undefined,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new ErreurApi("DELAI_DEPASSE", MESSAGE_DELAI, 0);
    }
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

// --- Étapes de l'écran -------------------------------------------------------------------------

/**
 * `choix` : rien de simulé pour la source courante ; `simulation` / `execution` : appel en
 * cours ; `simule` : rapport de simulation affiché ; `confirmation` : l'utilisateur doit
 * confirmer l'import ; `importe` : import réalisé.
 */
export type EtapeImport =
  "choix" | "simulation" | "simule" | "confirmation" | "execution" | "importe";

export interface ErreurImportAffichee {
  titre: string;
  message: string;
  /** Rappel court sous le choix de fichier, quand le fichier lui-même est en cause. */
  rappel?: string;
}

export interface EtatImport {
  etape: EtapeImport;
  rapport: RapportImport | null;
  erreur: ErreurImportAffichee | null;
}

export const ETAT_INITIAL: EtatImport = { etape: "choix", rapport: null, erreur: null };

export type ActionImport =
  /** Fichier choisi ou retiré, CSV modifié, nouvel import : toute simulation est périmée. */
  | { type: "source_modifiee" }
  | { type: "simulation_lancee" }
  /** Le contrôle local a refusé la source après le lancement (erreur affichée sur le champ). */
  | { type: "preparation_refusee" }
  | { type: "simulation_terminee"; rapport: RapportImport }
  | { type: "confirmation_demandee" }
  | { type: "confirmation_annulee" }
  | { type: "execution_lancee" }
  | { type: "execution_terminee"; rapport: RapportImport }
  | { type: "echec"; erreur: ErreurImportAffichee };

const occupe = (e: EtapeImport) => e === "simulation" || e === "execution";

/** Une simulation se lance depuis le choix ou après une simulation (pour la refaire). */
export const peutSimuler = (s: EtatImport) => s.etape === "choix" || s.etape === "simule";

/** L'import ne se demande qu'après une simulation sans erreur, avec au moins une ligne valide. */
export const peutDemanderImport = (s: EtatImport) =>
  s.etape === "simule" && executionPossible(s.rapport, true);

/** La source ne se change pas pendant un appel (le résultat ne correspondrait plus). */
export const sourceModifiable = (s: EtatImport) => !occupe(s.etape);

/**
 * Transitions de l'écran. Toute action hors de son étape est ignorée : pas d'exécution sans
 * simulation réussie puis confirmation, pas de double envoi. Un échec de l'exécution périme la
 * simulation : son résultat est incertain (coupure) ou les données ont changé, il faut simuler
 * de nouveau avant de réessayer.
 */
export function reduireImport(s: EtatImport, a: ActionImport): EtatImport {
  switch (a.type) {
    case "source_modifiee":
      return occupe(s.etape) ? s : ETAT_INITIAL;
    case "simulation_lancee":
      return peutSimuler(s) ? { etape: "simulation", rapport: null, erreur: null } : s;
    case "preparation_refusee":
      return s.etape === "simulation" ? ETAT_INITIAL : s;
    case "simulation_terminee":
      return s.etape === "simulation" ? { etape: "simule", rapport: a.rapport, erreur: null } : s;
    case "confirmation_demandee":
      return peutDemanderImport(s) ? { ...s, etape: "confirmation" } : s;
    case "confirmation_annulee":
      return s.etape === "confirmation" ? { ...s, etape: "simule" } : s;
    case "execution_lancee":
      return s.etape === "confirmation" ? { ...s, etape: "execution", erreur: null } : s;
    case "execution_terminee":
      if (s.etape !== "execution") return s;
      // Sans exécution confirmée par l'API, le rapport n'autorise pas de nouvel essai direct.
      return { etape: a.rapport.executee ? "importe" : "simule", rapport: a.rapport, erreur: null };
    case "echec":
      return occupe(s.etape) ? { etape: "choix", rapport: null, erreur: a.erreur } : s;
  }
}

// --- Messages d'erreur ---------------------------------------------------------------------------

const MESSAGES_GENERIQUES = new Set(["Données invalides.", "Requête invalide."]);
const NOTE_RESULTAT_INCERTAIN =
  "Relancez la simulation avant de réessayer : si l'import a abouti malgré tout, elle signalera les feuilles déjà importées.";

/**
 * Refus certains de l'API, rien n'est importé : 403 `ORIGINE_REFUSEE` (garde CSRF : page
 * ouverte à une autre adresse que celle du web, extension…), 409 `IMPORT_CONCURRENT` (feuille
 * saisie pendant l'exécution), 503 `IMPORT_EXCEL_OCCUPE` (trop de classeurs lus en même temps).
 * Ni « votre rôle ne vous permet pas » (403) ni « résultat inconnu » (5xx) : `null` sinon.
 */
function erreurImportConnue(
  e: ErreurApi,
  phase: "simulation" | "execution",
  titre: string,
): ErreurImportAffichee | null {
  if (e.code === "ORIGINE_REFUSEE") {
    return {
      titre,
      message:
        "Le serveur a refusé l'envoi : la page n'est pas ouverte à l'adresse habituelle de MissionPilot. Rien n'a été importé : rouvrez MissionPilot à son adresse habituelle puis relancez la simulation. Si le problème persiste, prévenez l'administrateur.",
    };
  }
  if (e.code === "IMPORT_CONCURRENT") {
    return {
      titre: "Import refusé : rien n'a été importé",
      message:
        "Une feuille de temps a été saisie pendant l'import pour l'une de ces semaines. Relancez la simulation pour voir les feuilles concernées.",
    };
  }
  if (e.code === "IMPORT_EXCEL_OCCUPE") {
    return {
      titre,
      message:
        phase === "simulation"
          ? "Le serveur traite déjà plusieurs classeurs Excel : réessayez dans un instant."
          : "Le serveur traite déjà plusieurs classeurs Excel et n'a rien importé : réessayez dans un instant, en relançant la simulation.",
    };
  }
  return null;
}

/**
 * Message affiché après un refus de l'API ou un échec réseau, selon l'étape et le format.
 * Les messages métier de l'API (en français, ligne ou cellule citée) sont repris tels quels ;
 * les réponses génériques reçoivent une explication et la marche à suivre.
 */
export function erreurImport(
  e: unknown,
  phase: "simulation" | "execution",
  format: FormatImport,
): ErreurImportAffichee {
  const titre = phase === "simulation" ? "Simulation impossible" : "Import non réalisé";
  if (!(e instanceof ErreurApi)) {
    return phase === "simulation"
      ? { titre, message: MESSAGE_INATTENDU }
      : {
          titre: "Résultat de l'import inconnu",
          message: `${MESSAGE_INATTENDU} ${NOTE_RESULTAT_INCERTAIN}`,
        };
  }
  if (e.code === CODE_TFA_A_CONFIGURER) return { titre, message: MESSAGE_TFA_A_CONFIGURER };
  const connue = erreurImportConnue(e, phase, titre);
  if (connue) return connue;
  if (e.statut === 401) {
    return {
      titre,
      message: "Votre session a expiré. Reconnectez-vous puis relancez la simulation.",
    };
  }
  if (e.statut === 403) {
    return { titre, message: "Votre rôle ne vous permet pas d'importer l'historique des temps." };
  }
  if (e.statut === 413) {
    return {
      titre: "Fichier trop volumineux",
      message: `Le serveur a refusé le fichier : ${LIMITES[format].libelle}. Découpez l'historique en plusieurs fichiers.`,
      rappel: `Fichier trop volumineux : ${LIMITES[format].libelle}.`,
    };
  }
  if (e.statut === 415) {
    return {
      titre,
      message:
        "Le serveur n'a pas reconnu l'envoi du fichier. Choisissez de nouveau le fichier (.xlsx ou .csv) puis relancez la simulation.",
    };
  }
  return erreurImportSuite(e, phase, format, titre);
}

function erreurImportSuite(
  e: ErreurApi,
  phase: "simulation" | "execution",
  format: FormatImport,
  titre: string,
): ErreurImportAffichee {
  if (e.code === "IMPORT_INVALIDE") {
    return {
      titre: "Import refusé : rien n'a été importé",
      message: `${e.message} Les données ont changé depuis la simulation (période clôturée, feuille déjà saisie…) : relancez la simulation pour voir le détail ligne par ligne.`,
    };
  }
  if (e.code === "EXCEL_INVALIDE") {
    return {
      titre: "Classeur Excel refusé",
      message: e.message,
      rappel: "Classeur refusé par le serveur.",
    };
  }
  if (e.statut === 400) {
    const message = MESSAGES_GENERIQUES.has(e.message)
      ? `Le serveur n'a pas pu lire ${format === "xlsx" ? "le classeur" : "le CSV"} : vérifiez son en-tête et son format, puis réessayez.`
      : e.message;
    return { titre, message };
  }
  if (phase === "execution" && (e.statut === 0 || e.statut >= 500)) {
    return {
      titre: "Résultat de l'import inconnu",
      message: `${messageErreur(e)} ${NOTE_RESULTAT_INCERTAIN}`,
    };
  }
  return { titre, message: messageErreur(e) };
}

// --- Résumé du rapport ---------------------------------------------------------------------------

/** « 1 ligne lue », « 0 ligne lue », « 1 200 lignes lues » (singulier sous 2, en français). */
export function compte(n: number, singulier: string, pluriel: string): string {
  return `${formaterNombre(n, 0)} ${n < 2 ? singulier : pluriel}`;
}

export interface ResumeRapport {
  tonalite: "succes" | "attention" | "danger";
  titre: string;
  detail: string;
}

/** Nombre de lignes du fichier citées par au moins une erreur. */
export const lignesEnErreur = (r: RapportImport) => new Set(r.erreurs.map((e) => e.ligne)).size;

function noteAvertissements(r: RapportImport): string {
  const n = r.avertissements.length;
  if (n === 0) return "";
  const verbe = r.executee ? "ont été importées" : "seront importées";
  return ` ${compte(n, "avertissement", "avertissements")} : les lignes concernées ${verbe} quand même.`;
}

/** Titre, détail et tonalité du rapport, aussi annoncés aux lecteurs d'écran. */
export function resumeRapport(r: RapportImport): ResumeRapport {
  const jours = formaterJours(r.jours_total);
  if (r.executee) {
    return {
      tonalite: "succes",
      titre: "Import réalisé",
      detail: `${compte(r.lignes_valides, "ligne importée", "lignes importées")}, ${compte(r.feuilles, "feuille de temps validée", "feuilles de temps validées")}, ${jours} au total.${noteAvertissements(r)}`,
    };
  }
  if (r.lignes_lues === 0) {
    return {
      tonalite: "attention",
      titre: "Aucune ligne de temps à importer",
      detail:
        "Le fichier ne contient que l'en-tête : ajoutez une ligne par collaborateur, tâche et jour, puis relancez la simulation.",
    };
  }
  if (r.erreurs.length > 0) {
    return {
      tonalite: "danger",
      titre: `Simulation : ${compte(lignesEnErreur(r), "ligne en erreur", "lignes en erreur")}, rien ne sera importé`,
      detail: `${compte(r.lignes_lues, "ligne lue", "lignes lues")}, dont ${compte(r.lignes_valides, "valide", "valides")}. L'import est tout ou rien : corrigez le fichier puis relancez la simulation.`,
    };
  }
  return {
    tonalite: "succes",
    titre: "Simulation réussie : rien n'est encore importé",
    detail: `${compte(r.lignes_valides, "ligne valide", "lignes valides")}, ${compte(r.feuilles, "feuille de temps à créer", "feuilles de temps à créer")}, ${jours} au total. Vérifiez ce résumé puis lancez l'import.${noteAvertissements(r)}`,
  };
}

/** Texte de la zone d'annonce (lecteurs d'écran) ; les erreurs ont leur propre alerte. */
export function annonceImport(s: EtatImport): string {
  if (s.etape === "simulation") return "Simulation en cours : vérification de chaque ligne…";
  if (s.etape === "execution") return "Import en cours…";
  if ((s.etape === "simule" || s.etape === "importe") && s.rapport) {
    const r = resumeRapport(s.rapport);
    return `${r.titre}. ${r.detail}`;
  }
  return "";
}

/** Question de la confirmation, avec ce qui va être créé. */
export function questionConfirmation(r: RapportImport): string {
  return `Importer ${compte(r.lignes_valides, "ligne", "lignes")} (${compte(r.feuilles, "feuille de temps", "feuilles de temps")}, ${formaterJours(r.jours_total)}) ?`;
}

export const CONSEQUENCES_IMPORT =
  "Les feuilles importées sont validées d'office, à votre nom : elles ne pourront plus être modifiées, seulement corrigées par une demande de correction tracée. Elles ne comptent pas dans la discipline de saisie.";

/** Au-delà, la liste des erreurs se déplie à la demande (téléphones modestes). */
export const ERREURS_AFFICHEES_MAX = 100;

export function erreursVisibles<T>(
  liste: readonly T[],
  toutes: boolean,
): { visibles: readonly T[]; masquees: number } {
  if (toutes || liste.length <= ERREURS_AFFICHEES_MAX) return { visibles: liste, masquees: 0 };
  return {
    visibles: liste.slice(0, ERREURS_AFFICHEES_MAX),
    masquees: liste.length - ERREURS_AFFICHEES_MAX,
  };
}
