import {
  etatQuestionnaire,
  validerReponses,
  type DefinitionQuestionnaire,
  type Question,
  type ValeurReponse,
} from "@missionpilot/engines";
import { GRILLE_GENERIQUE } from "@missionpilot/shared";
import type { Alea } from "../horloge.js";

/*
 * Génération déterministe (graine fixe) de réponses de répondants à un questionnaire, pour que
 * les envois du Tenant démo aient des réponses VALIDES au sens du moteur de questionnaires
 * (visibilité conditionnelle, bornes, options). Rien n'est calculé ici : les scores sortent du
 * moteur de notation à partir de ces réponses, par les routes.
 *
 * Un « profil » donne le niveau de maturité de l'entreprise répondante (0 à 1) et un écart par
 * dimension ; chaque répondant ajoute son biais (un dirigeant tend à s'estimer mieux placé qu'un
 * contributeur) et un bruit. Pour les questions notées par la grille générique, la réponse est
 * choisie pour que les points de la règle de conversion approchent le niveau visé.
 */

export interface ProfilEntreprise {
  /** Maturité moyenne visée, de 0 à 1. */
  base: number;
  /** Écart par dimension de la grille (décalage de maturité). */
  ecarts: Record<string, number>;
}

/** Profil dont les écarts par dimension sont tirés à graine fixe. */
export function creerProfil(base: number, alea: Alea): ProfilEntreprise {
  const ecarts: Record<string, number> = {};
  for (const d of GRILLE_GENERIQUE.dimensions) ecarts[d.id] = (alea.suivant() - 0.5) * 0.28;
  return { base, ecarts };
}

interface Regle {
  dimension: string;
  conversion: (typeof GRILLE_GENERIQUE.dimensions)[number]["indicateurs"][number]["conversion"];
}

const REGLES = new Map<string, Regle>(
  GRILLE_GENERIQUE.dimensions.flatMap((d) =>
    d.indicateurs.map((i) => [i.question, { dimension: d.id, conversion: i.conversion }] as const),
  ),
);

const borner = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, v));

const PHRASES = [
  "Les pratiques existent mais dépendent beaucoup de quelques personnes clés.",
  "Nous avançons, mais la formalisation reste à renforcer dans les filiales.",
  "Le sujet est suivi en comité de direction chaque trimestre.",
  "Des progrès nets depuis l'an dernier, surtout sur le suivi des indicateurs.",
  "Les équipes sont impliquées, les moyens restent limités.",
  "Point d'attention : la diffusion des décisions jusqu'aux équipes de terrain.",
];

function plusProche(cible: number, valeurs: readonly number[]): number {
  let meilleur = 0;
  valeurs.forEach((v, i) => {
    if (Math.abs(v - cible) < Math.abs((valeurs[meilleur] as number) - cible)) meilleur = i;
  });
  return meilleur;
}

function repondre(q: Question, t: number, alea: Alea, aujourdhui: string): ValeurReponse | null {
  const regle = REGLES.get(q.id)?.conversion;
  const cible = t * 100;
  switch (q.type) {
    case "likert": {
      const inverse = regle?.type === "likert" && regle.inverse === true;
      const x = inverse ? 1 - t : t;
      return Math.min(q.points, Math.max(1, Math.round(1 + (q.points - 1) * x)));
    }
    case "oui_non": {
      if (regle?.type === "oui_non") return plusProche(cible, [regle.non, regle.oui]) === 1;
      return alea.proba(t);
    }
    case "choix_unique": {
      if (regle?.type === "choix") {
        const i = plusProche(
          cible,
          q.options.map((o) => regle.valeurs.find((v) => v.code === o.code)?.points ?? 0),
        );
        return (q.options[i] as { code: string }).code;
      }
      return (q.options[Math.round(t * (q.options.length - 1))] as { code: string }).code;
    }
    case "choix_multiple": {
      const min = q.minSelections ?? 1;
      const max = q.maxSelections ?? q.options.length;
      let ordonnees = q.options.map((o) => ({
        code: o.code,
        points:
          regle?.type === "choix_multiple"
            ? (regle.valeurs.find((v) => v.code === o.code)?.points ?? 0)
            : 1,
      }));
      if (regle?.type === "choix_multiple")
        ordonnees = ordonnees.sort((a, b) => b.points - a.points);
      const choisis: string[] = [];
      let somme = 0;
      for (const o of ordonnees) {
        const assez =
          regle?.type === "choix_multiple"
            ? somme >= cible
            : choisis.length >= 1 + Math.round(t * (ordonnees.length - 1));
        if (choisis.length >= max || (assez && choisis.length >= min)) break;
        choisis.push(o.code);
        somme += o.points;
      }
      return choisis;
    }
    case "numerique": {
      const min = q.min ?? 0;
      const max = q.max ?? 100;
      let v = min + t * (max - min);
      if (regle?.type === "seuils") {
        const paliers = regle.paliers;
        v = (
          paliers[
            plusProche(
              cible,
              paliers.map((p) => p.points),
            )
          ] as { min: number }
        ).min;
      } else if (regle?.type === "interpolation") {
        const pts = regle.points;
        v = (
          pts[
            plusProche(
              cible,
              pts.map((p) => p.y),
            )
          ] as { x: number }
        ).x;
      }
      v = Math.min(max, Math.max(min, v));
      return q.entier === true ? Math.round(v) : Math.round(v * 10) / 10;
    }
    case "texte": {
      const phrase = PHRASES[alea.entier(0, PHRASES.length - 1)] as string;
      return phrase.slice(0, q.longueurMax ?? 2000);
    }
    case "date":
      return q.min ?? aujourdhui;
  }
}

/**
 * Réponses COMPLÈTES et valides (mode soumission) d'un répondant : les questions visibles sont
 * remplies passe après passe, car une réponse peut en rendre d'autres visibles. Les questions
 * facultatives de texte restent vides une fois sur deux.
 */
export function genererReponses(
  definition: DefinitionQuestionnaire,
  profil: ProfilEntreprise,
  biais: number,
  alea: Alea,
  aujourdhui: string,
): Record<string, ValeurReponse> {
  const reponses: Record<string, ValeurReponse> = {};
  for (let passe = 0; passe < 8; passe++) {
    const { visibles } = etatQuestionnaire(definition, reponses);
    let ajoutees = 0;
    for (const q of visibles) {
      if (q.id in reponses) continue;
      if (!q.obligatoire && q.type === "texte" && alea.proba(0.5)) {
        reponses[q.id] = "";
        continue;
      }
      const dimension = REGLES.get(q.id)?.dimension;
      const t = borner(
        profil.base +
          biais +
          (dimension ? (profil.ecarts[dimension] ?? 0) : 0) +
          (alea.suivant() - 0.5) * 0.3,
      );
      const v = repondre(q, t, alea, aujourdhui);
      if (v !== null) reponses[q.id] = v;
      ajoutees++;
    }
    if (ajoutees === 0) break;
  }
  const r = validerReponses(definition, reponses, "soumission");
  if (!r.valide) {
    throw new Error(
      `Réponses générées invalides pour « ${definition.id} » : ${r.erreurs.map((e) => `${e.chemin} (${e.message})`).join(" ; ")}`,
    );
  }
  return { ...r.reponses };
}

/** Début des réponses (brouillon commencé) : les `fraction` premières réponses dans l'ordre du questionnaire. */
export function debut(
  reponses: Record<string, ValeurReponse>,
  fraction: number,
): Record<string, ValeurReponse> {
  const cles = Object.keys(reponses);
  const n = Math.max(1, Math.floor(cles.length * fraction));
  return Object.fromEntries(cles.slice(0, n).map((c) => [c, reponses[c] as ValeurReponse]));
}
