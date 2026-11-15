/** Import des temps : résumé du rapport, annonce, confirmation et liste d'erreurs. */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { formaterJours, formaterNombre } from "./format";
import type { EtatImport } from "./import-temps-etapes";
import type { RapportImport } from "./temps-admin";

/** « 1 ligne lue », « 0 ligne lue », « 1 200 lignes lues » (singulier sous 2, en français). */
export function compte(
  n: number,
  singulier: string,
  pluriel: string,
  langue: Langue = "fr",
): string {
  const un = langue === "en" ? n === 1 : n < 2;
  return `${formaterNombre(n, 0, langue)} ${un ? singulier : pluriel}`;
}

export interface ResumeRapport {
  tonalite: "succes" | "attention" | "danger";
  titre: string;
  detail: string;
}

/** Nombre de lignes du fichier citées par au moins une erreur. */
export const lignesEnErreur = (r: RapportImport) => new Set(r.erreurs.map((e) => e.ligne)).size;

function noteAvertissements(r: RapportImport, langue: Langue): string {
  const t = creerTraduire(langue);
  const n = r.avertissements.length;
  if (n === 0) return "";
  const verbe = r.executee
    ? t("ont été importées", "were imported")
    : t("seront importées", "will be imported");
  return ` ${compte(n, t("avertissement", "warning"), t("avertissements", "warnings"), langue)}${t(" : les lignes concernées ", ": the rows concerned ")}${verbe}${t(" quand même.", " anyway.")}`;
}

/** Titre, détail et tonalité du rapport, aussi annoncés aux lecteurs d'écran. */
export function resumeRapport(r: RapportImport, langue: Langue = "fr"): ResumeRapport {
  const t = creerTraduire(langue);
  const c = (n: number, sf: string, pf: string, se: string, pe: string) =>
    compte(n, t(sf, se), t(pf, pe), langue);
  const jours = formaterJours(r.jours_total, langue);
  if (r.executee) {
    return {
      tonalite: "succes",
      titre: t("Import réalisé", "Import completed"),
      detail: t(
        `${c(r.lignes_valides, "ligne importée", "lignes importées", "row imported", "rows imported")}, ${c(r.feuilles, "feuille de temps validée", "feuilles de temps validées", "timesheet approved", "timesheets approved")}, ${jours} au total.${noteAvertissements(r, langue)}`,
        `${c(r.lignes_valides, "ligne importée", "lignes importées", "row imported", "rows imported")}, ${c(r.feuilles, "feuille de temps validée", "feuilles de temps validées", "timesheet approved", "timesheets approved")}, ${jours} in total.${noteAvertissements(r, langue)}`,
      ),
    };
  }
  if (r.lignes_lues === 0) {
    return {
      tonalite: "attention",
      titre: t("Aucune ligne de temps à importer", "No time rows to import"),
      detail: t(
        "Le fichier ne contient que l'en-tête : ajoutez une ligne par collaborateur, tâche et jour, puis relancez la simulation.",
        "The file only contains the header: add one row per employee, task and day, then run the simulation again.",
      ),
    };
  }
  if (r.erreurs.length > 0) {
    const enErreur = c(
      lignesEnErreur(r),
      "ligne en erreur",
      "lignes en erreur",
      "row with errors",
      "rows with errors",
    );
    const lues = c(r.lignes_lues, "ligne lue", "lignes lues", "row read", "rows read");
    const valides = c(r.lignes_valides, "valide", "valides", "valid", "valid");
    return {
      tonalite: "danger",
      titre: t(
        `Simulation : ${enErreur}, rien ne sera importé`,
        `Simulation: ${enErreur}, nothing will be imported`,
      ),
      detail: t(
        `${lues}, dont ${valides}. L'import est tout ou rien : corrigez le fichier puis relancez la simulation.`,
        `${lues}, of which ${valides}. The import is all or nothing: fix the file, then run the simulation again.`,
      ),
    };
  }
  return {
    tonalite: "succes",
    titre: t(
      "Simulation réussie : rien n'est encore importé",
      "Simulation successful: nothing is imported yet",
    ),
    detail: t(
      `${c(r.lignes_valides, "ligne valide", "lignes valides", "valid row", "valid rows")}, ${c(r.feuilles, "feuille de temps à créer", "feuilles de temps à créer", "timesheet to create", "timesheets to create")}, ${jours} au total. Vérifiez ce résumé puis lancez l'import.${noteAvertissements(r, langue)}`,
      `${c(r.lignes_valides, "ligne valide", "lignes valides", "valid row", "valid rows")}, ${c(r.feuilles, "feuille de temps à créer", "feuilles de temps à créer", "timesheet to create", "timesheets to create")}, ${jours} in total. Check this summary, then start the import.${noteAvertissements(r, langue)}`,
    ),
  };
}

/** Texte de la zone d'annonce (lecteurs d'écran) ; les erreurs ont leur propre alerte. */
export function annonceImport(s: EtatImport, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (s.etape === "simulation")
    return t(
      "Simulation en cours : vérification de chaque ligne…",
      "Simulation in progress: checking every row…",
    );
  if (s.etape === "execution") return t("Import en cours…", "Import in progress…");
  if ((s.etape === "simule" || s.etape === "importe") && s.rapport) {
    const r = resumeRapport(s.rapport, langue);
    return `${r.titre}. ${r.detail}`;
  }
  return "";
}

/** Question de la confirmation, avec ce qui va être créé. */
export function questionConfirmation(r: RapportImport, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  const lignes = compte(r.lignes_valides, t("ligne", "row"), t("lignes", "rows"), langue);
  const feuilles = compte(
    r.feuilles,
    t("feuille de temps", "timesheet"),
    t("feuilles de temps", "timesheets"),
    langue,
  );
  const jours = formaterJours(r.jours_total, langue);
  return t(
    `Importer ${lignes} (${feuilles}, ${jours}) ?`,
    `Import ${lignes} (${feuilles}, ${jours})?`,
  );
}

export const CONSEQUENCES_IMPORT =
  "Les feuilles importées sont validées d'office, à votre nom : elles ne pourront plus être modifiées, seulement corrigées par une demande de correction tracée. Elles ne comptent pas dans la discipline de saisie.";

export const CONSEQUENCES_IMPORT_EN =
  "The imported timesheets are approved automatically, in your name: they can no longer be edited, only corrected through a tracked correction request. They do not count toward entry discipline.";

export const consequencesImport = (langue: Langue = "fr") =>
  langue === "en" ? CONSEQUENCES_IMPORT_EN : CONSEQUENCES_IMPORT;

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
