/** Saisie des hypothèses : lecture des blocs de la saisie pour construire le corps. */
import type { Devise } from "./format";
import type { EcartsScenario } from "./plan-modele";
import {
  type Erreurs,
  lireEntier,
  lireLibelle,
  lireMontantChamp,
  lireParAnnee,
  lireTaux,
  type BornesTaux,
} from "./plan-hypotheses-lecture";
import {
  APPORTS_MAX,
  CHAMPS_OUVERTURE,
  CLES_OUVERTURE,
  EFFECTIFS_MAX,
  EMPRUNTS_MAX,
  INVESTISSEMENTS_MAX,
  type CleOuverture,
  type SaisieEcarts,
  type SaisieHypotheses,
} from "./plan-hypotheses-saisie";

export interface ContexteSaisie {
  horizon: number;
  devise: Devise;
}

export function lireActivite(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  const taux = (b: BornesTaux) => (v: string, cle: string, requis: boolean) =>
    lireTaux(v, cle, err, { ...b, requis });
  const montant = (v: string, cle: string, requis: boolean) =>
    lireMontantChamp(v, cle, err, c.devise, { requis });
  return {
    premierExercice: lireEntier(s.premierExercice, "premierExercice", err, {
      requis: true,
      min: 1900,
      max: 2200,
    }),
    chiffreAffairesReference: lireMontantChamp(s.caReference, "caReference", err, c.devise, {
      requis: true,
    }),
    croissanceChiffreAffaires: lireParAnnee(
      s.croissance,
      "croissance",
      err,
      c.horizon,
      taux({ min: -100, minExclu: true, max: 1000 }),
      true,
    ),
    tauxMargeBrute: lireParAnnee(
      s.marge,
      "marge",
      err,
      c.horizon,
      taux({ min: 0, max: 100 }),
      true,
    ),
    tauxChargesVariables: lireParAnnee(
      s.variables,
      "variables",
      err,
      c.horizon,
      taux({ min: 0, max: 100 }),
      false,
    ),
    chargesFixes: lireParAnnee(s.fixes, "fixes", err, c.horizon, montant, false),
  };
}

export function lireEffectifs(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.effectifs.length > EFFECTIFS_MAX) err.effectifs = `${EFFECTIFS_MAX} catégories au plus.`;
  return s.effectifs.map((e, i) => {
    const k = `effectifs.${i}`;
    const revalorisation = lireTaux(e.revalorisation, `${k}.revalorisation`, err, {
      min: -100,
      minExclu: true,
      max: 100,
    });
    return {
      libelle: lireLibelle(e.libelle, `${k}.libelle`, err),
      effectifs: lireParAnnee(
        e.effectifs,
        `${k}.effectifs`,
        err,
        c.horizon,
        (v, cle, requis) => lireTaux(v, cle, err, { requis, min: 0, max: 1_000_000 }),
        true,
      ),
      salaireAnnuelBrut: lireMontantChamp(e.salaire, `${k}.salaire`, err, c.devise, {
        requis: true,
      }),
      // Obligatoire : un coût du personnel sans charges sociales serait sous-estimé.
      tauxChargesSociales: lireTaux(e.chargesSociales, `${k}.chargesSociales`, err, {
        requis: true,
        min: 0,
        max: 100,
      }),
      ...(revalorisation === undefined ? {} : { revalorisationAnnuelle: revalorisation }),
    };
  });
}

export function lireInvestissements(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.investissements.length > INVESTISSEMENTS_MAX) {
    err.investissements = `${INVESTISSEMENTS_MAX} investissements au plus.`;
  }
  return s.investissements.map((x, i) => {
    const k = `investissements.${i}`;
    return {
      libelle: lireLibelle(x.libelle, `${k}.libelle`, err),
      annee: lireEntier(x.annee, `${k}.annee`, err, { requis: true, min: 1, max: c.horizon }),
      montant: lireMontantChamp(x.montant, `${k}.montant`, err, c.devise, {
        requis: true,
        strict: true,
      }),
      dureeAmortissement: lireEntier(x.duree, `${k}.duree`, err, {
        requis: true,
        min: 1,
        max: 100,
      }),
    };
  });
}

export function lireEmprunts(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.emprunts.length > EMPRUNTS_MAX) err.emprunts = `${EMPRUNTS_MAX} emprunts au plus.`;
  return s.emprunts.map((x, i) => {
    const k = `emprunts.${i}`;
    const duree = lireEntier(x.duree, `${k}.duree`, err, { requis: true, min: 1, max: 50 });
    const differe = lireEntier(x.differe, `${k}.differe`, err, { min: 0, max: 49 });
    if (differe !== undefined && duree !== undefined && differe >= duree) {
      err[`${k}.differe`] = "Le différé doit rester inférieur à la durée de l'emprunt.";
    }
    return {
      libelle: lireLibelle(x.libelle, `${k}.libelle`, err),
      anneeDeblocage: lireEntier(x.annee, `${k}.annee`, err, {
        requis: true,
        min: 0,
        max: c.horizon,
      }),
      montant: lireMontantChamp(x.montant, `${k}.montant`, err, c.devise, {
        requis: true,
        strict: true,
      }),
      tauxAnnuel: lireTaux(x.taux, `${k}.taux`, err, { requis: true, min: 0, max: 100 }),
      duree,
      ...(differe === undefined ? {} : { differe }),
      mode: x.mode,
    };
  });
}

export function lireApports(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  if (s.apports.length > APPORTS_MAX) err.apports = `${APPORTS_MAX} augmentations au plus.`;
  return s.apports.map((x, i) => ({
    annee: lireEntier(x.annee, `apports.${i}.annee`, err, { requis: true, min: 1, max: c.horizon }),
    montant: lireMontantChamp(x.montant, `apports.${i}.montant`, err, c.devise, {
      requis: true,
      strict: true,
    }),
  }));
}

export function lireOuverture(s: SaisieHypotheses, err: Erreurs, c: ContexteSaisie) {
  const o: Partial<Record<CleOuverture, number>> = {};
  for (const k of CLES_OUVERTURE) {
    const cle = `ouverture.${k}`;
    const nature = CHAMPS_OUVERTURE[k].nature;
    const v =
      nature === "duree"
        ? lireEntier(s.ouverture[k], cle, err, { min: 1, max: 100 })
        : lireMontantChamp(s.ouverture[k], cle, err, c.devise, { signe: nature !== "montant" });
    if (v !== undefined) o[k] = v;
  }
  return o;
}

export function lireEcarts(e: SaisieEcarts, prefixe: string, err: Erreurs): EcartsScenario {
  const lire = (v: string, cle: string, b: BornesTaux = {}) =>
    lireTaux(v, `${prefixe}.${cle}`, err, b);
  const r: EcartsScenario = {
    croissanceChiffreAffaires: lire(e.croissance, "croissance"),
    tauxMargeBrute: lire(e.marge, "marge"),
    tauxChargesVariables: lire(e.variables, "variables"),
    chargesFixes: lire(e.fixes, "fixes", { min: -100, minExclu: true }),
    delaiClientsJours: lire(e.delaiClients, "delaiClients"),
  };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as EcartsScenario;
}

/** Retire les clés indéfinies (facultatives non saisies) d'un objet. */
export function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
