import {
  CLES_COMPTES,
  CLES_JOURNAUX,
  type CleCompte,
  type CleJournal,
  type PlanComptableSaisie,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";

/*
 * Plan comptable de l'export (FIN-13). VALEURS DE DÉPART SYSCOHADA révisé,
 * à faire valider par un expert-comptable du cabinet (`valeurs_validees`) :
 * - 411 Clients ; 4191 Clients, avances et acomptes reçus (trop-perçu
 *   accepté en avance) ;
 * - 706 Services vendus (prestations) ; 707 Marchandises / produits
 *   accessoires pour les débours refacturés (à confirmer : certains cabinets
 *   les portent en 706 ou 7071) ;
 * - 4431 État, TVA facturée sur ventes ; 4492 État, avances et acomptes
 *   versés sur impôts (retenues à la source subies, à confirmer selon le pays) ;
 * - 521 Banques locales (virements) ; 513 Chèques à encaisser ; 571 Caisse
 *   (espèces) ; 552 Instruments de monnaie électronique – téléphone portable
 *   (Mobile Money, classe 55 du SYSCOHADA révisé ; le compte 58 « virements
 *   internes » ne convient pas à un solde de porte-monnaie).
 * Journaux : VE ventes, BQ banque, CA caisse, MM mobile money, OD opérations diverses.
 */

export const COMPTES_DEPART: Readonly<Record<CleCompte, string>> = {
  clients: "411",
  avances_clients: "4191",
  produits_prestations: "706",
  produits_debours: "707",
  tva_collectee: "4431",
  retenues_subies: "4492",
  banque: "521",
  cheques: "513",
  caisse: "571",
  mobile_money: "552",
};

export const LIBELLES_COMPTES: Readonly<Record<CleCompte, string>> = {
  clients: "Clients",
  avances_clients: "Clients, avances et acomptes reçus",
  produits_prestations: "Services vendus",
  produits_debours: "Débours refacturés",
  tva_collectee: "État, TVA facturée",
  retenues_subies: "État, retenues à la source subies",
  banque: "Banques",
  cheques: "Chèques à encaisser",
  caisse: "Caisse",
  mobile_money: "Monnaie électronique (Mobile Money)",
};

export const JOURNAUX_DEPART: Readonly<Record<CleJournal, string>> = {
  ventes: "VE",
  banque: "BQ",
  caisse: "CA",
  mobile_money: "MM",
  operations_diverses: "OD",
};

export interface PlanComptable {
  comptes: Record<CleCompte, string>;
  journaux: Record<CleJournal, string>;
  valeurs_validees: boolean;
}

export async function lirePlanComptable(db: Db): Promise<PlanComptable> {
  const r = await db.query("SELECT type, cle, valeur FROM plan_comptable_cabinet");
  const comptes = { ...COMPTES_DEPART } as Record<CleCompte, string>;
  const journaux = { ...JOURNAUX_DEPART } as Record<CleJournal, string>;
  for (const l of r.rows) {
    if (l.type === "compte" && (CLES_COMPTES as readonly string[]).includes(l.cle)) {
      comptes[l.cle as CleCompte] = l.valeur as string;
    }
    if (l.type === "journal" && (CLES_JOURNAUX as readonly string[]).includes(l.cle)) {
      journaux[l.cle as CleJournal] = l.valeur as string;
    }
  }
  const v = await db.query("SELECT valeurs_validees FROM plan_comptable_validation");
  return { comptes, journaux, valeurs_validees: v.rows[0]?.valeurs_validees === true };
}

export async function enregistrerPlanComptable(
  db: Db,
  cabinetId: string,
  auteurId: string,
  saisie: PlanComptableSaisie,
): Promise<void> {
  const lignes: [string, string, string][] = [
    ...Object.entries(saisie.comptes ?? {}).map(
      ([cle, valeur]) => ["compte", cle, valeur as string] as [string, string, string],
    ),
    ...Object.entries(saisie.journaux ?? {}).map(
      ([cle, valeur]) => ["journal", cle, valeur as string] as [string, string, string],
    ),
  ];
  for (const [type, cle, valeur] of lignes) {
    await db.query(
      `INSERT INTO plan_comptable_cabinet (cabinet_id, type, cle, valeur, modifie_par)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cabinet_id, type, cle)
       DO UPDATE SET valeur = EXCLUDED.valeur, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
      [cabinetId, type, cle, valeur, auteurId],
    );
  }
  if (saisie.valeurs_validees !== undefined) {
    await db.query(
      `INSERT INTO plan_comptable_validation (cabinet_id, valeurs_validees, modifie_par)
       VALUES ($1, $2, $3)
       ON CONFLICT (cabinet_id)
       DO UPDATE SET valeurs_validees = EXCLUDED.valeurs_validees, modifie_par = EXCLUDED.modifie_par,
         modifie_le = now()`,
      [cabinetId, saisie.valeurs_validees, auteurId],
    );
  }
}

export function vuePlanComptable(p: PlanComptable): Record<string, unknown> {
  return {
    comptes: CLES_COMPTES.map((cle) => ({
      cle,
      compte: p.comptes[cle],
      libelle: LIBELLES_COMPTES[cle],
      valeur_de_depart: COMPTES_DEPART[cle],
    })),
    journaux: CLES_JOURNAUX.map((cle) => ({
      cle,
      code: p.journaux[cle],
      valeur_de_depart: JOURNAUX_DEPART[cle],
    })),
    valeurs_validees: p.valeurs_validees,
    referentiel: "SYSCOHADA révisé — valeurs de départ à faire valider par un expert-comptable",
  };
}
