/** Notation : choix proposés au calcul (voir `notation.ts`). */
import { creerTraduire, SECTEURS_GRILLE_GENERIQUE, type Langue } from "@missionpilot/shared";
import {
  formaterScore,
  libelleClasse,
  libelleSecteurGenerique,
  pluriel,
} from "./notation-libelles";
import type { EnvoiQuestionnaire, VueVersionNotation } from "./notation-types";

const MODES: Record<EnvoiQuestionnaire["mode"], string> = {
  individuel: "individuel",
  collectif: "collectif",
  par_fonction: "par fonction",
};

const MODES_EN: Record<EnvoiQuestionnaire["mode"], string> = {
  individuel: "individual",
  collectif: "collective",
  par_fonction: "by role",
};

// --- Choix proposés au calcul ----------------------------------------------------------------

export interface OptionNotation {
  valeur: string;
  libelle: string;
  desactivee?: boolean;
}

/** Questionnaires de la mission ; ceux sans réponse soumise sont proposés désactivés. */
export function optionsEnvois(
  envois: readonly EnvoiQuestionnaire[],
  langue: Langue = "fr",
): OptionNotation[] {
  const en = langue === "en";
  return envois.map((e) => {
    const reponses =
      e.reponses_soumises > 0
        ? en
          ? pluriel(e.reponses_soumises, "answer submitted", "answers submitted")
          : pluriel(e.reponses_soumises, "réponse soumise", "réponses soumises")
        : en
          ? "no answer submitted"
          : "aucune réponse soumise";
    const mode = (en ? MODES_EN : MODES)[e.mode] ?? e.mode;
    return {
      valeur: e.id,
      libelle: `${e.titre} — ${mode}, ${reponses}`,
      desactivee: e.reponses_soumises < 1,
    };
  });
}

export const envoisNotables = (envois: readonly EnvoiQuestionnaire[]) =>
  envois.filter((e) => e.reponses_soumises > 0);

export const NOM_GRILLE_GENERIQUE = "Grille générique CabinetPilot";
export const LIBELLE_GRILLE_GENERIQUE = `${NOM_GRILLE_GENERIQUE} (par défaut)`;

/** Nom de la grille générique dans la langue demandée. */
export const nomGrilleGenerique = (langue: Langue = "fr") =>
  langue === "en" ? "CabinetPilot generic framework" : NOM_GRILLE_GENERIQUE;

/** Libellé de la grille générique proposée par défaut au calcul. */
export const libelleGrilleGenerique = (langue: Langue = "fr") =>
  langue === "en" ? `${nomGrilleGenerique(langue)} (default)` : LIBELLE_GRILLE_GENERIQUE;

/** Grilles utilisables au calcul : la générique, puis celles du cabinet qui ont une version validée. */
export function optionsGrillesCalcul(
  grilles: readonly { titre: string; code: string; version_validee_id: string | null }[],
  langue: Langue = "fr",
): OptionNotation[] {
  return [
    { valeur: "", libelle: libelleGrilleGenerique(langue) },
    ...grilles
      .filter((g) => g.version_validee_id !== null)
      .map((g) => ({ valeur: g.version_validee_id as string, libelle: `${g.titre} (${g.code})` })),
  ];
}

export function optionsSecteurs(
  secteurs: readonly { secteur: string; libelle?: string }[],
  langue: Langue = "fr",
): OptionNotation[] {
  return [
    {
      valeur: "",
      libelle:
        langue === "en"
          ? "Default weightings of the framework"
          : "Pondérations par défaut de la grille",
    },
    ...secteurs.map((s) => ({
      valeur: s.secteur,
      libelle: s.libelle ? libelleSecteurGenerique(s.secteur, s.libelle, langue) : s.secteur,
    })),
  ];
}

/** Secteurs de la grille générique (forme des surcharges de grille). */
export const SECTEURS_GENERIQUES: readonly { secteur: string; libelle: string }[] =
  SECTEURS_GRILLE_GENERIQUE.map((s) => ({ secteur: s.code, libelle: s.libelle }));

/** Annonce lue après un calcul réussi (chiffres de la réponse de l'API). */
export function annonceCalcul(
  vue: Pick<VueVersionNotation, "numero" | "score">,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  const score = vue.score.notable
    ? t(
        `score global ${formaterScore(vue.score.score, langue)} sur 100, ${libelleClasse(vue.score.classe, langue)}`,
        `overall score ${formaterScore(vue.score.score, langue)} out of 100, ${libelleClasse(vue.score.classe, langue)}`,
      )
    : t(
        "score global non notable (réponses insuffisantes)",
        "overall score not rated (insufficient answers)",
      );
  return t(
    `Calcul terminé : version ${vue.numero} en brouillon, ${score}.`,
    `Computation complete: version ${vue.numero} in draft, ${score}.`,
  );
}
