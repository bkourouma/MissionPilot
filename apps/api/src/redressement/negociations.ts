import {
  construireEcheancierAccord,
  exigerPaiementAdmissible,
  situationCreancier,
  validerEcheancierAccord,
  verifierAccordContreCreance,
  type EcheanceAccord,
} from "@missionpilot/engines";
import type { RedCreancierVue, RedEvenementNegociation } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { accordSuivi, detailCreancier, type CreancierLu } from "./creanciers.js";
import { dateDuJour } from "./dates.js";
import { journalRed } from "./journal.js";
import { DEBIT_EVENEMENTS, verifierDebit } from "./limites.js";

/*
 * Négociation avec un créancier (RED-12) : fil d'événements EN AJOUT SEUL. Un accord n'est en
 * vigueur que tant qu'aucune rupture ne le référence ; un créancier n'a jamais deux accords en
 * vigueur. L'échéancier d'un accord est construit (régulier) ou validé (explicite) par le moteur,
 * puis écrit avec l'événement dans la MÊME transaction ; « somme des échéances = montant convenu »
 * est vérifiée par le moteur (jamais en SQL). Chaque contrôle est doublé en base (MPZ09).
 * Le journal ne porte que le type de l'événement : jamais un nom, un montant ni une condition.
 */

const incoherent = (message: string) => new AppError(409, "RED_NEGOCIATION_INCOHERENTE", message);

/** Accord en vigueur (non rompu) du créancier, ou null. */
function accordEnVigueur(c: CreancierLu) {
  return c.accord && !c.accord.rompu ? c.accord : null;
}

/** Route 28 : un événement de négociation (dossier verrouillé par l'appelant, créancier relu sous verrou). */
export async function ajouterEvenement(
  db: Db,
  auth: Auth,
  creancier: CreancierLu,
  corps: RedEvenementNegociation,
): Promise<RedCreancierVue> {
  await verifierDebit(db, auth, DEBIT_EVENEMENTS);
  const base = [
    auth.cabinetId,
    creancier.dossier_id,
    creancier.id,
    corps.type,
    corps.date_evenement,
  ];
  if (corps.type === "accord") {
    if (accordEnVigueur(creancier)) {
      throw new AppError(
        409,
        "RED_ACCORD_EN_VIGUEUR",
        "Un accord est déjà en vigueur pour ce créancier : rompez-le avant d'en conclure un autre.",
      );
    }
    if (!creancier.creance) throw incoherent("Ce créancier n'a pas de créance enregistrée.");
    // L'encours (principal + intérêts) vient du moteur : l'API n'additionne rien.
    const encours = situationCreancier({
      principal: creancier.creance.principal,
      interets: creancier.creance.interets,
      echeanceInitiale: creancier.creance.echeance_initiale,
      accord: null,
      dateReference: dateDuJour(),
    }).encoursInitial;
    verifierAccordContreCreance(corps.montant, encours);
    const echeances: readonly EcheanceAccord[] =
      corps.echeancier.mode === "regulier"
        ? construireEcheancierAccord({
            montantConvenu: corps.montant,
            nombreEcheances: corps.echeancier.nombre_echeances,
            datePremiere: corps.echeancier.date_premiere,
            periodiciteMois: corps.echeancier.periodicite_mois,
          })
        : validerEcheancierAccord(corps.montant, corps.echeancier.lignes);
    const r = await db.query(
      `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement,
         montant, conditions, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [...base, corps.montant, corps.conditions ?? null, auth.utilisateurId],
    );
    const accordId = r.rows[0].id as string;
    await db.query(
      `INSERT INTO red_echeances (cabinet_id, dossier_id, creancier_id, accord_id, rang, date_echeance, montant)
       SELECT $1, $2, $3, $4, x.rang, x.date_echeance, x.montant
       FROM unnest($5::int[], $6::date[], $7::bigint[]) AS x(rang, date_echeance, montant)`,
      [
        auth.cabinetId,
        creancier.dossier_id,
        creancier.id,
        accordId,
        echeances.map((e) => e.rang),
        echeances.map((e) => e.date),
        echeances.map((e) => String(e.montant)),
      ],
    );
  } else if (corps.type === "paiement") {
    const accord = creancier.accord;
    if (!accord || accord.id !== corps.accord_id) {
      throw incoherent("L'accord visé n'est pas un accord de ce créancier.");
    }
    const suivi = accordSuivi(creancier);
    if (!suivi) throw incoherent("L'accord visé n'est pas un accord de ce créancier.");
    // ACCORD_ROMPU (409) si rompu ; PAIEMENT_EXCESSIF (409) au-delà du montant convenu.
    exigerPaiementAdmissible(suivi, corps.montant);
    if (
      corps.echeance_rang !== undefined &&
      !accord.echeances.some((e) => e.rang === corps.echeance_rang)
    ) {
      throw incoherent("L'échéance visée n'existe pas dans l'accord.");
    }
    // Garde contre le double envoi : le même paiement (accord, date, montant, échéance) du même auteur
    // dans les 60 dernières secondes, non annulé, est refusé ; une saisie à tort se corrige par une
    // annulation de paiement, jamais par un UPDATE.
    const doublon = await db.query(
      `SELECT 1 FROM red_negociation_evenements p
       WHERE p.creancier_id = $1 AND p.type = 'paiement' AND p.accord_id = $2 AND p.date_evenement = $3
         AND p.montant = $4 AND p.echeance_rang IS NOT DISTINCT FROM $5 AND p.auteur_id = $6
         AND p.cree_le > now() - interval '60 seconds'
         AND NOT EXISTS (SELECT 1 FROM red_negociation_evenements x
                         WHERE x.type = 'annulation_paiement' AND x.paiement_annule_id = p.id)
       LIMIT 1`,
      [
        creancier.id,
        corps.accord_id,
        corps.date_evenement,
        corps.montant,
        corps.echeance_rang ?? null,
        auth.utilisateurId,
      ],
    );
    if ((doublon.rowCount ?? 0) > 0) {
      throw new AppError(
        409,
        "RED_PAIEMENT_EN_DOUBLE",
        "Un paiement identique vient d'être saisi : s'il est faux, annulez-le.",
      );
    }
    await db.query(
      `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement,
         montant, accord_id, echeance_rang, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [...base, corps.montant, corps.accord_id, corps.echeance_rang ?? null, auth.utilisateurId],
    );
  } else if (corps.type === "annulation_paiement") {
    // Le paiement annulé est un paiement de ce créancier, pas déjà annulé ; l'accord est le sien.
    const p = await db.query(
      `SELECT p.accord_id,
         EXISTS (SELECT 1 FROM red_negociation_evenements x
                 WHERE x.type = 'annulation_paiement' AND x.paiement_annule_id = p.id) AS annule
       FROM red_negociation_evenements p
       WHERE p.id = $1 AND p.creancier_id = $2 AND p.type = 'paiement'`,
      [corps.paiement_annule_id, creancier.id],
    );
    const ligne = p.rows[0] as { accord_id: string; annule: boolean } | undefined;
    if (!ligne) throw incoherent("Le paiement visé n'est pas un paiement de ce créancier.");
    if (ligne.annule) throw incoherent("Ce paiement est déjà annulé.");
    await db.query(
      `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement,
         accord_id, paiement_annule_id, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...base, ligne.accord_id, corps.paiement_annule_id, auth.utilisateurId],
    );
  } else if (corps.type === "rupture") {
    const accord = creancier.accord;
    if (!accord || accord.id !== corps.accord_id) {
      throw incoherent("L'accord visé n'est pas un accord de ce créancier.");
    }
    if (accord.rompu) throw new AppError(409, "RED_ACCORD_ROMPU", "Cet accord est déjà rompu.");
    await db.query(
      `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement,
         conditions, accord_id, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...base, corps.conditions ?? null, corps.accord_id, auth.utilisateurId],
    );
  } else {
    await db.query(
      `INSERT INTO red_negociation_evenements (cabinet_id, dossier_id, creancier_id, type, date_evenement,
         montant, conditions, auteur_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [...base, corps.montant ?? null, corps.conditions ?? null, auth.utilisateurId],
    );
  }
  await journalRed(db, auth, "red_creancier", "evenement", creancier.id, {
    dossier_id: creancier.dossier_id,
    type: corps.type,
  });
  return detailCreancier(db, creancier.dossier_id, creancier.id);
}
