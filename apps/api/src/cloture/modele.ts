import {
  CONTROLES_CLOTURE,
  CONTROLE_CLOTURE_DEFAUTS,
  CONTROLE_CLOTURE_DESCRIPTIONS,
  CONTROLE_CLOTURE_LIBELLES,
  CONTROLES_PAR_ATTESTATION,
  modeleClotureSchema,
  type ControleCloture,
  type ItemModeleCloture,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";

/*
 * Modèle de check-list de clôture du cabinet (AUT-08). Un item par contrôle nommé ; sans ligne,
 * les valeurs par défaut du code s'appliquent. Un item inactif ne bloque jamais (règle doublée
 * par un CHECK en base). Paramétrage : `cabinet.gerer`, journalisé.
 */

export interface ItemModele extends ItemModeleCloture {
  libelle: string;
  description: string;
  par_attestation: boolean;
  /** Vrai tant que le cabinet n'a pas enregistré ce réglage (valeur par défaut du code). */
  par_defaut: boolean;
}

export async function lireModele(db: Db): Promise<ItemModele[]> {
  const r = await db.query(`SELECT controle, actif, bloquant FROM cloture_modele_items`);
  const reglages = new Map<string, { actif: boolean; bloquant: boolean }>(
    r.rows.map((l) => [l.controle as string, { actif: l.actif, bloquant: l.bloquant }]),
  );
  return CONTROLES_CLOTURE.map((controle) => {
    const reglage = reglages.get(controle);
    const { actif, bloquant } = reglage ?? CONTROLE_CLOTURE_DEFAUTS[controle];
    return {
      controle,
      actif,
      bloquant: actif && bloquant,
      libelle: CONTROLE_CLOTURE_LIBELLES[controle],
      description: CONTROLE_CLOTURE_DESCRIPTIONS[controle],
      par_attestation: CONTROLES_PAR_ATTESTATION.includes(controle),
      par_defaut: reglage === undefined,
    };
  });
}

export async function enregistrerModele(db: Db, auth: Auth, brut: unknown): Promise<ItemModele[]> {
  const corps = modeleClotureSchema.parse(brut);
  for (const i of corps.items) {
    await db.query(
      `INSERT INTO cloture_modele_items (cabinet_id, controle, actif, bloquant, modifie_par)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cabinet_id, controle)
       DO UPDATE SET actif = EXCLUDED.actif, bloquant = EXCLUDED.bloquant,
                     modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
      [auth.cabinetId, i.controle, i.actif, i.bloquant, auth.utilisateurId],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modele_cloture",
    entite: "cloture_modele",
    details: { items: corps.items satisfies ItemModeleCloture[] },
  });
  return lireModele(db);
}

export type { ControleCloture };
