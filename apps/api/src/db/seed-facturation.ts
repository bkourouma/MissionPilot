import type { Role } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { genererEcheances, honorairesSignes, insererEcheance } from "../facturation/echeancier.js";
import {
  calculEnregistre,
  creerBrouillon,
  emettre,
  lireFacture,
  roleApprobationFacture,
} from "../facturation/factures.js";
import { exigerMissionVisible } from "../missions/acces.js";
import type { Db } from "./pool.js";

/*
 * Démonstration de la facturation (données fictives) : mentions légales du
 * cabinet, échéancier 30 % / 70 % de la mission « Plan stratégique » signée,
 * un débours refacturable validé sur l'audit en cours, et une facture émise
 * sur l'acompte (circuit complet : gestionnaire, associé). Tous les montants
 * viennent des moteurs. Idempotent : rien n'est recréé au second passage.
 */

const MISSION_FORFAIT = "Plan stratégique Transports Akwaba (démo)";
const MISSION_AUDIT = "Audit organisationnel Lagune Microfinance (démo)";
const LIBELLE_DEBOURS = "Billet d'avion Abidjan-Korhogo (démo)";

const acteur = (cabinetId: string, utilisateurId: string, role: Role): Auth => ({
  cabinetId,
  utilisateurId,
  email: "",
  nom: "",
  roles: [role],
});

async function idPar(db: Db, sql: string, valeur: string): Promise<string | null> {
  const r = await db.query(sql, [valeur]);
  return (r.rows[0]?.id as string | undefined) ?? null;
}

async function semerParametres(db: Db, cabinetId: string, associe: string): Promise<void> {
  await db.query(
    `INSERT INTO parametres_facturation (cabinet_id, raison_sociale, forme_juridique, rccm,
       compte_contribuable, regime_fiscal, adresse, telephone, banque, iban, autres_coordonnees,
       modifie_par)
     VALUES ($1, 'Cabinet Démo Conseil (fictif)', 'SARL', 'CI-ABJ-DEMO-B-9999', 'DEMO9999Z',
       'Réel normal (à confirmer)', 'Plateau, Abidjan, Côte d''Ivoire', '+225 00 00 00 00 00',
       'Banque Démo (fictive)', 'CI00DEMO00000000000000000000',
       'Mobile Money : +225 00 00 00 00 00 (fictif)', $2)
     ON CONFLICT (cabinet_id) DO NOTHING`,
    [cabinetId, associe],
  );
}

export async function semerFacturation(
  db: Db,
  cabinetId: string,
  ids: Map<Role, string>,
): Promise<void> {
  const associe = ids.get("associe");
  const gestionnaire = ids.get("gestionnaire");
  const chef = ids.get("chef_mission");
  const consultant = ids.get("consultant");
  if (!associe || !gestionnaire || !chef || !consultant) return;
  await semerParametres(db, cabinetId, associe);
  const parAssocie = acteur(cabinetId, associe, "associe");
  const parGestionnaire = acteur(cabinetId, gestionnaire, "gestionnaire");

  // Échéancier de la mission au forfait signée.
  const forfaitId = await idPar(db, "SELECT id FROM missions WHERE intitule = $1", MISSION_FORFAIT);
  if (forfaitId) {
    const mission = await exigerMissionVisible(db, parAssocie, forfaitId, true);
    const existe = await db.query("SELECT 1 FROM echeances_facturation WHERE mission_id = $1", [
      forfaitId,
    ]);
    if (!existe.rowCount) {
      const m = await db.query(
        "SELECT date_fin::text AS date_fin, mode_facturation FROM missions WHERE id = $1",
        [forfaitId],
      );
      const nouvelles = genererEcheances(
        { ...mission, ...m.rows[0] },
        await honorairesSignes(db, mission),
        {},
      );
      for (const [i, e] of nouvelles.entries()) {
        await insererEcheance(db, cabinetId, mission, e, i + 1, gestionnaire);
      }
    }
    // Facture émise sur l'acompte (une seule fois).
    const facturee = await db.query("SELECT 1 FROM factures WHERE mission_id = $1", [forfaitId]);
    const acompte = await db.query(
      `SELECT id FROM echeances_facturation WHERE mission_id = $1 AND type = 'acompte'
       ORDER BY ordre LIMIT 1`,
      [forfaitId],
    );
    if (!facturee.rowCount && acompte.rows[0]) {
      await db.query("UPDATE echeances_facturation SET statut = 'a_facturer' WHERE id = $1", [
        acompte.rows[0].id,
      ]);
      const factureId = await creerBrouillon(db, parGestionnaire, mission, {
        echeance_ids: [acompte.rows[0].id as string],
        debours_ids: [],
        objet: "Acompte à la signature de la lettre de mission",
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
      await emettre(db, parGestionnaire, await lireFacture(db, factureId, true));
    }
  }

  // Débours refacturable validé sur l'audit en cours.
  const auditId = await idPar(db, "SELECT id FROM missions WHERE intitule = $1", MISSION_AUDIT);
  const collaborateur = await idPar(
    db,
    "SELECT id FROM collaborateurs WHERE utilisateur_id = $1 AND actif",
    consultant,
  );
  if (auditId && collaborateur) {
    const existe = await db.query("SELECT 1 FROM debours WHERE mission_id = $1 AND libelle = $2", [
      auditId,
      LIBELLE_DEBOURS,
    ]);
    if (!existe.rowCount) {
      await db.query(
        `INSERT INTO debours (cabinet_id, mission_id, collaborateur_id, auteur_id, date, categorie,
           libelle, montant, devise, refacturable, justificatif, statut, soumis_le, decide_par,
           decide_le)
         VALUES ($1, $2, $3, $4, current_date - 14, 'transport', $5, 185000, 'XOF', true,
           'debours/demo/billet-korhogo.jpg', 'valide', now(), $6, now())`,
        [cabinetId, auditId, collaborateur, consultant, LIBELLE_DEBOURS, chef],
      );
    }
  }
}
