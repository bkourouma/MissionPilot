import type { ContexteTenantDemo } from "../contexte.js";
import { CLES_MISSIONS, type Casting, type CleMission } from "./casting.js";
import {
  CORRECTION,
  FACTURATION,
  REMISE_COMMERCIALE,
  type FactureSpec,
} from "./donnees-facturation.js";
import { evenementsDebours } from "./facturation-debours.js";
import { evenementsEcheancier } from "./facturation-echeancier.js";
import {
  echeancesDe,
  evenementsFactures,
  evenementsRegie,
  produireAvoir,
  produireFacture,
} from "./facturation-factures.js";
import { ouvre, type Env, type Evenement } from "./facturation-outils.js";
import {
  evenementsErreurSaisie,
  evenementsPaiements,
  evenementsRelances,
  parametresFinance,
} from "./facturation-paiements.js";
import { bilan, verifierPrevisions, verifierTauxClients } from "./facturation-verif.js";

/*
 * MODULE FACTURATION / ENCAISSEMENTS / DÉBOURS de la phase `gestion` du Tenant démo.
 *
 * Toute l'histoire de facturation est d'abord décrite comme une liste d'ÉVÉNEMENTS DATÉS (échéanciers,
 * débours, factures, avoirs, règlements, relances), puis jouée dans l'ORDRE CHRONOLOGIQUE GLOBAL de
 * toutes les missions : la numérotation continue des factures (une séquence par exercice) croît
 * donc avec les dates d'émission. Tout passe par les vraies routes (gestionnaire prépare, associé
 * approuve, chef ou directeur valide les débours) ; seules l'émission à date fictive et la relance
 * manuelle à date fictive appellent la fonction de domaine, la route n'acceptant pas de date.
 *
 * Idempotent : chaque étape relit l'existant (libellé d'échéance, objet de facture, référence de
 * règlement, niveau de relance) et reprend où elle s'était arrêtée. Une mission déjà clôturée est
 * sautée avec un avertissement. Les missions terminées sont intégralement facturées et encaissées
 * pour passer les contrôles de clôture ; la mission en régie ne facture que le temps VALIDÉ, ce qui
 * dépend du module Temps (sans temps validé, rien n'est facturé pour elle hors débours).
 */

const DATE_PARAMETRES = "2024-11-06";

export async function semerFacturation(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  const debut = Date.now();
  const env: Env = {
    ctx,
    casting,
    rng: ctx.alea.deriver("gestion-facturation"),
    compteurs: {
      echeances: 0,
      debours: 0,
      factures: 0,
      avoirs: 0,
      encaissements: 0,
      relances: 0,
      contrePassations: 0,
    },
  };
  for (const cle of casting.absentes) {
    ctx.journal(`facturation : mission « ${cle} » absente du casting, ignorée.`);
  }

  const actives = new Set<CleMission>();
  for (const cle of CLES_MISSIONS) {
    const m = casting.missions[cle];
    if (!m || !FACTURATION[cle]) continue;
    if (m.statut === "cloturee") {
      ctx.journal(`facturation : ${m.nom} déjà clôturée, sautée.`);
      continue;
    }
    if (!m.dateSignature) continue; // proposition non signée : rien à facturer
    actives.add(cle);
  }

  const evenements: Evenement[] = [
    {
      date: ouvre(env, DATE_PARAMETRES),
      rang: 0,
      cle: "parametres-finance",
      jouer: () => parametresFinance(env, ouvre(env, DATE_PARAMETRES)),
    },
  ];
  const reemissions = [CORRECTION.reemission];

  for (const cle of actives) {
    const m = casting.missions[cle];
    const spec = FACTURATION[cle];
    if (!m || !spec) continue;
    evenements.push(...evenementsEcheancier(env, cle, m, spec));
    evenements.push(...evenementsDebours(env, cle, m, spec.debours));
    evenements.push(...evenementsFactures(env, cle, m, spec.factures, spec.echeances, reemissions));
    evenements.push(...evenementsPaiements(env, cle, m, spec.factures));
    if (m.mode === "regie" && !m.terminee && spec.echeances.length === 0) {
      evenements.push(...evenementsRegie(env, cle, m));
    }
  }

  if (actives.has(REMISE_COMMERCIALE.mission)) evenements.push(...evenementsRemise(env));
  if (actives.has(CORRECTION.mission)) evenements.push(...evenementCorrection(env));
  if (actives.has("baobab-plan")) evenements.push(...evenementsRelances(env));
  if (actives.has("teranga-flash")) evenements.push(...evenementsErreurSaisie(env));

  evenements.sort(
    (a, b) => a.date.localeCompare(b.date) || a.rang - b.rang || a.cle.localeCompare(b.cle),
  );
  ctx.journal(`facturation : ${evenements.length} événements à jouer, du ${evenements[0]?.date}.`);
  for (const e of evenements) {
    try {
      await e.jouer();
    } catch (error) {
      throw new Error(
        `Facturation, événement ${e.date} « ${e.cle} » : ${(error as Error).message}`,
      );
    }
  }

  await verifierTauxClients(env);
  await verifierPrevisions(env);
  await bilan(env);
  const c = env.compteurs;
  ctx.journal(
    `facturation : terminé en ${((Date.now() - debut) / 1000).toFixed(1)} s ` +
      `(échéances ${c.echeances}, débours ${c.debours}, factures ${c.factures}, avoirs ${c.avoirs}, ` +
      `encaissements ${c.encaissements}, relances ${c.relances}, contre-passations ${c.contrePassations}).`,
  );
}

/** Remise commerciale : avoirs sur deux factures non réglées, puis réémission unique remisée. */
function evenementsRemise(env: Env): Evenement[] {
  const R = REMISE_COMMERCIALE;
  const m = env.casting.missions[R.mission];
  const spec = FACTURATION[R.mission];
  if (!m || !spec) return [];
  const date = ouvre(env, R.date);
  const factures = R.annulees
    .map((k) => spec.factures.find((f) => f.cle === k))
    .filter((f): f is FactureSpec => !!f);
  const avoirs = factures.map((f): Evenement => ({
    date,
    rang: 25,
    cle: `${R.mission}|avoir|${f.cle}`,
    jouer: () => produireAvoir(env, R.mission, m, f.objet, R.motif, date),
  }));
  const reemission: Evenement = {
    date,
    rang: 26,
    cle: `${R.mission}|facture|${R.reemission.cle}`,
    jouer: async () => {
      const ids = await echeancesDe(
        env,
        m,
        spec.echeances,
        factures.flatMap((f) => f.echeances),
      );
      if (!ids) throw new Error("Échéances de la réémission introuvables.");
      await produireFacture(env, {
        cle: R.mission,
        m,
        cleFacture: R.reemission.cle,
        objet: R.reemission.objet,
        date,
        etat: "emise",
        echeanceIds: ids,
        avecDebours: false,
        remise: R.pourcentage,
      });
    },
  };
  return [
    ...avoirs,
    reemission,
    ...evenementsPaiements(env, R.mission, m, [
      { cle: R.reemission.cle, date, objet: R.reemission.objet, paiements: R.reemission.paiements },
    ]),
  ];
}

/** Correction : avoir sur la facture de débours à la référence erronée (la réémission est au plan). */
function evenementCorrection(env: Env): Evenement[] {
  const m = env.casting.missions[CORRECTION.mission];
  const spec = FACTURATION[CORRECTION.mission]?.factures.find((f) => f.cle === CORRECTION.facture);
  if (!m || !spec) return [];
  const date = ouvre(env, CORRECTION.date);
  return [
    {
      date,
      rang: 25,
      cle: `${CORRECTION.mission}|avoir|${spec.cle}`,
      jouer: () => produireAvoir(env, CORRECTION.mission, m, spec.objet, CORRECTION.motif, date),
    },
  ];
}
