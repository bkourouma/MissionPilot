/**
 * Bibliothèque de leviers (RED-14) : catalogue FERMÉ de six leviers dont l'impact type est
 * calculé par une fonction pure. Un levier ne dit pas quoi faire : il chiffre un ordre de
 * grandeur à partir du dernier état accepté du client et de paramètres saisis par le
 * consultant. Formules exactes en `BigInt`, UN SEUL arrondi par résultat (demi s'éloignant
 * de zéro) ; jours sur 360. Les bornes des paramètres sont des garde-fous de saisie, pas des
 * valeurs recommandées (SPEC-3a §13).
 */
import { DEVISES, type Devise } from "../finance/monnaie";
import { JOURS_PAR_AN, MONTANT_RED_MAX, PB, quotientArrondi, versNombreSur } from "./commun";
import { ErreurRedressement } from "./erreurs";
import type { PosteRatioRedressement } from "./ratios";

export const VERSION_CATALOGUE_LEVIERS = 1;
export const CODES_LEVIER = [
  "reduction_delai_clients",
  "reduction_stocks",
  "allongement_delai_fournisseurs",
  "reduction_charges_fixes",
  "hausse_prix",
  "cession_actif",
] as const;
export type CodeLevier = (typeof CODES_LEVIER)[number];
export type FamilleLevier = "bfr" | "couts_fixes" | "prix" | "cessions";

export interface ParametreLevier {
  readonly cle: string;
  readonly libelle: string;
  readonly unite: "jours" | "pb" | "mois" | "montant";
  readonly min: number;
  readonly max: number;
}
export interface DefinitionLevier {
  readonly code: CodeLevier;
  readonly famille: FamilleLevier;
  readonly libelle: string;
  readonly description: string;
  /** Postes de l'état accepté dont le calcul a besoin. */
  readonly postesBase: readonly PosteRatioRedressement[];
  readonly parametres: readonly ParametreLevier[];
  /** Phrases françaises affichées avec le résultat. */
  readonly hypotheses: readonly string[];
}

const HYPOTHESE_SECOND_TOUR =
  "Aucun effet de second tour : les leviers ne se cumulent pas mécaniquement.";
const HYPOTHESE_ORDRE_DE_GRANDEUR =
  "Un levier ne dit pas quoi faire : il chiffre un ordre de grandeur.";

const jours = (cle: string): ParametreLevier => ({
  cle,
  libelle: "Jours gagnés",
  unite: "jours",
  min: 1,
  max: 180,
});
const montant = (cle: string, libelle: string): ParametreLevier => ({
  cle,
  libelle,
  unite: "montant",
  min: 0,
  max: MONTANT_RED_MAX,
});

export const CATALOGUE_LEVIERS: readonly DefinitionLevier[] = [
  {
    code: "reduction_delai_clients",
    famille: "bfr",
    libelle: "Réduire le délai de paiement des clients",
    description:
      "Liquidités dégagées une fois en raccourcissant le délai moyen d'encaissement des clients.",
    postesBase: ["chiffre_affaires"],
    parametres: [jours("joursGagnes")],
    hypotheses: [
      "Le chiffre d'affaires annuel de l'état accepté est réparti uniformément sur 360 jours.",
      HYPOTHESE_SECOND_TOUR,
      HYPOTHESE_ORDRE_DE_GRANDEUR,
    ],
  },
  {
    code: "reduction_stocks",
    famille: "bfr",
    libelle: "Réduire les stocks",
    description: "Liquidités dégagées une fois en réduisant une part des stocks.",
    postesBase: ["stocks"],
    parametres: [
      { cle: "reductionPb", libelle: "Réduction des stocks", unite: "pb", min: 1, max: 10_000 },
    ],
    hypotheses: [
      "Les stocks de l'état accepté sont réduits sans effet sur l'activité.",
      HYPOTHESE_SECOND_TOUR,
      HYPOTHESE_ORDRE_DE_GRANDEUR,
    ],
  },
  {
    code: "allongement_delai_fournisseurs",
    famille: "bfr",
    libelle: "Allonger le délai de paiement des fournisseurs",
    description:
      "Liquidités dégagées une fois en allongeant le délai moyen de paiement des fournisseurs.",
    postesBase: ["cout_ventes"],
    parametres: [jours("joursGagnes")],
    hypotheses: [
      "L'achat annuel est assimilé au coût des ventes de l'état accepté.",
      HYPOTHESE_SECOND_TOUR,
      HYPOTHESE_ORDRE_DE_GRANDEUR,
    ],
  },
  {
    code: "reduction_charges_fixes",
    famille: "couts_fixes",
    libelle: "Réduire les charges fixes",
    description:
      "Gain annuel récurrent en réduisant une part des charges fixes, et effet sur la première année.",
    postesBase: [],
    parametres: [
      montant("chargesFixesAnnuelles", "Charges fixes annuelles"),
      {
        cle: "reductionPb",
        libelle: "Réduction des charges fixes",
        unite: "pb",
        min: 1,
        max: 10_000,
      },
      { cle: "moisMiseEnOeuvre", libelle: "Mois de mise en œuvre", unite: "mois", min: 0, max: 12 },
    ],
    hypotheses: [
      "Les charges fixes indiquées sont celles du client, saisies par le consultant.",
      HYPOTHESE_SECOND_TOUR,
      HYPOTHESE_ORDRE_DE_GRANDEUR,
    ],
  },
  {
    code: "hausse_prix",
    famille: "prix",
    libelle: "Augmenter les prix",
    description: "Gain annuel d'une hausse des prix de vente, net d'une perte de volume.",
    postesBase: ["chiffre_affaires", "cout_ventes"],
    parametres: [
      { cle: "hausseParPb", libelle: "Hausse des prix", unite: "pb", min: 1, max: 5_000 },
      { cle: "perteVolumePb", libelle: "Perte de volume", unite: "pb", min: 0, max: 9_999 },
    ],
    hypotheses: [
      "Le coût des ventes varie avec le volume vendu.",
      HYPOTHESE_SECOND_TOUR,
      HYPOTHESE_ORDRE_DE_GRANDEUR,
    ],
  },
  {
    code: "cession_actif",
    famille: "cessions",
    libelle: "Céder un actif",
    description: "Liquidités dégagées une fois par la cession d'un actif, et plus ou moins-value.",
    postesBase: [],
    parametres: [
      montant("prixCession", "Prix de cession"),
      montant("valeurComptableNette", "Valeur comptable nette"),
      montant("fraisEtImpots", "Frais et impôts de cession"),
    ],
    hypotheses: [
      "Le prix, la valeur comptable et les frais sont ceux saisis par le consultant.",
      HYPOTHESE_SECOND_TOUR,
      HYPOTHESE_ORDRE_DE_GRANDEUR,
    ],
  },
];

export interface ParametresParLevier {
  reduction_delai_clients: { joursGagnes: number };
  reduction_stocks: { reductionPb: number };
  allongement_delai_fournisseurs: { joursGagnes: number };
  reduction_charges_fixes: {
    chargesFixesAnnuelles: number;
    reductionPb: number;
    moisMiseEnOeuvre: number;
  };
  hausse_prix: { hausseParPb: number; perteVolumePb: number };
  cession_actif: { prixCession: number; valeurComptableNette: number; fraisEtImpots: number };
}
export interface BaseLevier {
  readonly devise: Devise;
  /** Postes agrégés du dernier état accepté. */
  readonly postes: Readonly<Partial<Record<PosteRatioRedressement, number>>>;
}
export interface ImpactLevier {
  readonly code: CodeLevier;
  readonly devise: Devise;
  /** Liquidités dégagées une fois (BFR, cession). */
  readonly tresorerieUnique: number;
  /** Gain annuel récurrent (charges fixes, prix). */
  readonly resultatAnnuel: number;
  /** Effet de trésorerie sur la première année. */
  readonly tresorerieAnnee1: number;
  /** Cession seulement. */
  readonly plusOuMoinsValue: number | null;
  /** Postes effectivement utilisés. */
  readonly base: Readonly<Partial<Record<PosteRatioRedressement, number>>>;
  readonly hypotheses: readonly string[];
  readonly versionCatalogue: number;
}

const DOUZE = 12n;

/** Valide les paramètres d'un levier contre sa définition (bornes, entiers, clés exactes). */
function validerParametres(definition: DefinitionLevier, parametres: Record<string, number>): void {
  const invalide = (message: string, cle: string): never => {
    throw new ErreurRedressement("PARAMETRES_LEVIER_INVALIDES", message, [cle]);
  };
  if (typeof parametres !== "object" || parametres === null) {
    return invalide("Paramètres de levier absents.", "parametres");
  }
  for (const cle of Object.keys(parametres)) {
    if (!definition.parametres.some((p) => p.cle === cle)) {
      return invalide("Paramètre inconnu pour ce levier.", cle);
    }
  }
  for (const p of definition.parametres) {
    const valeur: unknown = parametres[p.cle];
    if (typeof valeur !== "number" || !Number.isSafeInteger(valeur)) {
      return invalide("Paramètre entier attendu.", p.cle);
    }
    if (valeur < p.min || valeur > p.max) return invalide("Paramètre hors des bornes.", p.cle);
  }
  if (
    definition.code === "cession_actif" &&
    (parametres.fraisEtImpots as number) > (parametres.prixCession as number)
  ) {
    invalide("Les frais et impôts ne dépassent pas le prix de cession.", "fraisEtImpots");
  }
}

/** Impact type d'un levier, calculé par le moteur (jamais par un modèle de langage). */
export function calculerImpactLevier<C extends CodeLevier>(
  code: C,
  parametres: ParametresParLevier[C],
  base: BaseLevier,
): ImpactLevier {
  const definition = CATALOGUE_LEVIERS.find((d) => d.code === code);
  if (definition === undefined) {
    throw new ErreurRedressement("LEVIER_INCONNU", "Levier inconnu.");
  }
  validerParametres(definition, parametres as Record<string, number>);
  if (typeof base?.devise !== "string" || !(DEVISES as readonly string[]).includes(base.devise)) {
    throw new ErreurRedressement("BASE_INCOMPLETE", "Devise de la base absente.", ["devise"]);
  }
  const absents = definition.postesBase.filter((poste) => {
    const valeur = base.postes[poste];
    return typeof valeur !== "number" || !Number.isSafeInteger(valeur);
  });
  if (absents.length > 0) {
    throw new ErreurRedressement("BASE_INCOMPLETE", "Postes de base à renseigner.", absents);
  }
  const poste = (nom: PosteRatioRedressement): bigint => BigInt(base.postes[nom] as number);
  const utilises = Object.fromEntries(
    definition.postesBase.map((nom) => [nom, base.postes[nom] as number]),
  ) as Partial<Record<PosteRatioRedressement, number>>;
  const p = parametres as unknown as Record<string, number>;
  const entier = (cle: string): bigint => BigInt(p[cle] as number);

  let tresorerieUnique = 0n;
  let resultatAnnuel = 0n;
  let tresorerieAnnee1 = 0n;
  let plusOuMoinsValue: bigint | null = null;

  switch (code as CodeLevier) {
    case "reduction_delai_clients":
      tresorerieUnique = quotientArrondi(
        poste("chiffre_affaires") * entier("joursGagnes"),
        JOURS_PAR_AN,
      );
      tresorerieAnnee1 = tresorerieUnique;
      break;
    case "reduction_stocks":
      tresorerieUnique = quotientArrondi(poste("stocks") * entier("reductionPb"), PB);
      tresorerieAnnee1 = tresorerieUnique;
      break;
    case "allongement_delai_fournisseurs":
      tresorerieUnique = quotientArrondi(
        poste("cout_ventes") * entier("joursGagnes"),
        JOURS_PAR_AN,
      );
      tresorerieAnnee1 = tresorerieUnique;
      break;
    case "reduction_charges_fixes": {
      const produit = entier("chargesFixesAnnuelles") * entier("reductionPb");
      resultatAnnuel = quotientArrondi(produit, PB);
      // Un seul arrondi : la fraction exacte de l'année 1, pas le résultat annuel déjà arrondi.
      tresorerieAnnee1 = quotientArrondi(
        produit * (DOUZE - entier("moisMiseEnOeuvre")),
        PB * DOUZE,
      );
      break;
    }
    case "hausse_prix": {
      // (1 − v) × (CA × (1 + p) − CV) − (CA − CV), v et p en fraction (pb / 10 000).
      const ca = poste("chiffre_affaires");
      const cv = poste("cout_ventes");
      const apresHausse = ca * (PB + entier("hausseParPb")) - cv * PB;
      const numerateur = (PB - entier("perteVolumePb")) * apresHausse - (ca - cv) * PB * PB;
      resultatAnnuel = quotientArrondi(numerateur, PB * PB);
      tresorerieAnnee1 = resultatAnnuel;
      break;
    }
    case "cession_actif":
      tresorerieUnique = entier("prixCession") - entier("fraisEtImpots");
      tresorerieAnnee1 = tresorerieUnique;
      plusOuMoinsValue = entier("prixCession") - entier("valeurComptableNette");
      break;
  }

  return {
    code,
    devise: base.devise,
    tresorerieUnique: versNombreSur(tresorerieUnique),
    resultatAnnuel: versNombreSur(resultatAnnuel),
    tresorerieAnnee1: versNombreSur(tresorerieAnnee1),
    plusOuMoinsValue: plusOuMoinsValue === null ? null : versNombreSur(plusOuMoinsValue),
    base: utilises,
    hypotheses: definition.hypotheses,
    versionCatalogue: VERSION_CATALOGUE_LEVIERS,
  };
}
