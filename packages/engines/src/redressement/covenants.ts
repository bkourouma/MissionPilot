/**
 * Covenants bancaires financiers (RED-06, lot 2) : un covenant est un SEUIL saisi sur un ratio
 * du moteur de ratios (`ratios.ts`), évalué contre le dernier exercice accepté du dossier client.
 *
 * Un statut « en_defaut » est un CONSTAT ARITHMÉTIQUE (valeur du ratio comparée à un seuil
 * saisi par le consultant), jamais une qualification juridique ni la constatation d'un
 * manquement contractuel : seul le contrat et le prêteur en décident. Tout est en points de base
 * (10 000 = 1) et en entiers ; rien n'est stocké (l'évaluation se refait à la lecture).
 *
 * Marge de sécurité (points de base) : `min` → valeur − seuil ; `max` → seuil − valeur.
 * Positive ou nulle = respecté (la valeur égale au seuil respecte) ; négative = en_defaut.
 */
import {
  type CleRatioRedressement,
  type PosteRatioRedressement,
  type RatioRedressement,
} from "./ratios";
import { exigerEntier, versNombreSur } from "./commun";
import { ErreurRedressement } from "./erreurs";

/** Ratios sur lesquels un covenant financier peut porter (sous-ensemble fermé des ratios). */
export const RATIOS_COVENANT_RED = [
  "liquidite_generale",
  "liquidite_reduite",
  "liquidite_immediate",
  "autonomie_financiere",
  "solvabilite_generale",
  "endettement",
  "couverture_charges_financieres",
] as const satisfies readonly CleRatioRedressement[];
export type RatioCovenantRed = (typeof RATIOS_COVENANT_RED)[number];

export const OPERATEURS_COVENANT_RED = ["min", "max"] as const;
export type OperateurCovenantRed = (typeof OPERATEURS_COVENANT_RED)[number];

export const FREQUENCES_COVENANT_RED = ["trimestrielle", "semestrielle", "annuelle"] as const;
export type FrequenceCovenantRed = (typeof FREQUENCES_COVENANT_RED)[number];

export const COVENANTS_PAR_VERSION_MAX = 12;
/** Seuil en points de base : |seuil| ≤ 10^8 (10 000 fois le ratio). */
export const SEUIL_COVENANT_PB_MAX = 100_000_000;
export const PRETEUR_COVENANT_MAX = 120;

export interface DefinitionCovenant {
  readonly ratio: RatioCovenantRed;
  readonly operateur: OperateurCovenantRed;
  /** Points de base. */
  readonly seuilPb: number;
  /** Libellé du prêteur, facultatif (1..120 caractères). */
  readonly preteur: string | null;
  readonly frequence: FrequenceCovenantRed;
}

export type StatutCovenant = "respecte" | "en_defaut" | "non_calculable";
export type RaisonCovenantNonCalculable =
  "aucun_etat_accepte" | "ratio_non_calculable" | "ratio_sans_objet" | "ratio_non_significatif";

export interface EvaluationCovenant {
  readonly definition: DefinitionCovenant;
  readonly statut: StatutCovenant;
  /** Valeur du ratio (pb) ; null si non calculable. */
  readonly valeurPb: number | null;
  /** Marge de sécurité (pb), négative si en_defaut ; null si non calculable. */
  readonly margePb: number | null;
  readonly raison: RaisonCovenantNonCalculable | null;
  /** Postes à renseigner quand le ratio n'est pas calculable faute de postes. */
  readonly manquants: readonly PosteRatioRedressement[];
}

export interface SyntheseCovenants {
  readonly nombre: number;
  readonly respectes: number;
  readonly enDefaut: number;
  readonly nonCalculables: number;
}

export interface ResultatCovenants {
  readonly evaluations: readonly EvaluationCovenant[];
  readonly synthese: SyntheseCovenants;
}

const invalide = (message: string): never => {
  throw new ErreurRedressement("ENTREE_INVALIDE", message);
};

const estDans = <T extends string>(liste: readonly T[], valeur: unknown): valeur is T =>
  typeof valeur === "string" && (liste as readonly string[]).includes(valeur);

/**
 * Valide une liste de covenants (une version) : champs, bornes, et cohérence — au plus 12
 * covenants, pas deux fois le même (ratio, opérateur), et pour un même ratio un plancher
 * (`min`) jamais au-dessus du plafond (`max`).
 */
export function validerCovenants(covenants: readonly DefinitionCovenant[]): void {
  if (!Array.isArray(covenants) || covenants.length > COVENANTS_PAR_VERSION_MAX) {
    invalide(`Au plus ${COVENANTS_PAR_VERSION_MAX} covenants par version.`);
  }
  const vus = new Map<string, DefinitionCovenant>();
  for (const c of covenants) {
    if (!estDans(RATIOS_COVENANT_RED, c.ratio)) invalide("Ratio de covenant inconnu.");
    if (!estDans(OPERATEURS_COVENANT_RED, c.operateur)) invalide("Opérateur de covenant inconnu.");
    if (!estDans(FREQUENCES_COVENANT_RED, c.frequence)) {
      invalide("Fréquence de test de covenant inconnue.");
    }
    exigerEntier(
      c.seuilPb,
      -SEUIL_COVENANT_PB_MAX,
      SEUIL_COVENANT_PB_MAX,
      "ENTREE_INVALIDE",
      "Seuil de covenant",
    );
    if (c.preteur !== null && (typeof c.preteur !== "string" || c.preteur.trim() === "")) {
      invalide("Libellé de prêteur vide.");
    }
    if (c.preteur !== null && c.preteur.length > PRETEUR_COVENANT_MAX) {
      invalide(`Libellé de prêteur : ${PRETEUR_COVENANT_MAX} caractères au plus.`);
    }
    const cle = `${c.ratio}|${c.operateur}`;
    if (vus.has(cle)) invalide("Un même ratio ne porte pas deux fois le même opérateur.");
    vus.set(cle, c);
  }
  for (const ratio of RATIOS_COVENANT_RED) {
    const plancher = vus.get(`${ratio}|min`);
    const plafond = vus.get(`${ratio}|max`);
    if (plancher && plafond && plancher.seuilPb > plafond.seuilPb) {
      invalide("Le plancher d'un ratio ne dépasse pas son plafond.");
    }
  }
}

const RAISONS_RATIO: Readonly<
  Record<
    Exclude<RatioRedressement["statut"], "calcule">,
    Exclude<RaisonCovenantNonCalculable, "aucun_etat_accepte">
  >
> = {
  non_calculable: "ratio_non_calculable",
  sans_objet: "ratio_sans_objet",
  non_significatif: "ratio_non_significatif",
};

/**
 * Évalue des covenants contre les ratios du dernier exercice accepté (`null` sans exercice).
 * Un ratio absent, non calculable, sans objet ou non significatif rend « non_calculable » : il
 * n'est jamais compté comme respecté ni comme en_defaut.
 */
export function evaluerCovenants(
  covenants: readonly DefinitionCovenant[],
  ratios: Readonly<Record<CleRatioRedressement, RatioRedressement>> | null,
): ResultatCovenants {
  validerCovenants(covenants);
  let respectes = 0;
  let enDefaut = 0;
  let nonCalculables = 0;
  const evaluations = covenants.map((definition): EvaluationCovenant => {
    const ratio = ratios === null ? undefined : ratios[definition.ratio];
    if (ratio === undefined || ratio.statut !== "calcule" || ratio.valeur === null) {
      nonCalculables += 1;
      return {
        definition,
        statut: "non_calculable",
        valeurPb: null,
        margePb: null,
        raison:
          ratio === undefined
            ? "aucun_etat_accepte"
            : ratio.statut === "calcule"
              ? "ratio_non_calculable"
              : RAISONS_RATIO[ratio.statut],
        manquants: ratio?.manquants ?? [],
      };
    }
    const valeur = BigInt(ratio.valeur);
    const seuil = BigInt(definition.seuilPb);
    const marge = definition.operateur === "min" ? valeur - seuil : seuil - valeur;
    const respecte = marge >= 0n;
    if (respecte) respectes += 1;
    else enDefaut += 1;
    return {
      definition,
      statut: respecte ? "respecte" : "en_defaut",
      valeurPb: ratio.valeur,
      margePb: versNombreSur(marge),
      raison: null,
      manquants: [],
    };
  });
  return {
    evaluations,
    synthese: { nombre: covenants.length, respectes, enDefaut, nonCalculables },
  };
}
