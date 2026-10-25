/** Notation : choix proposés au calcul (voir `notation.ts`). */
import { SECTEURS_GRILLE_GENERIQUE } from "@missionpilot/shared";
import { formaterScore, libelleClasse, pluriel } from "./notation-libelles";
import type { EnvoiQuestionnaire, VueVersionNotation } from "./notation-types";

const MODES: Record<EnvoiQuestionnaire["mode"], string> = {
  individuel: "individuel",
  collectif: "collectif",
  par_fonction: "par fonction",
};

// --- Choix proposés au calcul ----------------------------------------------------------------

export interface OptionNotation {
  valeur: string;
  libelle: string;
  desactivee?: boolean;
}

/** Questionnaires de la mission ; ceux sans réponse soumise sont proposés désactivés. */
export function optionsEnvois(envois: readonly EnvoiQuestionnaire[]): OptionNotation[] {
  return envois.map((e) => {
    const reponses =
      e.reponses_soumises > 0
        ? pluriel(e.reponses_soumises, "réponse soumise", "réponses soumises")
        : "aucune réponse soumise";
    return {
      valeur: e.id,
      libelle: `${e.titre} — ${MODES[e.mode] ?? e.mode}, ${reponses}`,
      desactivee: e.reponses_soumises < 1,
    };
  });
}

export const envoisNotables = (envois: readonly EnvoiQuestionnaire[]) =>
  envois.filter((e) => e.reponses_soumises > 0);

export const NOM_GRILLE_GENERIQUE = "Grille générique CabinetPilot";
export const LIBELLE_GRILLE_GENERIQUE = `${NOM_GRILLE_GENERIQUE} (par défaut)`;

/** Grilles utilisables au calcul : la générique, puis celles du cabinet qui ont une version validée. */
export function optionsGrillesCalcul(
  grilles: readonly { titre: string; code: string; version_validee_id: string | null }[],
): OptionNotation[] {
  return [
    { valeur: "", libelle: LIBELLE_GRILLE_GENERIQUE },
    ...grilles
      .filter((g) => g.version_validee_id !== null)
      .map((g) => ({ valeur: g.version_validee_id as string, libelle: `${g.titre} (${g.code})` })),
  ];
}

export function optionsSecteurs(
  secteurs: readonly { secteur: string; libelle?: string }[],
): OptionNotation[] {
  return [
    { valeur: "", libelle: "Pondérations par défaut de la grille" },
    ...secteurs.map((s) => ({ valeur: s.secteur, libelle: s.libelle ?? s.secteur })),
  ];
}

/** Secteurs de la grille générique (forme des surcharges de grille). */
export const SECTEURS_GENERIQUES: readonly { secteur: string; libelle: string }[] =
  SECTEURS_GRILLE_GENERIQUE.map((s) => ({ secteur: s.code, libelle: s.libelle }));

/** Annonce lue après un calcul réussi (chiffres de la réponse de l'API). */
export function annonceCalcul(vue: Pick<VueVersionNotation, "numero" | "score">): string {
  const score = vue.score.notable
    ? `score global ${formaterScore(vue.score.score)} sur 100, ${libelleClasse(vue.score.classe)}`
    : "score global non notable (réponses insuffisantes)";
  return `Calcul terminé : version ${vue.numero} en brouillon, ${score}.`;
}
