/** Import des temps : source envoyée à l'API, rapport vérifié et modèle Excel. */
import {
  api,
  ErreurApi,
  erreurDepuisReponse,
  MESSAGE_DELAI,
  MESSAGE_INATTENDU,
  MESSAGE_RESEAU,
} from "./api";
import { controlerFichierImport, TYPE_XLSX, type FormatImport } from "./import-temps-fichier";
import { televerser } from "./televersement";
import { validerCsv, type RapportImport } from "./temps-admin";

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
