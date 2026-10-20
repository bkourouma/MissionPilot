import { ROLES_CLIENT } from "@missionpilot/shared";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import type { Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { consentementCourant } from "./consentements.js";
import { mettreEnFileEnvoi } from "./envois.js";
import { dependancesCanauxParDefaut } from "./fabrique.js";
import { nomDuCabinet } from "./synthese.js";

/*
 * Alertes de KPI SORTANTES par WhatsApp vers les responsables INTERNES du cabinet (SPEC-3c §17 O-26,
 * KPI-06). Appelé par `kpi/suivi.ts` APRÈS l'enregistrement d'une alerte et pour le rappel de mesure.
 *
 * - Gabarit `alerte_kpi` (catégorie `alerte`, objet `kpi_alerte`) : le message ne porte que le nom du
 *   cabinet et un lien ; AUCUNE valeur chiffrée, aucun libellé de KPI.
 * - Désactivé par défaut : il faut un compte WhatsApp ACTIF dont l'option `alerte_kpi` est cochée
 *   (`0549`). Seuls les destinataires déjà filtrés par `destinatairesKpiAutorises` sont fournis par
 *   l'appelant ; sont écartés ici les utilisateurs du portail client et ceux sans numéro WhatsApp
 *   vérifié ou sans consentement accordé (rien n'est écrit pour eux). Les plafonds et le
 *   coupe-circuit sont ceux de `mettreEnFileEnvoi` (ligne `bloque` avec son motif).
 * - Clé d'idempotence stable par objet (alerte ou rappel) et par destinataire : un rejeu ne renvoie rien.
 * - Cet envoi ne fait JAMAIS échouer la transaction de suivi : tout le bloc tourne dans un point de
 *   sauvegarde annulé en cas d'erreur, et ne fait que mettre l'envoi en file (le worker `canal_envoi`
 *   parle au port ; aucune E/S réseau ici). Fournisseurs toujours simulés.
 */

/** Lien du gabarit : le moteur n'accepte qu'un chemin `/portail/…` (aucun chemin cabinet n'est admis). */
export const LIEN_ALERTE_KPI = "/portail/";

export type NatureAlerteKpi = "alerte" | "rappel";

export interface DemandeAlerteKpi {
  cabinetId: string;
  /** Identifiant de l'alerte (`kpi_alertes.id`) ou du rappel (`kpi_rappels.id`) : objet et clé. */
  objetId: string;
  nature: NatureAlerteKpi;
  /** Responsables internes déjà autorisés à lire le KPI. */
  utilisateurIds: readonly string[];
  maintenant: Date;
}

/** Canal des alertes de KPI vu du suivi : injecté pour que `suivreKpis` reste testable sans canal. */
export interface CanalAlertesKpi {
  /** Ne lève jamais ; renvoie le nombre d'envois mis en file ou journalisés (bloqués). */
  alerter(db: Db, demande: DemandeAlerteKpi): Promise<number>;
}

/** Ce que le canal exige de son environnement : la configuration (clés de chiffrement des variables). */
export type DependancesAlertesKpi = () => {
  config: Pick<Config, "SESSION_SECRET" | "TFA_MASTER_KEY" | "TFA_MASTER_KEY_PRECEDENTE">;
};

/** Résolution paresseuse : la configuration du processus n'est lue que si une alerte part vraiment. */
export function creerCanalAlertesKpi(
  dependances: DependancesAlertesKpi = dependancesCanauxParDefaut,
): CanalAlertesKpi {
  return {
    async alerter(db, demande) {
      if (demande.utilisateurIds.length === 0) return 0;
      await db.query("SAVEPOINT canal_alerte_kpi");
      try {
        const n = await envoyerAlertes(db, dependances, demande);
        await db.query("RELEASE SAVEPOINT canal_alerte_kpi");
        return n;
      } catch {
        // Le suivi (alertes, rappels, notifications) continue : le bloc canal est annulé seul.
        await db.query("ROLLBACK TO SAVEPOINT canal_alerte_kpi");
        await db.query("RELEASE SAVEPOINT canal_alerte_kpi");
        return 0;
      }
    },
  };
}

async function envoyerAlertes(
  db: Db,
  dependances: DependancesAlertesKpi,
  d: DemandeAlerteKpi,
): Promise<number> {
  const compte = await db.query(
    "SELECT actif, alerte_kpi FROM canaux_comptes WHERE canal = 'whatsapp'",
  );
  if (compte.rows[0]?.actif !== true || compte.rows[0]?.alerte_kpi !== true) return 0;
  const cibles = await db.query(
    `SELECT dest.id AS destinataire_id, dest.utilisateur_id
     FROM canaux_destinataires dest
     JOIN utilisateurs u ON u.id = dest.utilisateur_id AND u.actif AND NOT (u.roles && $2::text[])
     WHERE dest.canal = 'whatsapp' AND dest.verifie_le IS NOT NULL
       AND dest.utilisateur_id = ANY ($1::uuid[])
     ORDER BY dest.id`,
    [[...d.utilisateurIds], [...ROLES_CLIENT]],
  );
  if (cibles.rows.length === 0) return 0;
  const trousseau = trousseauDepuisConfig(dependances().config);
  const nom = await nomDuCabinet(db, d.cabinetId);
  let n = 0;
  for (const cible of cibles.rows as { destinataire_id: string }[]) {
    if ((await consentementCourant(db, cible.destinataire_id)).statut !== "accorde") continue;
    const envoi = await mettreEnFileEnvoi(db, trousseau, {
      cabinetId: d.cabinetId,
      canal: "whatsapp",
      destinataireId: cible.destinataire_id,
      gabarit: "alerte_kpi",
      variables: [nom, LIEN_ALERTE_KPI],
      objetType: "kpi_alerte",
      objetId: d.objetId,
      cle: `kpi_${d.nature}:${d.objetId}:${cible.destinataire_id}`,
      maintenant: d.maintenant,
    });
    if (envoi && !envoi.existant) n += 1;
  }
  return n;
}
