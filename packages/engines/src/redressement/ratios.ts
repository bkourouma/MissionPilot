/**
 * Ratios clés d'un état financier du client (RED-02) par correspondance de postes.
 *
 * Une ligne d'état du dossier client n'a ni nature ni classement : son code est celui du
 * plan comptable du client. Le consultant renseigne donc une correspondance versionnée
 * « poste de ratio ← codes de lignes ». Un poste non renseigné rend le ratio « non
 * calculable » : il n'est JAMAIS compté pour zéro. Un poste « sans objet » vaut 0.
 *
 * Conventions de `plan-strategique/bancabilite.ts` : points de base (10 000 = 1), BFR en
 * jours entiers sur 360, division arrondie demi s'éloignant de zéro, sommes en `BigInt`.
 */
import type { Devise } from "../finance/monnaie";
import { REFERENCES_SYSCOHADA } from "../plan-strategique/modele";
import {
  JOURS_PAR_AN,
  exigerEntier,
  quotientArrondi,
  rapportPb,
  somme,
  versNombreSur,
} from "./commun";
import { ErreurRedressement } from "./erreurs";

export const POSTES_RATIO_REDRESSEMENT = [
  "stocks",
  "creances_clients",
  "autres_creances",
  "tresorerie_actif",
  "capital",
  "capitaux_propres",
  "dettes_financieres",
  "dettes_fournisseurs",
  "dettes_court_terme",
  "chiffre_affaires",
  "cout_ventes",
  "resultat_exploitation",
  "charges_financieres",
  "resultat_net",
] as const;
export type PosteRatioRedressement = (typeof POSTES_RATIO_REDRESSEMENT)[number];

export interface AffectationPoste {
  /** Codes de lignes de l'état du client ; vide si `sansObjet`. */
  readonly codes: readonly string[];
  /** Le poste n'existe pas chez ce client : il vaut 0, jamais « manquant ». */
  readonly sansObjet: boolean;
}
export type CorrespondancePostes = Readonly<
  Partial<Record<PosteRatioRedressement, AffectationPoste>>
>;

export interface EtatPourRatios {
  /** Entier 1990..2100. */
  readonly exercice: number;
  readonly devise: Devise;
  /** |montant| ≤ 10^15. */
  readonly lignes: readonly { readonly code: string; readonly montant: number }[];
  /** `totaux.actif` de l'état contrôlé. */
  readonly totalActif: number | null;
  /** `totaux.passif`. */
  readonly totalPassif: number | null;
  /** `totaux.resultat` (net déclaré, sinon produits − charges). */
  readonly resultatNet: number | null;
}

const FORMAT_CODE = /^[A-Za-z0-9_.-]{1,40}$/;
const CODES_PAR_POSTE_MAX = 50;
const MONTANT_ETAT_MAX = 1_000_000_000_000_000;

const estPoste = (cle: string): cle is PosteRatioRedressement =>
  (POSTES_RATIO_REDRESSEMENT as readonly string[]).includes(cle);

/** Valide une correspondance : `POSTE_INCONNU` ou `CORRESPONDANCE_INVALIDE`. */
export function validerCorrespondance(c: CorrespondancePostes): void {
  for (const cle of Object.keys(c)) {
    if (!estPoste(cle)) {
      throw new ErreurRedressement("POSTE_INCONNU", "Poste inconnu dans la correspondance.", [cle]);
    }
    const affectation = c[cle];
    const invalide = (message: string): never => {
      throw new ErreurRedressement("CORRESPONDANCE_INVALIDE", message, [cle]);
    };
    if (
      !affectation ||
      !Array.isArray(affectation.codes) ||
      typeof affectation.sansObjet !== "boolean"
    ) {
      return invalide("Affectation de poste mal formée.");
    }
    if (affectation.codes.length > CODES_PAR_POSTE_MAX) {
      return invalide("Trop de codes pour un même poste (50 au plus).");
    }
    if (affectation.codes.some((code) => typeof code !== "string" || !FORMAT_CODE.test(code))) {
      return invalide("Code de ligne invalide.");
    }
    if (new Set(affectation.codes).size !== affectation.codes.length) {
      return invalide("Un code figure deux fois dans le même poste.");
    }
    if (affectation.sansObjet && affectation.codes.length > 0) {
      return invalide("Un poste sans objet ne porte aucun code.");
    }
    if (!affectation.sansObjet && affectation.codes.length === 0) {
      return invalide("Un poste porte au moins un code, ou est déclaré sans objet.");
    }
  }
}

/** Proposition indicative, bâtie sur REFERENCES_SYSCOHADA : « à confirmer par un expert-comptable ». */
export const CORRESPONDANCE_SYSCOHADA_INDICATIVE: CorrespondancePostes = {
  stocks: { codes: [REFERENCES_SYSCOHADA.bilan.stocks], sansObjet: false },
  creances_clients: { codes: [REFERENCES_SYSCOHADA.bilan.creancesClients], sansObjet: false },
  tresorerie_actif: { codes: [REFERENCES_SYSCOHADA.bilan.tresorerieActif], sansObjet: false },
  capital: { codes: [REFERENCES_SYSCOHADA.bilan.capital], sansObjet: false },
  capitaux_propres: { codes: [REFERENCES_SYSCOHADA.bilan.capitauxPropres], sansObjet: false },
  dettes_financieres: { codes: [REFERENCES_SYSCOHADA.bilan.dettesFinancieres], sansObjet: false },
  dettes_fournisseurs: {
    codes: [REFERENCES_SYSCOHADA.bilan.dettesFournisseurs],
    sansObjet: false,
  },
  chiffre_affaires: {
    codes: [REFERENCES_SYSCOHADA.compteResultat.chiffreAffaires],
    sansObjet: false,
  },
  resultat_exploitation: {
    codes: [REFERENCES_SYSCOHADA.compteResultat.resultatExploitation],
    sansObjet: false,
  },
  resultat_net: { codes: [REFERENCES_SYSCOHADA.compteResultat.resultatNet], sansObjet: false },
};

export interface PostesAgreges {
  readonly valeurs: Readonly<Partial<Record<PosteRatioRedressement, number>>>;
  /** Dans l'ordre de POSTES_RATIO_REDRESSEMENT. */
  readonly manquants: readonly PosteRatioRedressement[];
}

function validerEtat(etat: EtatPourRatios): Map<string, number> {
  exigerEntier(etat.exercice, 1990, 2100, "ETAT_INVALIDE", "Exercice");
  const montants = new Map<string, number>();
  for (const ligne of etat.lignes) {
    if (typeof ligne.code !== "string" || ligne.code === "") {
      throw new ErreurRedressement("ETAT_INVALIDE", "Ligne d'état sans code.");
    }
    exigerEntier(
      ligne.montant,
      -MONTANT_ETAT_MAX,
      MONTANT_ETAT_MAX,
      "MONTANT_INVALIDE",
      "Montant d'une ligne d'état",
    );
    if (montants.has(ligne.code)) {
      throw new ErreurRedressement(
        "ETAT_INVALIDE",
        "Un code de ligne figure deux fois dans l'état.",
      );
    }
    montants.set(ligne.code, ligne.montant);
  }
  for (const [nom, total] of [
    ["Total actif", etat.totalActif],
    ["Total passif", etat.totalPassif],
    ["Résultat net", etat.resultatNet],
  ] as const) {
    if (total !== null) {
      exigerEntier(total, -MONTANT_ETAT_MAX, MONTANT_ETAT_MAX, "MONTANT_INVALIDE", nom);
    }
  }
  return montants;
}

/** Agrège les postes d'un état selon la correspondance. */
export function agregerPostes(
  etat: EtatPourRatios,
  correspondance: CorrespondancePostes,
): PostesAgreges {
  validerCorrespondance(correspondance);
  const montants = validerEtat(etat);
  const valeurs: Partial<Record<PosteRatioRedressement, number>> = {};
  const manquants: PosteRatioRedressement[] = [];
  for (const poste of POSTES_RATIO_REDRESSEMENT) {
    const affectation = correspondance[poste];
    if (affectation === undefined) {
      if (poste === "resultat_net" && etat.resultatNet !== null) {
        valeurs[poste] = etat.resultatNet;
      } else {
        manquants.push(poste);
      }
      continue;
    }
    if (affectation.sansObjet) {
      valeurs[poste] = 0;
      continue;
    }
    if (affectation.codes.some((code) => !montants.has(code))) {
      manquants.push(poste);
      continue;
    }
    valeurs[poste] = versNombreSur(
      somme(affectation.codes.map((code) => BigInt(montants.get(code) as number))),
    );
  }
  return { valeurs, manquants };
}

export const CLES_RATIO_REDRESSEMENT = [
  "liquidite_generale",
  "liquidite_reduite",
  "liquidite_immediate",
  "autonomie_financiere",
  "solvabilite_generale",
  "endettement",
  "marge_brute",
  "marge_nette",
  "couverture_charges_financieres",
  "bfr_jours",
] as const;
export type CleRatioRedressement = (typeof CLES_RATIO_REDRESSEMENT)[number];

export type StatutRatioRedressement =
  "calcule" | "sans_objet" | "non_calculable" | "non_significatif";
export type RaisonRatioRedressement =
  | "postes_manquants"
  | "totaux_absents"
  | "denominateur_non_positif"
  | "sans_dette"
  | "sans_charges_financieres";

export interface RatioRedressement {
  /** Points de base (BFR : jours) ; null sauf statut « calcule ». */
  readonly valeur: number | null;
  readonly statut: StatutRatioRedressement;
  readonly raison: RaisonRatioRedressement | null;
  /** Non vide seulement si raison = postes_manquants. */
  readonly manquants: readonly PosteRatioRedressement[];
}
export interface RatiosExercice {
  readonly exercice: number;
  readonly devise: Devise;
  readonly postes: Readonly<Partial<Record<PosteRatioRedressement, number>>>;
  readonly ratios: Readonly<Record<CleRatioRedressement, RatioRedressement>>;
}

const calcule = (valeur: number): RatioRedressement => ({
  valeur,
  statut: "calcule",
  raison: null,
  manquants: [],
});
const constat = (
  statut: Exclude<StatutRatioRedressement, "calcule">,
  raison: RaisonRatioRedressement,
  manquants: readonly PosteRatioRedressement[] = [],
): RatioRedressement => ({ valeur: null, statut, raison, manquants });

/** Contexte de calcul : postes agrégés (BigInt) et totaux. */
interface Contexte {
  readonly p: Readonly<Partial<Record<PosteRatioRedressement, bigint>>>;
  readonly totalActif: bigint | null;
  readonly totalPassif: bigint | null;
}

const manquantsParmi = (
  ctx: Contexte,
  requis: readonly PosteRatioRedressement[],
): PosteRatioRedressement[] => requis.filter((poste) => ctx.p[poste] === undefined);

/** Calcule un ratio : vérifie les postes requis, puis délègue au calcul. */
function avecPostes(
  ctx: Contexte,
  requis: readonly PosteRatioRedressement[],
  calcul: (v: Record<PosteRatioRedressement, bigint>) => RatioRedressement,
): RatioRedressement {
  const absents = manquantsParmi(ctx, requis);
  if (absents.length > 0) return constat("non_calculable", "postes_manquants", absents);
  return calcul(ctx.p as Record<PosteRatioRedressement, bigint>);
}

function liquidite(
  ctx: Contexte,
  requis: readonly PosteRatioRedressement[],
  numerateur: (v: Record<PosteRatioRedressement, bigint>) => bigint,
): RatioRedressement {
  return avecPostes(ctx, requis, (v) => {
    const dettes = v.dettes_court_terme;
    if (dettes === 0n) return constat("sans_objet", "sans_dette");
    if (dettes < 0n) return constat("non_calculable", "denominateur_non_positif");
    return calcule(rapportPb(numerateur(v), dettes));
  });
}

function ratiosDe(ctx: Contexte): Record<CleRatioRedressement, RatioRedressement> {
  const { totalActif, totalPassif } = ctx;
  return {
    liquidite_generale: liquidite(
      ctx,
      ["stocks", "creances_clients", "autres_creances", "tresorerie_actif", "dettes_court_terme"],
      (v) => v.stocks + v.creances_clients + v.autres_creances + v.tresorerie_actif,
    ),
    liquidite_reduite: liquidite(
      ctx,
      ["creances_clients", "autres_creances", "tresorerie_actif", "dettes_court_terme"],
      (v) => v.creances_clients + v.autres_creances + v.tresorerie_actif,
    ),
    liquidite_immediate: liquidite(
      ctx,
      ["tresorerie_actif", "dettes_court_terme"],
      (v) => v.tresorerie_actif,
    ),
    autonomie_financiere: avecPostes(ctx, ["capitaux_propres"], (v) => {
      if (totalPassif === null) return constat("non_calculable", "totaux_absents");
      if (totalPassif <= 0n) return constat("non_calculable", "denominateur_non_positif");
      return calcule(rapportPb(v.capitaux_propres, totalPassif));
    }),
    solvabilite_generale: avecPostes(ctx, ["capitaux_propres"], (v) => {
      if (totalActif === null || totalPassif === null) {
        return constat("non_calculable", "totaux_absents");
      }
      const dettes = totalPassif - v.capitaux_propres;
      if (dettes <= 0n) return constat("sans_objet", "sans_dette");
      return calcule(rapportPb(totalActif, dettes));
    }),
    endettement: avecPostes(ctx, ["dettes_financieres", "capitaux_propres"], (v) => {
      if (v.capitaux_propres <= 0n) return constat("non_significatif", "denominateur_non_positif");
      return calcule(rapportPb(v.dettes_financieres, v.capitaux_propres));
    }),
    marge_brute: avecPostes(ctx, ["chiffre_affaires", "cout_ventes"], (v) => {
      if (v.chiffre_affaires <= 0n) return constat("non_calculable", "denominateur_non_positif");
      return calcule(rapportPb(v.chiffre_affaires - v.cout_ventes, v.chiffre_affaires));
    }),
    marge_nette: avecPostes(ctx, ["chiffre_affaires", "resultat_net"], (v) => {
      if (v.chiffre_affaires <= 0n) return constat("non_calculable", "denominateur_non_positif");
      return calcule(rapportPb(v.resultat_net, v.chiffre_affaires));
    }),
    couverture_charges_financieres: avecPostes(
      ctx,
      ["resultat_exploitation", "charges_financieres"],
      (v) => {
        if (v.charges_financieres === 0n) return constat("sans_objet", "sans_charges_financieres");
        if (v.charges_financieres < 0n) {
          return constat("non_calculable", "denominateur_non_positif");
        }
        return calcule(rapportPb(v.resultat_exploitation, v.charges_financieres));
      },
    ),
    bfr_jours: avecPostes(
      ctx,
      ["stocks", "creances_clients", "dettes_fournisseurs", "chiffre_affaires"],
      (v) => {
        if (v.chiffre_affaires <= 0n) return constat("non_calculable", "denominateur_non_positif");
        const bfr = v.stocks + v.creances_clients - v.dettes_fournisseurs;
        return calcule(versNombreSur(quotientArrondi(bfr * JOURS_PAR_AN, v.chiffre_affaires)));
      },
    ),
  };
}

/** Ratios d'un exercice, depuis l'état du client et la correspondance de postes. */
export function calculerRatiosRedressement(
  etat: EtatPourRatios,
  correspondance: CorrespondancePostes,
): RatiosExercice {
  const { valeurs } = agregerPostes(etat, correspondance);
  const p: Partial<Record<PosteRatioRedressement, bigint>> = {};
  for (const poste of POSTES_RATIO_REDRESSEMENT) {
    const valeur = valeurs[poste];
    if (valeur !== undefined) p[poste] = BigInt(valeur);
  }
  const ctx: Contexte = {
    p,
    totalActif: etat.totalActif === null ? null : BigInt(etat.totalActif),
    totalPassif: etat.totalPassif === null ? null : BigInt(etat.totalPassif),
  };
  return { exercice: etat.exercice, devise: etat.devise, postes: valeurs, ratios: ratiosDe(ctx) };
}

export type RaisonTendance = "devises_differentes" | "exercice_precedent_absent";
export interface TendancesRedressement {
  /** (CA − CA précédent) / CA précédent, pb. */
  readonly croissanceCaPb: number | null;
  /** Marge brute − marge brute précédente, pb (différence des valeurs rendues). */
  readonly variationMargeBrutePb: number | null;
  readonly raison: RaisonTendance | null;
}

/** Tendances entre l'exercice courant et l'exercice immédiatement précédent. */
export function calculerTendancesRedressement(
  courant: RatiosExercice,
  precedent: RatiosExercice | null,
): TendancesRedressement {
  if (precedent === null || precedent.exercice !== courant.exercice - 1) {
    return {
      croissanceCaPb: null,
      variationMargeBrutePb: null,
      raison: "exercice_precedent_absent",
    };
  }
  if (precedent.devise !== courant.devise) {
    return { croissanceCaPb: null, variationMargeBrutePb: null, raison: "devises_differentes" };
  }
  const ca = courant.postes.chiffre_affaires;
  const caPrecedent = precedent.postes.chiffre_affaires;
  const croissanceCaPb =
    ca === undefined || caPrecedent === undefined || caPrecedent <= 0
      ? null
      : rapportPb(BigInt(ca) - BigInt(caPrecedent), BigInt(caPrecedent));
  const marge = courant.ratios.marge_brute;
  const margePrecedente = precedent.ratios.marge_brute;
  const variationMargeBrutePb =
    marge.statut === "calcule" &&
    margePrecedente.statut === "calcule" &&
    marge.valeur !== null &&
    margePrecedente.valeur !== null
      ? marge.valeur - margePrecedente.valeur
      : null;
  return { croissanceCaPb, variationMargeBrutePb, raison: null };
}
