import { validerPayloadEvenement } from "@missionpilot/engines";
import { evenementDuCatalogue, type CodeEvenementAutomatisation } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { champsMoteur } from "./definitions.js";
import { journaliserIncident } from "./diagnostic.js";

/*
 * PUBLICATION D'UN ÉVÉNEMENT MÉTIER (AUT-01) — service interne des modules.
 *
 * `publierEvenement(db, auth | "systeme", { code, payload, cle })`, dans la transaction du
 * module (contexte RLS de son cabinet) :
 * - IDEMPOTENT : la clé (préfixée du code) est unique par cabinet ; republier ne crée ni un
 *   second événement ni un second traitement ;
 * - NON BLOQUANT : ne lève jamais ; tout refus ou incident revient dans `erreur` et le
 *   SAVEPOINT annule la seule publication, jamais l'écriture du module ;
 * - ASYNCHRONE : si une automatisation ACTIVE écoute ce code, un job
 *   `automatisation_evenement` (clé unique) est mis en file ; les actions s'exécutent plus
 *   tard, dans le worker, avec la garde du moteur ;
 * - contenu VALIDÉ contre les champs déclarés du catalogue (aucun champ libre, aucun objet) ;
 *   jamais publié depuis une transaction du portail client.
 * La base publie elle-même les événements des modules existants (0302) par la même table.
 */

export type OrigineEvenement = Auth | "systeme";

export interface EvenementAPublier {
  code: CodeEvenementAutomatisation;
  payload: Readonly<Record<string, unknown>>;
  /** Clé d'idempotence propre au module (ex. identifiant de l'objet et palier). */
  cle: string;
}

export type ErreurPublication =
  | "EVENEMENT_INCONNU"
  | "PAYLOAD_INVALIDE"
  | "CLE_INVALIDE"
  | "CONTEXTE_PORTAIL"
  | "ERREUR_PUBLICATION";

export interface ResultatPublication {
  evenement_id: string | null;
  /** Faux si l'événement existait déjà (même clé). */
  nouveau: boolean;
  /** Un traitement a été mis en file. */
  en_file: boolean;
  erreur: ErreurPublication | null;
}

export const TYPE_JOB_EVENEMENT_AUTOMATISATION = "automatisation_evenement";
const CLE = /^[A-Za-z0-9_.:-]{1,200}$/;

const echec = (erreur: ErreurPublication): ResultatPublication => ({
  evenement_id: null,
  nouveau: false,
  en_file: false,
  erreur,
});

/** Met en file le traitement d'un événement si une automatisation active l'écoute. */
export async function mettreEnFileSiEcoute(
  db: Db,
  evenementId: string,
  code: string,
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO jobs (cabinet_id, type, charge, cle)
     SELECT app_cabinet_id(), $1, jsonb_build_object('evenement_id', $2::uuid), $3
     WHERE EXISTS (SELECT 1 FROM automatisations a WHERE a.active AND a.evenement_code = $4)
     ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING RETURNING id`,
    [
      TYPE_JOB_EVENEMENT_AUTOMATISATION,
      evenementId,
      `${TYPE_JOB_EVENEMENT_AUTOMATISATION}:${evenementId}`,
      code,
    ],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function publierEvenement(
  db: Db,
  origine: OrigineEvenement,
  e: EvenementAPublier,
): Promise<ResultatPublication> {
  const definition = evenementDuCatalogue(e.code);
  if (!definition) return echec("EVENEMENT_INCONNU");
  if (validerPayloadEvenement(e.payload, champsMoteur(e.code)).length > 0) {
    return echec("PAYLOAD_INVALIDE");
  }
  if (typeof e.cle !== "string" || !CLE.test(e.cle)) return echec("CLE_INVALIDE");
  const acteur = origine === "systeme" ? null : origine.utilisateurId;
  const missionId = typeof e.payload.mission_id === "string" ? e.payload.mission_id : null;
  await db.query("SAVEPOINT automatisation_publication");
  try {
    const portail = await db.query("SELECT app_portail_client_id() IS NOT NULL AS portail");
    if (portail.rows[0].portail) {
      await db.query("RELEASE SAVEPOINT automatisation_publication");
      return echec("CONTEXTE_PORTAIL");
    }
    const r = await db.query(
      `INSERT INTO automatisation_evenements (cabinet_id, code, payload, cle, source, acteur_id,
         mission_id)
       VALUES (app_cabinet_id(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (cabinet_id, cle) DO NOTHING RETURNING id`,
      [
        e.code,
        JSON.stringify(e.payload),
        `${e.code}:${e.cle}`,
        acteur ? "utilisateur" : "systeme",
        acteur,
        missionId,
      ],
    );
    let id = (r.rows[0]?.id as string | undefined) ?? null;
    const nouveau = id !== null;
    let enFile = false;
    if (nouveau) {
      enFile = await mettreEnFileSiEcoute(db, id as string, e.code);
    } else {
      const existant = await db.query("SELECT id FROM automatisation_evenements WHERE cle = $1", [
        `${e.code}:${e.cle}`,
      ]);
      id = (existant.rows[0]?.id as string | undefined) ?? null;
    }
    await db.query("RELEASE SAVEPOINT automatisation_publication");
    return { evenement_id: id, nouveau, en_file: enFile, erreur: null };
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT automatisation_publication");
    await db.query("RELEASE SAVEPOINT automatisation_publication");
    // Non bloquant pour le module, mais jamais silencieux : le motif (message, SQLSTATE,
    // contrainte) est consigné côté serveur, sans le contenu de l'événement.
    journaliserIncident("publication", error, { evenement: e.code });
    return echec("ERREUR_PUBLICATION");
  }
}
