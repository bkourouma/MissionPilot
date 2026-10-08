import {
  ajouterJours,
  appliquerPourcentage,
  montant as montantMoteur,
  type Devise,
} from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import {
  calculEnregistre,
  creerBrouillon,
  emettre,
  lireFacture,
  roleApprobationFacture,
} from "../facturation/factures.js";
import { creerEncaissement } from "../finance/encaissements.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { aujourdhui, nombre } from "../missions/outils.js";
import type { Db } from "./pool.js";

/*
 * Démonstration de la fin de la finance (données fictives), après
 * seed-facturation.ts :
 * - l'acompte émis de la mission « Plan stratégique » est payé à 40 % par
 *   virement (facture partiellement payée) ;
 * - le débours refacturable de l'audit en cours est facturé il y a 40 jours
 *   (échéance à 30 jours : facture EN RETARD), payé en partie par Mobile Money
 *   (référence d'opération fictive) : de quoi remplir la balance âgée, les
 *   relances et les indicateurs.
 * Tous les montants viennent des moteurs. Idempotent (références « DEMO- »).
 */

const MISSION_FORFAIT = "Plan stratégique Transports Akwaba (démo)";
const MISSION_AUDIT = "Audit organisationnel Lagune Microfinance (démo)";
const OBJET_DEBOURS = "Débours refacturés (démo)";

const acteur = (cabinetId: string, utilisateurId: string, role: Role): Auth => ({
  cabinetId,
  utilisateurId,
  email: "",
  nom: "",
  roles: [role],
});

async function encaissementExiste(db: Db, reference: string): Promise<boolean> {
  const r = await db.query("SELECT 1 FROM encaissements WHERE reference = $1", [reference]);
  return (r.rowCount ?? 0) > 0;
}

/** Facture émise d'une mission (la première), ou null. */
async function factureEmise(db: Db, missionId: string, objet?: string) {
  const r = await db.query(
    `SELECT id, client_id, devise, net_a_payer, date_emission::text AS date_emission FROM factures
     WHERE mission_id = $1 AND nature = 'facture' AND statut = 'emise'
       AND ($2::text IS NULL OR objet = $2)
     ORDER BY cree_le LIMIT 1`,
    [missionId, objet ?? null],
  );
  return r.rows[0] as
    | { id: string; client_id: string; devise: Devise; net_a_payer: string; date_emission: string }
    | undefined;
}

export async function semerFinance(
  db: Db,
  cabinetId: string,
  ids: Map<Role, string>,
): Promise<void> {
  const associe = ids.get("associe");
  const gestionnaire = ids.get("gestionnaire");
  if (!associe || !gestionnaire) return;
  const parGestionnaire = acteur(cabinetId, gestionnaire, "gestionnaire");
  const aujour = aujourdhui();

  // 1. Acompte du plan stratégique : 40 % encaissés par virement.
  const forfait = await db.query("SELECT id FROM missions WHERE intitule = $1", [MISSION_FORFAIT]);
  const acompte = forfait.rows[0]
    ? await factureEmise(db, forfait.rows[0].id as string)
    : undefined;
  if (acompte && !(await encaissementExiste(db, "DEMO-VIR-0001"))) {
    const part = appliquerPourcentage(
      montantMoteur(nombre(acompte.net_a_payer), acompte.devise),
      40,
    );
    await creerEncaissement(db, parGestionnaire, {
      client_id: acompte.client_id,
      date: aujour,
      montant: part.valeur,
      devise: acompte.devise,
      mode: "virement",
      operateur: null,
      reference: "DEMO-VIR-0001",
      commentaire: "Virement partiel (démo)",
      imputations: [{ facture_id: acompte.id, montant: part.valeur }],
      avance: false,
    });
  }

  // 2. Débours de l'audit facturé il y a 40 jours : facture en retard.
  const audit = await db.query("SELECT id FROM missions WHERE intitule = $1", [MISSION_AUDIT]);
  const auditId = audit.rows[0]?.id as string | undefined;
  if (!auditId) return;
  let enRetard = await factureEmise(db, auditId, OBJET_DEBOURS);
  if (!enRetard) {
    const debours = await db.query(
      `SELECT d.id FROM debours d
       WHERE d.mission_id = $1 AND d.statut = 'valide' AND d.refacturable
         AND NOT EXISTS (SELECT 1 FROM facturation_liens l WHERE l.debours_id = d.id AND l.libere_le IS NULL)
       ORDER BY d.date LIMIT 1`,
      [auditId],
    );
    if (!debours.rows[0]) return;
    const mission = await exigerMissionVisible(
      db,
      acteur(cabinetId, associe, "associe"),
      auditId,
      true,
    );
    const factureId = await creerBrouillon(db, parGestionnaire, mission, {
      echeance_ids: [],
      debours_ids: [debours.rows[0].id as string],
      objet: OBJET_DEBOURS,
    });
    const brouillon = await lireFacture(db, factureId);
    const role = roleApprobationFacture(await calculEnregistre(db, brouillon), mission);
    await db.query(
      `UPDATE factures SET statut = 'a_approuver', role_approbateur = $2, soumise_par = $3,
         soumise_le = now() WHERE id = $1`,
      [factureId, role, gestionnaire],
    );
    await db.query(
      `UPDATE factures SET statut = 'approuvee', approuvee_par = $2, approuvee_le = now()
       WHERE id = $1`,
      [factureId, associe],
    );
    await emettre(
      db,
      parGestionnaire,
      await lireFacture(db, factureId, true),
      ajouterJours(aujour, -40),
    );
    enRetard = await factureEmise(db, auditId, OBJET_DEBOURS);
  }
  if (enRetard && !(await encaissementExiste(db, "DEMO-OM-0001"))) {
    const part = appliquerPourcentage(
      montantMoteur(nombre(enRetard.net_a_payer), enRetard.devise),
      50,
    );
    await creerEncaissement(db, parGestionnaire, {
      client_id: enRetard.client_id,
      date: ajouterJours(aujour, -5),
      montant: part.valeur,
      devise: enRetard.devise,
      mode: "mobile_money",
      operateur: "orange_money",
      reference: "DEMO-OM-0001",
      commentaire: "Paiement partiel Orange Money (démo, référence fictive)",
      imputations: [{ facture_id: enRetard.id, montant: part.valeur }],
      avance: false,
    });
  }
}
