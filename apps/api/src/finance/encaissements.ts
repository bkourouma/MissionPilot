import {
  comparer,
  montant as montantMoteur,
  oppose,
  sommer,
  soustraire,
  zero,
  type Devise,
  type Montant,
} from "@missionpilot/engines";
import type { EncaissementCreation, ImputationSaisie } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { estAssocie, filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { aujourdhui, nombre } from "../missions/outils.js";
import { imputationsModifiees, tropPercu } from "./erreurs.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
  type FacturePaiement,
} from "./paiements.js";

/*
 * RÈGLES DES ENCAISSEMENTS (FIN-09), testées dans test/encaissements.test.ts
 *
 * - Ajout seul : un encaissement et ses imputations ne changent jamais
 *   (REVOKE + déclencheurs, migration 0060). Une erreur se corrige par une
 *   contre-passation : demande motivée, validée par un autre utilisateur que
 *   le demandeur (sauf associé), qui crée l'encaissement négatif lié et les
 *   imputations négatives miroirs.
 * - Imputation sur une ou plusieurs factures émises du même client et de la
 *   même devise, chacune au plus de son reste à payer (moteur, sous verrou).
 * - Ordre constant des verrous dans toute opération sur un encaissement
 *   existant (imputation d'avance, contre-passation) : l'encaissement
 *   (verrou consultatif) D'ABORD, PUIS les factures (FOR UPDATE, par
 *   identifiant), puis relecture des imputations sous verrou. Une imputation
 *   d'avance et une contre-passation simultanées sont donc sérialisées : une
 *   imputation ne reste jamais active sur un encaissement contre-passé.
 *   La création d'un encaissement ne verrouille que les factures (il n'existe
 *   pas encore).
 * - Trop-perçu : la part non imputée est refusée, sauf avance explicite ;
 *   l'avance reste imputable plus tard (origine « avance »).
 * - Aucun calcul de montant hors du moteur ; aucune donnée de coût ni de marge.
 */

export interface EncaissementDb {
  id: string;
  client_id: string;
  date_encaissement: string;
  montant: number;
  devise: Devise;
  mode: string;
  operateur: string | null;
  reference: string | null;
  avance: boolean;
  contre_passation_de: string | null;
  saisi_par: string;
}

const COLONNES_ENCAISSEMENT = `e.id, e.client_id, cl.raison_sociale AS client_raison_sociale,
  e.date_encaissement::text AS date_encaissement, e.montant, e.devise, e.mode, e.operateur, e.reference,
  e.commentaire, e.avance, e.contre_passation_de, e.motif, e.saisi_par, e.valide_par, e.saisi_le,
  (SELECT x.id FROM encaissements x WHERE x.contre_passation_de = e.id) AS contre_passe_par`;
const DEPUIS_ENCAISSEMENT = "encaissements e JOIN clients cl ON cl.id = e.client_id";

function versEncaissement(r: Record<string, unknown>): EncaissementDb & Record<string, unknown> {
  return { ...(r as unknown as EncaissementDb), montant: nombre(r.montant) };
}

export async function lireEncaissement(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<EncaissementDb & Record<string, unknown>> {
  // Verrou transactionnel consultatif : la table est en ajout seul (aucun
  // droit UPDATE, donc pas de SELECT … FOR UPDATE possible pour le rôle applicatif).
  // La clé du verrou est commune à toute l'instance : l'existence est d'abord
  // vérifiée sous RLS, pour qu'un identifiant d'un autre cabinet réponde 404
  // sans jamais attendre (ni faire attendre) un verrou de ce cabinet.
  if (verrouiller) {
    const existe = await db.query("SELECT 1 FROM encaissements WHERE id = $1", [id]);
    if (!existe.rowCount) throw introuvable("Encaissement");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('encaissement:' || $1, 0))", [
      id,
    ]);
  }
  const r = await db.query(
    `SELECT ${COLONNES_ENCAISSEMENT} FROM ${DEPUIS_ENCAISSEMENT} WHERE e.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Encaissement");
  return versEncaissement(r.rows[0]);
}

/** Imputations d'un encaissement (avec le numéro de la facture). */
export async function imputationsEncaissement(
  db: Db,
  encaissementId: string,
): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT i.id, i.facture_id, f.numero AS facture_numero, i.montant, i.devise, i.origine,
       i.date_imputation::text AS date_imputation, i.cree_par, i.cree_le
     FROM imputations i JOIN factures f ON f.id = i.facture_id
     WHERE i.encaissement_id = $1 ORDER BY i.cree_le, i.id`,
    [encaissementId],
  );
  return r.rows.map((i) => ({ ...i, montant: nombre(i.montant) }));
}

/** Part non imputée d'un encaissement (moteur) : montant − Σ imputations. */
export async function nonImpute(db: Db, e: EncaissementDb): Promise<Montant> {
  const r = await db.query("SELECT montant FROM imputations WHERE encaissement_id = $1", [e.id]);
  return soustraire(
    montantMoteur(e.montant, e.devise),
    sommer(
      r.rows.map((i) => montantMoteur(nombre(i.montant), e.devise)),
      e.devise,
    ),
  );
}

export async function vueEncaissement(
  db: Db,
  e: EncaissementDb & Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return {
    ...e,
    non_impute: (await nonImpute(db, e)).valeur,
    imputations: await imputationsEncaissement(db, e.id),
  };
}

/**
 * Factures visées par des imputations, verrouillées (ordre des identifiants)
 * et contrôlées : visibles, émises, nature facture, même client et devise ;
 * chaque imputation ≤ reste à payer (moteur). Une facture inconnue ou
 * invisible répond 400 (référence inconnue), comme ailleurs.
 */
async function controlerImputations(
  db: Db,
  auth: Auth,
  client: string,
  devise: Devise,
  imputations: readonly ImputationSaisie[],
  dateEncaissement: string | null,
): Promise<Map<string, FacturePaiement>> {
  const ids = imputations.map((i) => i.facture_id).sort();
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT} FROM factures f JOIN missions m ON m.id = f.mission_id
     WHERE f.id = ANY ($1::uuid[]) AND ${filtreVisibilite(2, 3)}
     ORDER BY f.id FOR UPDATE OF f`,
    [ids, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  const factures = new Map(r.rows.map((l) => [l.id as string, versFacturePaiement(l)]));
  const deja = await imputationsParFacture(db, ids);
  for (const i of imputations) {
    const f = factures.get(i.facture_id);
    if (!f) throw requeteInvalide("Facture inconnue.");
    if (f.statut !== "emise") throw conflit(`Facture ${f.numero ?? ""} non émise ou annulée.`);
    if (f.client_id !== client) {
      throw requeteInvalide(`La facture ${f.numero ?? ""} est celle d'un autre client.`);
    }
    if (f.devise !== devise) {
      throw requeteInvalide(`La facture ${f.numero ?? ""} est dans une autre devise.`);
    }
    if (dateEncaissement !== null && f.date_emission && dateEncaissement < f.date_emission) {
      throw requeteInvalide(
        `Encaissement antérieur à l'émission de la facture ${f.numero ?? ""} : l'enregistrer en avance.`,
      );
    }
    const situation = situationPaiement(f, deja.get(f.id) ?? [], aujourdhui());
    if (comparer(montantMoteur(i.montant, devise), situation.solde) > 0) {
      throw tropPercu(
        `L'imputation dépasse le reste à payer de la facture ${f.numero ?? ""} (trop-perçu refusé).`,
      );
    }
  }
  return factures;
}

/** Total imputé (moteur), refusé s'il dépasse le disponible. */
function totalImpute(
  imputations: readonly ImputationSaisie[],
  devise: Devise,
  disponible: Montant,
): Montant {
  const total = sommer(
    imputations.map((i) => montantMoteur(i.montant, devise)),
    devise,
  );
  if (comparer(total, disponible) > 0) {
    throw requeteInvalide("Les imputations dépassent le montant disponible de l'encaissement.");
  }
  return total;
}

async function insererImputations(
  db: Db,
  auth: Auth,
  encaissementId: string,
  devise: Devise,
  imputations: readonly { facture_id: string; montant: number }[],
  origine: "saisie" | "avance" | "contre_passation",
  date: string,
): Promise<void> {
  for (const i of imputations) {
    await db.query(
      `INSERT INTO imputations (cabinet_id, encaissement_id, facture_id, montant, devise, origine,
         date_imputation, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        auth.cabinetId,
        encaissementId,
        i.facture_id,
        i.montant,
        devise,
        origine,
        date,
        auth.utilisateurId,
      ],
    );
  }
}

/** Enregistre un encaissement et ses imputations ; renvoie son identifiant. */
export async function creerEncaissement(
  db: Db,
  auth: Auth,
  e: EncaissementCreation,
): Promise<string> {
  if (e.date > aujourdhui()) throw requeteInvalide("Un encaissement ne se date pas dans le futur.");
  const client = await db.query("SELECT 1 FROM clients WHERE id = $1", [e.client_id]);
  if (!client.rowCount) throw requeteInvalide("Client inconnu.");
  const devise = e.devise as Devise;
  const encaisse = montantMoteur(e.montant, devise);
  await controlerImputations(db, auth, e.client_id, devise, e.imputations, e.date);
  const total = totalImpute(e.imputations, devise, encaisse);
  const reste = comparer(soustraire(encaisse, total), zero(devise)) > 0;
  if (reste && !e.avance) {
    throw tropPercu(
      "Une partie de l'encaissement n'est imputée sur aucune facture : l'imputer, ou l'accepter explicitement comme avance.",
    );
  }
  const r = await db.query(
    `INSERT INTO encaissements (cabinet_id, client_id, date_encaissement, montant, devise, mode,
       operateur, reference, commentaire, avance, saisi_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      auth.cabinetId,
      e.client_id,
      e.date,
      e.montant,
      devise,
      e.mode,
      e.operateur,
      e.reference ?? null,
      e.commentaire ?? null,
      reste,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await insererImputations(db, auth, id, devise, e.imputations, "saisie", e.date);
  return id;
}

/** Impute plus tard la part non imputée (avance) d'un encaissement. */
export async function imputerAvance(
  db: Db,
  auth: Auth,
  encaissementId: string,
  imputations: readonly ImputationSaisie[],
): Promise<EncaissementDb> {
  // Ordre constant des verrous : encaissement, puis factures (voir en tête).
  const e = await lireEncaissement(db, encaissementId, true);
  if (e.contre_passation_de !== null || e.contre_passe_par !== null) {
    throw conflit("Encaissement contre-passé : plus d'imputation possible.");
  }
  await controlerImputations(db, auth, e.client_id, e.devise, imputations, null);
  totalImpute(imputations, e.devise, await nonImpute(db, e));
  await insererImputations(db, auth, e.id, e.devise, imputations, "avance", aujourdhui());
  return e;
}

/** Demande motivée de contre-passation d'un encaissement positif. */
export async function demanderContrePassation(
  db: Db,
  auth: Auth,
  encaissementId: string,
  motif: string,
): Promise<string> {
  const e = await lireEncaissement(db, encaissementId, true);
  if (e.contre_passation_de !== null) throw conflit("Une contre-passation ne se contre-passe pas.");
  if (e.contre_passe_par !== null) throw conflit("Encaissement déjà contre-passé.");
  const enAttente = await db.query(
    "SELECT 1 FROM contre_passations WHERE encaissement_id = $1 AND statut = 'demandee'",
    [encaissementId],
  );
  if (enAttente.rowCount) throw conflit("Une demande de contre-passation est déjà en attente.");
  const r = await db.query(
    `INSERT INTO contre_passations (cabinet_id, encaissement_id, motif, demandee_par)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [auth.cabinetId, encaissementId, motif, auth.utilisateurId],
  );
  return r.rows[0].id as string;
}

export interface DemandeContrePassation {
  id: string;
  encaissement_id: string;
  motif: string;
  statut: "demandee" | "validee" | "rejetee";
  demandee_par: string;
}

export async function lireDemande(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<DemandeContrePassation & Record<string, unknown>> {
  const r = await db.query(
    `SELECT id, encaissement_id, motif, statut, demandee_par, demandee_le, decidee_par, decidee_le,
       motif_rejet, encaissement_negatif_id
     FROM contre_passations WHERE id = $1 ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Demande de contre-passation");
  return r.rows[0];
}

/** Séparation des tâches : la décision revient à un autre que le demandeur, sauf associé. */
function exigerAutreQueDemandeur(auth: Auth, d: DemandeContrePassation): void {
  if (d.demandee_par === auth.utilisateurId && !estAssocie(auth)) {
    throw new AppError(
      403,
      "VALIDATION_REQUISE",
      "Le demandeur ne décide pas lui-même de sa contre-passation : la faire valider par un autre gestionnaire ou un associé.",
    );
  }
}

/**
 * Valide une contre-passation : encaissement négatif (opposé exact, moteur)
 * et imputations négatives miroirs par facture ; la demande passe « validée ».
 */
export async function validerContrePassation(
  db: Db,
  auth: Auth,
  demandeId: string,
): Promise<string> {
  const d = await lireDemande(db, demandeId, true);
  if (d.statut !== "demandee") throw conflit("Cette demande a déjà été décidée.");
  exigerAutreQueDemandeur(auth, d);
  // Ordre constant des verrous : encaissement, puis factures, puis relecture
  // des imputations sous verrou (voir en tête).
  const e = await lireEncaissement(db, d.encaissement_id, true);
  if (e.contre_passe_par !== null) throw conflit("Encaissement déjà contre-passé.");
  const lireImputees = () =>
    db.query(
      "SELECT id, facture_id, montant FROM imputations WHERE encaissement_id = $1 ORDER BY facture_id, id",
      [d.encaissement_id],
    );
  const avant = await lireImputees();
  const factures = [...new Set(avant.rows.map((i) => i.facture_id as string))].sort();
  if (factures.length > 0) {
    await db.query("SELECT id FROM factures WHERE id = ANY ($1::uuid[]) ORDER BY id FOR UPDATE", [
      factures,
    ]);
  }
  const imputees = await lireImputees();
  const empreinte = (rows: Record<string, unknown>[]) => rows.map((i) => i.id as string).join(",");
  if (empreinte(imputees.rows) !== empreinte(avant.rows)) {
    // Ne devrait pas arriver (l'encaissement est verrouillé) : défense en profondeur.
    throw imputationsModifiees();
  }
  const date = aujourdhui();
  const negatif = oppose(montantMoteur(e.montant, e.devise));
  const r = await db.query(
    `INSERT INTO encaissements (cabinet_id, client_id, date_encaissement, montant, devise, mode,
       operateur, reference, commentaire, avance, contre_passation_de, motif, saisi_par, valide_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, false, $9, $10, $11, $12) RETURNING id`,
    [
      auth.cabinetId,
      e.client_id,
      date,
      negatif.valeur,
      e.devise,
      e.mode,
      e.operateur,
      e.reference,
      e.id,
      d.motif,
      d.demandee_par,
      auth.utilisateurId,
    ],
  );
  const negatifId = r.rows[0].id as string;
  const miroirs = factures.map((factureId) => ({
    facture_id: factureId,
    montant: oppose(
      sommer(
        imputees.rows
          .filter((i) => i.facture_id === factureId)
          .map((i) => montantMoteur(nombre(i.montant), e.devise)),
        e.devise,
      ),
    ).valeur,
  }));
  await insererImputations(
    db,
    auth,
    negatifId,
    e.devise,
    miroirs.filter((m) => m.montant !== 0),
    "contre_passation",
    date,
  );
  await db.query(
    `UPDATE contre_passations SET statut = 'validee', decidee_par = $2, decidee_le = now(),
       encaissement_negatif_id = $3 WHERE id = $1`,
    [demandeId, auth.utilisateurId, negatifId],
  );
  return negatifId;
}

export async function rejeterContrePassation(
  db: Db,
  auth: Auth,
  demandeId: string,
  motif: string,
): Promise<void> {
  const d = await lireDemande(db, demandeId, true);
  if (d.statut !== "demandee") throw conflit("Cette demande a déjà été décidée.");
  exigerAutreQueDemandeur(auth, d);
  await db.query(
    `UPDATE contre_passations SET statut = 'rejetee', decidee_par = $2, decidee_le = now(),
       motif_rejet = $3 WHERE id = $1`,
    [demandeId, auth.utilisateurId, motif],
  );
}

export const COLONNES_LISTE_ENCAISSEMENT = COLONNES_ENCAISSEMENT;
export const DEPUIS_LISTE_ENCAISSEMENT = DEPUIS_ENCAISSEMENT;
export { versEncaissement };
