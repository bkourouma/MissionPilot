import type { ContexteTenantDemo } from "../contexte.js";
import { lire } from "../notation-plans/outils.js";
import { appliquerSql, midi } from "./commun.js";

/*
 * Dates de la notation de la mission 3 « Brasseries du Wouri » (redressement-m3-renotation.ts).
 * Les routes horodatent « maintenant » : les colonnes de dates des lignes écrites par le parcours
 * (envoi de questionnaire, réponses, version, ajustements, événements, indice de confiance, suivi
 * qualité) sont remontées par des requêtes LITTÉRALES (nom de table en dur, filtre par uuid),
 * uniquement pour la chronologie, jamais pour contourner une règle métier.
 *
 * Deux parcours sont datés : la version 2 « après redressement » (octobre-novembre 2025, avant le
 * bilan de clôture du 11 novembre) et, si l'étape « notation-plans » ne l'a pas déjà fait, la
 * version 1 (mars-avril 2025, `version1SiNecessaire`), pour que la 2 ne précède jamais la 1.
 */

/** Jours (ISO) d'un parcours de notation, dans l'ordre chronologique. */
export interface JoursParcours {
  envoi: string;
  /** Un jour par répondant (dans l'ordre des répondants de l'envoi). */
  reponses: readonly [string, string, string];
  limite: string;
  clos: string;
  calcul: string;
  ajustements: string;
  soumission: string;
  revue: string;
  signature: string;
  publication: string;
}

export const JOURS_RENOTATION: JoursParcours = {
  envoi: "2025-10-06",
  reponses: ["2025-10-08", "2025-10-10", "2025-10-14"],
  limite: "2025-10-24",
  clos: "2025-10-27",
  calcul: "2025-11-03",
  ajustements: "2025-11-04",
  soumission: "2025-11-05",
  revue: "2025-11-06",
  signature: "2025-11-07",
  publication: "2025-11-07",
};

/** Version 1 (mars-avril 2025), antidatée seulement si elle porte encore la date du semis. */
export const JOURS_VERSION_1: JoursParcours = {
  envoi: "2025-03-12",
  reponses: ["2025-03-18", "2025-03-21", "2025-03-25"],
  limite: "2025-04-11",
  clos: "2025-04-11",
  calcul: "2025-04-14",
  ajustements: "2025-04-15",
  soumission: "2025-04-16",
  revue: "2025-04-17",
  signature: "2025-04-18",
  publication: "2025-04-18",
};

const heure = (jour: string, h: number): string =>
  midi(jour).replace("T12:", `T${String(h).padStart(2, "0")}:`);

async function envoi(ctx: ContexteTenantDemo, envoiId: string, j: JoursParcours): Promise<void> {
  await appliquerSql(
    ctx,
    `UPDATE questionnaire_envois SET cree_le = $1::timestamptz, envoye_le = $1::timestamptz,
            clos_le = $2::timestamptz WHERE id = $3`,
    [heure(j.envoi, 9), midi(j.clos), envoiId],
  );
  await appliquerSql(
    ctx,
    "UPDATE questionnaire_repondants SET ajoute_le = $1::timestamptz WHERE envoi_id = $2",
    [heure(j.envoi, 9), envoiId],
  );
  const reponses = await lire<{ id: string }>(
    ctx,
    "SELECT id FROM questionnaire_reponses WHERE envoi_id = $1 ORDER BY soumise_le, id",
    [envoiId],
  );
  for (const [i, r] of reponses.entries()) {
    const jour = j.reponses[Math.min(i, j.reponses.length - 1)] as string;
    await appliquerSql(
      ctx,
      `UPDATE questionnaire_reponses SET modifie_le = $1::timestamptz, soumise_le = $1::timestamptz
        WHERE id = $2`,
      [midi(jour), r.id],
    );
  }
}

/** Lignes de la version `numero` de la notation et de son suivi qualité (si ouvert). */
async function version(
  ctx: ContexteTenantDemo,
  notationId: string,
  numero: number,
  suiviId: string | null,
  j: JoursParcours,
): Promise<void> {
  const [v] = await lire<{ id: string }>(
    ctx,
    "SELECT id FROM notation_versions WHERE notation_id = $1 AND numero = $2",
    [notationId, numero],
  );
  if (!v) throw new Error(`Version ${numero} de la notation introuvable pour la dater.`);
  await appliquerSql(
    ctx,
    "UPDATE notation_versions SET calcule_le = $1::timestamptz WHERE id = $2",
    [midi(j.calcul), v.id],
  );
  await appliquerSql(
    ctx,
    `UPDATE notation_ajustements SET date_ajustement = $1::date, cree_le = $2::timestamptz
      WHERE version_id = $3`,
    [j.ajustements, midi(j.ajustements), v.id],
  );
  await appliquerSql(
    ctx,
    "UPDATE notation_evenements SET le = $1::timestamptz WHERE version_id = $2 AND action = 'soumission'",
    [midi(j.soumission), v.id],
  );
  await appliquerSql(
    ctx,
    "UPDATE notation_evenements SET le = $1::timestamptz WHERE version_id = $2 AND action = 'publication'",
    [heure(j.publication, 15), v.id],
  );
  await appliquerSql(
    ctx,
    "UPDATE notation_confiances SET cree_le = $1::timestamptz WHERE version_id = $2",
    [heure(j.publication, 15), v.id],
  );
  if (suiviId) await suivi(ctx, suiviId, j);
}

/** Suivi qualité : ouvert à la soumission, revu la veille, signé le jour de la publication. */
async function suivi(ctx: ContexteTenantDemo, suiviId: string, j: JoursParcours): Promise<void> {
  const ouvert = midi(j.soumission);
  const revue = midi(j.revue);
  const signe = heure(j.signature, 10);
  await appliquerSql(
    ctx,
    "UPDATE qualite_suivis SET ouvert_le = $1::timestamptz, modifie_le = $2::timestamptz WHERE id = $3",
    [ouvert, signe, suiviId],
  );
  await appliquerSql(
    ctx,
    "UPDATE qualite_evenements SET le = $1::timestamptz + rang * interval '1 minute' WHERE suivi_id = $2",
    [ouvert, suiviId],
  );
  await appliquerSql(
    ctx,
    "UPDATE qualite_verifications SET le = $1::timestamptz WHERE suivi_id = $2",
    [ouvert, suiviId],
  );
  await appliquerSql(
    ctx,
    "UPDATE qualite_revue_elements SET cree_le = $1::timestamptz WHERE suivi_id = $2",
    [ouvert, suiviId],
  );
  await appliquerSql(
    ctx,
    "UPDATE qualite_revue_vus SET vu_le = $1::timestamptz WHERE suivi_id = $2",
    [revue, suiviId],
  );
  await appliquerSql(
    ctx,
    `UPDATE qualite_revue_sessions SET debut = $1::timestamptz,
            fin = CASE WHEN fin IS NULL THEN NULL ELSE $1::timestamptz + interval '1 hour' END
      WHERE suivi_id = $2`,
    [revue, suiviId],
  );
  await appliquerSql(
    ctx,
    "UPDATE qualite_validations SET valide_le = $1::timestamptz WHERE suivi_id = $2",
    [revue, suiviId],
  );
  await appliquerSql(
    ctx,
    "UPDATE qualite_signatures SET signe_le = $1::timestamptz WHERE suivi_id = $2",
    [signe, suiviId],
  );
}

export const dateursRenotation = {
  envoi: (ctx: ContexteTenantDemo, envoiId: string) => envoi(ctx, envoiId, JOURS_RENOTATION),
  version: (ctx: ContexteTenantDemo, notationId: string, numero: number, suiviId: string | null) =>
    version(ctx, notationId, numero, suiviId, JOURS_RENOTATION),
  /** Antidate la version 1 (envoi compris) si elle porte encore la date du semis (après 2025). */
  async version1SiNecessaire(
    ctx: ContexteTenantDemo,
    notationId: string,
    envoiId: string,
    suiviId: string | null,
  ): Promise<boolean> {
    const [v] = await lire<{ recent: boolean }>(
      ctx,
      `SELECT calcule_le > '2026-01-01'::timestamptz AS recent FROM notation_versions
        WHERE notation_id = $1 AND numero = 1`,
      [notationId],
    );
    if (!v?.recent) return false;
    await envoi(ctx, envoiId, JOURS_VERSION_1);
    await version(ctx, notationId, 1, suiviId, JOURS_VERSION_1);
    return true;
  },
};
