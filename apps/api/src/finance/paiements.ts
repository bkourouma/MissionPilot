import {
  comparer,
  ecartJours,
  montant as montantMoteur,
  sommer,
  soustraire,
  zero,
  type Devise,
  type Montant,
} from "@missionpilot/engines";
import type { StatutPaiement } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { nombre } from "../missions/outils.js";

/*
 * Statut de paiement d'une facture (FIN-09) : DÉRIVÉ, jamais stocké.
 * - Encaissé = Σ imputations (contre-passations comprises, négatives) jusqu'à
 *   la date de référence ; solde = net à payer − encaissé (moteur).
 * - Soldée si le solde est nul ; non payée si rien n'est encaissé ;
 *   partiellement payée sinon ; « en retard » prime dès que la date de
 *   référence dépasse l'échéance (au lendemain de l'échéance) et qu'un solde
 *   reste dû. Facture annulée par un avoir : « annulee » (net considéré nul).
 */

export interface FacturePaiement {
  id: string;
  numero: string | null;
  mission_id: string;
  client_id: string;
  devise: Devise;
  statut: string;
  net_a_payer: number;
  date_emission: string | null;
  date_echeance: string | null;
}

export interface Situation {
  statut_paiement: StatutPaiement;
  net_a_payer: Montant;
  encaisse: Montant;
  solde: Montant;
  jours_retard: number;
}

export const COLONNES_FACTURE_PAIEMENT = `f.id, f.numero, f.mission_id, f.client_id, f.devise, f.statut,
  f.net_a_payer, f.date_emission::text AS date_emission, f.date_echeance::text AS date_echeance`;

export function versFacturePaiement(r: Record<string, unknown>): FacturePaiement {
  return { ...(r as unknown as FacturePaiement), net_a_payer: nombre(r.net_a_payer) };
}

/** Imputations par facture (montants au format du moteur), jusqu'à une date incluse. */
export async function imputationsParFacture(
  db: Db,
  factureIds: readonly string[],
  jusquAu?: string,
): Promise<Map<string, Montant[]>> {
  const parFacture = new Map<string, Montant[]>();
  if (factureIds.length === 0) return parFacture;
  const r = await db.query(
    `SELECT facture_id, montant, devise FROM imputations
     WHERE facture_id = ANY ($1::uuid[]) AND ($2::date IS NULL OR date_imputation <= $2)`,
    [factureIds, jusquAu ?? null],
  );
  for (const i of r.rows) {
    const id = i.facture_id as string;
    parFacture.set(id, [
      ...(parFacture.get(id) ?? []),
      montantMoteur(nombre(i.montant), i.devise as Devise),
    ]);
  }
  return parFacture;
}

/** Situation de paiement d'une facture émise (ou annulée) à une date, par le moteur. */
export function situationPaiement(
  f: FacturePaiement,
  imputations: readonly Montant[],
  date: string,
): Situation {
  const annulee = f.statut === "annulee";
  const net = annulee ? zero(f.devise) : montantMoteur(f.net_a_payer, f.devise);
  const encaisse = sommer(imputations, f.devise);
  const solde = soustraire(net, encaisse);
  const du = comparer(solde, zero(f.devise)) > 0;
  const retard = f.date_echeance && du ? ecartJours(f.date_echeance, date) : 0;
  let statut: StatutPaiement;
  if (annulee) statut = "annulee";
  else if (!du) statut = "soldee";
  else if (retard > 0) statut = "en_retard";
  else if (comparer(encaisse, zero(f.devise)) === 0) statut = "non_payee";
  else statut = "partiellement_payee";
  return {
    statut_paiement: statut,
    net_a_payer: net,
    encaisse,
    solde,
    jours_retard: Math.max(retard, 0),
  };
}

export function vueSituation(s: Situation): Record<string, unknown> {
  return {
    statut_paiement: s.statut_paiement,
    devise: s.solde.devise,
    net_a_payer: s.net_a_payer.valeur,
    encaisse: s.encaisse.valeur,
    solde: s.solde.valeur,
    jours_retard: s.jours_retard,
  };
}

/** Situation d'une facture lue en base, à une date. */
export async function situationFacture(
  db: Db,
  factureId: string,
  date: string,
): Promise<{ facture: FacturePaiement; situation: Situation } | null> {
  const r = await db.query(`SELECT ${COLONNES_FACTURE_PAIEMENT} FROM factures f WHERE f.id = $1`, [
    factureId,
  ]);
  if (!r.rows[0]) return null;
  const facture = versFacturePaiement(r.rows[0]);
  const imputations = (await imputationsParFacture(db, [factureId], date)).get(factureId) ?? [];
  return { facture, situation: situationPaiement(facture, imputations, date) };
}

/**
 * Refuse l'annulation (avoir) d'une facture qui porte des encaissements nets
 * non nuls : contre-passer d'abord les encaissements imputés.
 */
export async function exigerSansEncaissementNet(db: Db, factureId: string): Promise<void> {
  const r = await db.query(
    `SELECT f.devise, i.montant FROM factures f JOIN imputations i ON i.facture_id = f.id
     WHERE f.id = $1`,
    [factureId],
  );
  if (r.rows.length === 0) return;
  const devise = r.rows[0].devise as Devise;
  const total = sommer(
    r.rows.map((l) => montantMoteur(nombre(l.montant), devise)),
    devise,
  );
  if (comparer(total, zero(devise)) !== 0) {
    throw new AppError(
      409,
      "FACTURE_ENCAISSEE",
      "Facture déjà encaissée : contre-passer les encaissements imputés avant l'avoir.",
    );
  }
}
