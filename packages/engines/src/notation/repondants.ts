/**
 * Notation multi-répondants et liaison avec le moteur de questionnaires.
 *
 * Moyenne multi-répondants : pour chaque indicateur, moyenne des points des
 * répondants qui y ont répondu, pondérée par le poids de leur rôle (1 par
 * défaut pour tout rôle non cité ; un poids 0 écarte le rôle). On agrège
 * ensuite dimensions et global comme pour un répondant unique. Moyenner au
 * niveau de l'indicateur (et non des scores de dimension) évite qu'un
 * répondant qui a peu répondu pèse autant qu'un autre sur une dimension.
 *
 * Un indicateur sans aucune réponse est « sans objet » si la question est
 * sans objet pour tous les répondants pris en compte, « manquant » sinon.
 * Le résultat ne dépend pas de l'ordre des répondants (sommes exactes).
 */
import { exigerReponsesValides } from "../questionnaires/reponses";
import type { DefinitionQuestionnaire, Reponses } from "../questionnaires/types";
import { etatQuestionnaire } from "../questionnaires/visibilite";
import { ErreurNotation } from "./erreurs";
import {
  ZERO,
  ajouter,
  depuisNombre,
  diviser,
  estNul,
  multiplier,
  type Fraction,
} from "./fraction";
import { exigerCoherence, exigerGrilleValide, type GrilleNotation } from "./grille";
import {
  noterDepuisPoints,
  pointsParIndicateur,
  resoudreOptions,
  scoreGlobal,
  type OptionsNotation,
  type PointsIndicateur,
  type ResultatNotation,
} from "./score";

export interface ReponsesNotation {
  readonly repondant: string;
  readonly role?: string;
  readonly reponses: Reponses;
  /** Questions sans objet pour ce répondant (voir `preparerReponses`). */
  readonly nonApplicables?: readonly string[];
}

export interface OptionsRepondants extends Omit<OptionsNotation, "nonApplicables"> {
  /** Poids par rôle ; un rôle absent prend `poidsRoleDefaut`. */
  readonly poidsRoles?: readonly { readonly role: string; readonly poids: number }[];
  /** Poids d'un rôle non cité ou d'un répondant sans rôle (défaut 1). */
  readonly poidsRoleDefaut?: number;
}

function poidsDe(role: string | undefined, options: OptionsRepondants): Fraction {
  const defaut = options.poidsRoleDefaut ?? 1;
  const cite = role === undefined ? undefined : options.poidsRoles?.find((p) => p.role === role);
  return depuisNombre(cite?.poids ?? defaut);
}

/** Note un ensemble de répondants : moyenne pondérée par rôle au niveau de chaque indicateur. */
export function noterRepondants(
  grille: GrilleNotation,
  jeux: readonly ReponsesNotation[],
  options: OptionsRepondants = {},
): ResultatNotation {
  exigerGrilleValide(grille);
  resoudreOptions(options);
  const tousPoids = [
    options.poidsRoleDefaut ?? 1,
    ...(options.poidsRoles ?? []).map((p) => p.poids),
  ];
  if (!tousPoids.every((p) => Number.isFinite(p) && p >= 0)) {
    throw new ErreurNotation(
      "OPTIONS_INVALIDES",
      "Les poids de rôle doivent être des nombres positifs ou nuls.",
    );
  }
  const ids = jeux.map((j) => j.repondant);
  if (jeux.length === 0 || new Set(ids).size !== ids.length) {
    throw new ErreurNotation("REPONDANT_INVALIDE", "Répondants absents ou en double.");
  }
  const retenus = jeux
    .map((j) => ({
      poids: poidsDe(j.role, options),
      points: pointsParIndicateur(grille, j.reponses, new Set(j.nonApplicables ?? [])),
    }))
    .filter((j) => !estNul(j.poids));
  if (retenus.length === 0) {
    throw new ErreurNotation("REPONDANT_INVALIDE", "Aucun répondant n'a un poids de rôle positif.");
  }

  const moyennes = new Map<string, PointsIndicateur>();
  for (const d of grille.dimensions) {
    for (const ind of d.indicateurs) {
      let numerateur = ZERO;
      let denominateur = ZERO;
      let applicable = false;
      for (const r of retenus) {
        const p = r.points.get(ind.id) as PointsIndicateur;
        if (p === "sans_objet") continue;
        applicable = true;
        if (p === null) continue;
        numerateur = ajouter(numerateur, multiplier(r.poids, p));
        denominateur = ajouter(denominateur, r.poids);
      }
      moyennes.set(
        ind.id,
        !applicable
          ? "sans_objet"
          : estNul(denominateur)
            ? null
            : diviser(numerateur, denominateur),
      );
    }
  }
  return noterDepuisPoints(grille, moyennes, options);
}

/**
 * Prépare un jeu de réponses brut pour la notation : valide les valeurs
 * contre le questionnaire (mode brouillon : les obligatoires manquantes ne
 * bloquent pas, elles deviennent des indicateurs manquants), écarte les
 * réponses aux questions invisibles et liste comme « sans objet » les
 * questions notées qui sont invisibles. Lève `GRILLE_INVALIDE` si grille et
 * questionnaire ne s'accordent pas, `REPONSES_INVALIDES` si une valeur est
 * invalide.
 */
export function preparerReponses(
  grille: GrilleNotation,
  definition: DefinitionQuestionnaire,
  reponses: Reponses,
): { reponses: Reponses; nonApplicables: string[] } {
  exigerCoherence(grille, definition);
  const propres = exigerReponsesValides(definition, reponses, "brouillon");
  const visibles = new Set(etatQuestionnaire(definition, reponses).visibles.map((q) => q.id));
  const nonApplicables = grille.dimensions
    .flatMap((d) => d.indicateurs.map((i) => i.question))
    .filter((q) => !visibles.has(q));
  return { reponses: propres, nonApplicables };
}

/** Note un jeu de réponses brut d'un questionnaire (préparation puis score global). */
export function noterQuestionnaire(
  grille: GrilleNotation,
  definition: DefinitionQuestionnaire,
  reponses: Reponses,
  options: Omit<OptionsNotation, "nonApplicables"> = {},
): ResultatNotation {
  const prepare = preparerReponses(grille, definition, reponses);
  return scoreGlobal(grille, prepare.reponses, {
    ...options,
    nonApplicables: prepare.nonApplicables,
  });
}
