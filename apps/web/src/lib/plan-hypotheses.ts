/**
 * Saisie des hypothèses du modèle financier (PLA-06) : état du formulaire (textes saisis),
 * lecture à la française, contrôles de forme en français et construction du corps attendu par
 * `POST /api/plans/:id/modeles` (et `/simulation`). Logique pure, testée dans
 * `plan-hypotheses.test.ts`.
 *
 * Ces fonctions CONVERTISSENT une saisie (unités usuelles → unités mineures de la devise du
 * plan, « 12,5 » → 12.5) ; elles ne calculent aucun chiffre. Le moteur reste seul juge des
 * bornes : il refuse toute hypothèse hors limites (400 avec un code), jamais corrigée en
 * silence. Conventions du moteur : taux en points (25 pour 25 %), délais en jours d'une année
 * de 360 jours, une hypothèse annuelle vaut une seule valeur ou exactement « horizon » valeurs.
 *
 * L'horizon et la devise ne se saisissent pas : ceux du plan, fixés à sa création, s'imposent.
 *
 * Sous-modules : `plan-hypotheses-saisie` (état du formulaire), `plan-hypotheses-lecture`
 * (contrôles de forme) et `plan-hypotheses-corps` (lecture des blocs).
 */
import { lireNombre, type Resultat } from "./saisie";
import type { EcartsScenarios, HypothesesSaisies } from "./plan-modele";
import {
  COMMENTAIRE_MAX,
  type SaisieHypotheses,
  type SaisieParAnnee,
} from "./plan-hypotheses-saisie";
import { lireParAnnee, lireTaux, type Erreurs } from "./plan-hypotheses-lecture";
import {
  compact,
  lireActivite,
  lireApports,
  lireEcarts,
  lireEffectifs,
  lireEmprunts,
  lireInvestissements,
  lireOuverture,
  type ContexteSaisie,
} from "./plan-hypotheses-corps";

export * from "./plan-hypotheses-saisie";
export {
  MESSAGE_ENTIER,
  MESSAGE_NOMBRE,
  MESSAGE_REQUIS,
  lireMontantSigne,
} from "./plan-hypotheses-lecture";

export interface ChargeHypotheses {
  hypotheses: HypothesesSaisies;
  ecarts: EcartsScenarios;
}

/**
 * Contrôle la forme de la saisie et construit `{ hypotheses, ecarts }`. Clés d'erreur :
 * « caReference », « croissance.2 », « effectifs.0.chargesSociales », « ouverture.capital »…
 */
export function validerHypotheses(
  s: SaisieHypotheses,
  c: ContexteSaisie,
): Resultat<ChargeHypotheses> {
  const err: Erreurs = {};
  const activite = lireActivite(s, err, c);
  const effectifs = lireEffectifs(s, err, c);
  const investissements = lireInvestissements(s, err, c);
  const emprunts = lireEmprunts(s, err, c);
  const apports = lireApports(s, err, c);
  const bornes = { min: 0, max: 720 };
  const jours = (p: SaisieParAnnee, cle: string) =>
    lireParAnnee(
      p,
      cle,
      err,
      c.horizon,
      (v, k, r) => lireTaux(v, k, err, { ...bornes, requis: r }),
      false,
    );
  const reste = {
    delaiClientsJours: jours(s.delaiClients, "delaiClients"),
    delaiFournisseursJours: jours(s.delaiFournisseurs, "delaiFournisseurs"),
    stocksJours: jours(s.stocks, "stocks"),
    tauxImpotSocietes: lireTaux(s.tauxIS, "tauxIS", err, { requis: true, min: 0, max: 100 }),
    tauxDistributionDividendes: lireTaux(s.tauxDividendes, "tauxDividendes", err, {
      min: 0,
      max: 100,
    }),
    tauxActualisation: lireTaux(s.tauxActualisation, "tauxActualisation", err, {
      requis: true,
      min: -100,
      minExclu: true,
      max: 1000,
    }),
  };
  const ouverture = lireOuverture(s, err, c);
  const ecarts = {
    optimiste: lireEcarts(s.optimiste, "optimiste", err),
    pessimiste: lireEcarts(s.pessimiste, "pessimiste", err),
  };
  if (Object.keys(err).length > 0) return { ok: false, erreurs: err };
  const hypotheses = compact({
    ...activite,
    ...(effectifs.length ? { effectifs } : {}),
    ...(investissements.length ? { investissements } : {}),
    ...(emprunts.length ? { emprunts } : {}),
    ...(apports.length ? { augmentationsCapital: apports } : {}),
    ...reste,
    ...(Object.keys(ouverture).length ? { bilanOuverture: ouverture } : {}),
  }) as unknown as HypothesesSaisies;
  return { ok: true, charge: { hypotheses, ecarts } };
}

/** Commentaire facultatif d'une version enregistrée. */
export function validerCommentaire(v: string): Resultat<{ commentaire?: string }, "commentaire"> {
  const t = v.trim();
  if (t.length > COMMENTAIRE_MAX) {
    return { ok: false, erreurs: { commentaire: `${COMMENTAIRE_MAX} caractères au plus.` } };
  }
  return { ok: true, charge: t === "" ? {} : { commentaire: t } };
}

/**
 * Millésimes des années de l'horizon d'après le premier exercice saisi (libellés « Année 1
 * (2027) ») ; null pour chaque année tant que la saisie n'est pas une année valide.
 */
export function exercicesSaisis(premierExercice: string, horizon: number): (number | null)[] {
  const n = lireNombre(premierExercice);
  const valide = n !== null && Number.isInteger(n) && n >= 1900 && n <= 2200;
  return Array.from({ length: horizon }, (_, i) => (valide ? (n as number) + i : null));
}

/** Options d'année du plan (investissement, apport : 1 à l'horizon ; emprunt : dès 0). */
export function optionsAnnees(
  horizon: number,
  exercices: readonly (number | null)[],
  avecOuverture = false,
): { valeur: string; libelle: string }[] {
  const annees = Array.from({ length: horizon }, (_, i) => ({
    valeur: String(i + 1),
    libelle: `Année ${i + 1}${exercices[i] ? ` (${exercices[i]})` : ""}`,
  }));
  return avecOuverture
    ? [{ valeur: "0", libelle: "Année 0 : déjà en cours à l'ouverture" }, ...annees]
    : annees;
}

/** Réunit deux validations : charges fusionnées, ou toutes les erreurs des deux. */
export function fusionnerResultats<A, B>(a: Resultat<A>, b: Resultat<B>): Resultat<A & B> {
  if (a.ok && b.ok) return { ok: true, charge: { ...a.charge, ...b.charge } };
  return { ok: false, erreurs: { ...(a.ok ? {} : a.erreurs), ...(b.ok ? {} : b.erreurs) } };
}

/** Nombre de champs en erreur (annoncé en tête du formulaire). */
export function nombreErreurs(erreurs: Partial<Record<string, string>>): number {
  return Object.values(erreurs).filter(Boolean).length;
}
