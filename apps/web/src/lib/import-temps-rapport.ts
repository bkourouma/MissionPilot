/** Import des temps : résumé du rapport, annonce, confirmation et liste d'erreurs. */
import { formaterJours, formaterNombre } from "./format";
import type { EtatImport } from "./import-temps-etapes";
import type { RapportImport } from "./temps-admin";

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
