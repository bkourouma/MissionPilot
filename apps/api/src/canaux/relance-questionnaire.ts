import { z } from "zod";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import type { Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import { repondantsEnAttente } from "../questionnaires/relances.js";
import { consentementCourant } from "./consentements.js";
import { mettreEnFileEnvoi } from "./envois.js";
import type { DependancesCanaux } from "./fabrique.js";
import { nomDuCabinet } from "./synthese.js";

/*
 * Relance J+10 d'un questionnaire sans réponse par WhatsApp (PRD complémentaire §8.2, CLI-02, SPEC-3c
 * §7.3). UN job de plus est mis en file à l'envoi du questionnaire (`planifierRelances`), à
 * `envoye_le` + 10 jours. L'alerte au chef de mission existe déjà (palier 10) : pas de doublon.
 * Classe R0 vers le client : soumise au coupe-circuit N4 (`mettreEnFileEnvoi` bloque l'envoi). Le
 * message n'a NI titre de questionnaire, NI nom, NI mission : il ouvre le portail, qui exige la
 * connexion (aucun lien « magique »).
 */

export const TYPE_JOB_CANAL_RELANCE_QUESTIONNAIRE = "canal_relance_questionnaire";
export const JOURS_RELANCE_WHATSAPP = 10;

const chargeSchema = z.object({ envoi_id: z.string().uuid() }).strict();

/**
 * Met en file le job J+10 d'un envoi (dans la transaction de l'envoi, une fois par envoi), si le
 * cabinet a un compte WhatsApp actif avec cette option : un questionnaire envoyé avant l'activation
 * du canal ne reçoit pas de J+10 (O-25).
 */
export async function planifierRelanceWhatsApp(
  db: Db,
  cabinetId: string,
  envoiId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
     SELECT $1, $2, $3, e.envoye_le + make_interval(days => $4::int), $5, 3
     FROM questionnaire_envois e
     WHERE e.id = $6
       AND EXISTS (SELECT 1 FROM canaux_comptes k WHERE k.canal = 'whatsapp' AND k.actif
                   AND k.relance_questionnaire_j10)
     ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING`,
    [
      cabinetId,
      TYPE_JOB_CANAL_RELANCE_QUESTIONNAIRE,
      JSON.stringify({ envoi_id: envoiId }),
      JOURS_RELANCE_WHATSAPP,
      `questionnaire_j10:${envoiId}`,
      envoiId,
    ],
  );
}

export function creerHandlerCanalRelanceQuestionnaire(
  dependances: () => DependancesCanaux,
): HandlerJob {
  return async ({ db, cabinetId, charge, maintenant }) => {
    const c = chargeSchema.safeParse(charge);
    if (!c.success) throw new ErreurJobDefinitive("Charge de relance J+10 invalide.");
    const { config } = dependances();
    const e = await db.query(
      `SELECT e.id, e.mode, e.statut, e.relances_auto, m.statut AS mission_statut
       FROM questionnaire_envois e JOIN missions m ON m.id = e.mission_id
       WHERE e.id = $1 FOR UPDATE OF e`,
      [c.data.envoi_id],
    );
    const envoi = e.rows[0] as
      | {
          id: string;
          mode: "individuel" | "collectif" | "par_fonction";
          statut: string;
          relances_auto: boolean;
          mission_statut: string;
        }
      | undefined;
    if (!envoi || envoi.statut !== "envoye" || !envoi.relances_auto) return [];
    if (envoi.mission_statut === "cloturee") return [];
    const compte = await db.query(
      "SELECT actif, relance_questionnaire_j10 FROM canaux_comptes WHERE canal = 'whatsapp'",
    );
    if (compte.rows[0]?.actif !== true || compte.rows[0]?.relance_questionnaire_j10 !== true) {
      return [];
    }
    const trousseau = trousseauDepuisConfig(config);
    const nom = await nomDuCabinet(db, cabinetId);
    for (const cible of await repondantsEnAttente(db, envoi)) {
      const d = await db.query(
        `SELECT id FROM canaux_destinataires
         WHERE utilisateur_id = $1 AND canal = 'whatsapp' AND verifie_le IS NOT NULL`,
        [cible.utilisateur_id],
      );
      const destinataireId = d.rows[0]?.id as string | undefined;
      if (!destinataireId) continue;
      if ((await consentementCourant(db, destinataireId)).statut !== "accorde") continue;
      await mettreEnFileEnvoi(db, trousseau, {
        cabinetId,
        canal: "whatsapp",
        destinataireId,
        gabarit: "relance_questionnaire_j10",
        variables: [nom, `/portail/questionnaires/${envoi.id}`],
        objetType: "questionnaire_envoi",
        objetId: envoi.id,
        cle: `q_j10:${envoi.id}:${cible.repondant_id}`,
        maintenant,
      });
    }
    return [];
  };
}
