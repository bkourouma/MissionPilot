import {
  CONTROLE_CLOTURE_LIBELLES,
  attestationClotureSchema,
  derogationClotureSchema,
  retraitDerogationClotureSchema,
  type ControleCloture,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { evaluerCloture } from "./evaluation.js";

/*
 * Dérogations motivées et attestations de la check-list de clôture (AUT-08). Tout est ajouté à
 * l'historique (ajout seul) : une dérogation accordée se retire par une NOUVELLE ligne. La route
 * exige `mission.cloturer` (directeur de mission, associé) pour les dérogations ; le déclencheur
 * MPX02 double ce contrôle de rôle.
 */

/** Dérogation accordée à un item bloquant, actif et aujourd'hui non conforme. */
export async function accorderDerogation(
  db: Db,
  auth: Auth,
  missionId: string,
  brut: unknown,
): Promise<void> {
  const c = derogationClotureSchema.parse(brut);
  const evaluation = await evaluerCloture(db, missionId);
  const item = evaluation.items.find((i) => i.controle === c.controle);
  if (!item || !item.actif || !item.bloquant) {
    throw new AppError(
      409,
      "DEROGATION_SANS_OBJET",
      `« ${CONTROLE_CLOTURE_LIBELLES[c.controle]} » n'est pas un item bloquant actif du modèle.`,
    );
  }
  if (item.etat === "conforme") {
    throw new AppError(409, "DEROGATION_SANS_OBJET", "Cet item est déjà conforme.");
  }
  if (item.derogation) {
    throw new AppError(
      409,
      "DEROGATION_EXISTANTE",
      "Une dérogation est déjà en vigueur pour cet item.",
    );
  }
  await db.query(
    `INSERT INTO cloture_derogations (cabinet_id, mission_id, controle, action, motif, par)
     VALUES ($1, $2, $3, 'accordee', $4, $5)`,
    [auth.cabinetId, missionId, c.controle, c.motif, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "derogation_cloture",
    entite: "mission",
    entiteId: missionId,
    details: { controle: c.controle, motif: c.motif },
  });
}

export async function retirerDerogation(
  db: Db,
  auth: Auth,
  missionId: string,
  controle: ControleCloture,
  brut: unknown,
): Promise<void> {
  const c = retraitDerogationClotureSchema.parse(brut);
  const evaluation = await evaluerCloture(db, missionId);
  const item = evaluation.items.find((i) => i.controle === controle);
  if (!item?.derogation) {
    throw new AppError(409, "DEROGATION_SANS_OBJET", "Aucune dérogation en vigueur pour cet item.");
  }
  await db.query(
    `INSERT INTO cloture_derogations (cabinet_id, mission_id, controle, action, motif, par)
     VALUES ($1, $2, $3, 'retiree', $4, $5)`,
    [auth.cabinetId, missionId, controle, c.motif, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "retrait_derogation_cloture",
    entite: "mission",
    entiteId: missionId,
    details: { controle, motif: c.motif },
  });
}

/** Attestation (ou retrait d'attestation) d'un contrôle sans donnée à calculer. */
export async function attester(
  db: Db,
  auth: Auth,
  missionId: string,
  brut: unknown,
): Promise<void> {
  const c = attestationClotureSchema.parse(brut);
  const evaluation = await evaluerCloture(db, missionId);
  const item = evaluation.items.find((i) => i.controle === c.controle);
  if (!item?.actif) {
    throw new AppError(409, "ITEM_INACTIF", "Cet item n'est pas actif dans le modèle du cabinet.");
  }
  await db.query(
    `INSERT INTO cloture_verifications
       (cabinet_id, mission_id, controle, resultat, nombre_ecarts, bloquant, origine, declencheur, note, verifie_par)
     VALUES ($1, $2, $3, $4, $5, $6, 'attestation', 'attestation', $7, $8)`,
    [
      auth.cabinetId,
      missionId,
      c.controle,
      c.attestee ? "conforme" : "non_conforme",
      c.attestee ? 0 : null,
      item.bloquant,
      c.note ?? null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "attestation_cloture",
    entite: "mission",
    entiteId: missionId,
    details: { controle: c.controle, attestee: c.attestee },
  });
}
