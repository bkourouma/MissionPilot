import {
  detecterEcarts,
  progression,
  validerRepondants,
  type DefinitionQuestionnaire,
  type Reponses,
} from "@missionpilot/engines";
import type { EnvoiQuestionnaireCreation } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { clauseSet } from "../db/outils.js";
import { conflit, introuvable, requeteInvalide } from "../errors.js";
import { paginer } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { exigerEnvoiVisible, exigerMissionOuverte, type Envoi } from "./acces.js";
import { notifierRepondant, planifierRelances } from "./relances.js";

/*
 * Envois de questionnaires (SOC-10) côté cabinet : création en brouillon
 * avec la liste des répondants (utilisateurs du portail du client de la
 * mission, contrôlés ici ET par déclencheur, 0141), envoi (notification et
 * e-mail aux répondants, relances J+3 et J+7 en file), clôture, progression
 * et complétude (moteur `progression`), lecture des réponses SOUMISES
 * seulement (les brouillons du client ne sont pas lus par le cabinet, seule
 * leur progression l'est), écarts entre répondants (moteur `detecterEcarts`).
 */

/**
 * Utilisateurs du portail désignables comme répondants pour le client `$1` :
 * rattachement actif, utilisateur actif au rôle de dirigeant ou de
 * contributeur client, client actif (doublé à l'insertion par 0141).
 */
const PORTAIL_ELIGIBLE = `utilisateurs_portail up
  JOIN utilisateurs u ON u.id = up.utilisateur_id AND u.actif
    AND u.roles && ARRAY['client_dirigeant', 'client_contributeur']
  JOIN clients c ON c.id = up.client_id AND c.actif`;
const FILTRE_PORTAIL_ELIGIBLE = "up.client_id = $1 AND up.statut = 'actif'";

/**
 * Répondants désignables pour une mission ouverte (page par curseur, par
 * nom) : projection fermée {id, nom, email, roles}. Mission invisible ou
 * d'un autre cabinet : 404 ; clôturée : 409 (comme la création d'un envoi).
 */
export async function repondantsEligibles(
  db: Db,
  auth: Auth,
  missionId: string,
  apres: [string, string] | null,
  limite: number,
) {
  const mission = await exigerMissionOuverte(db, auth, missionId);
  const r = await db.query(
    `SELECT u.id, u.nom, u.email, u.roles, lower(u.nom) AS cle_tri
     FROM ${PORTAIL_ELIGIBLE}
     WHERE ${FILTRE_PORTAIL_ELIGIBLE} AND ($2::text IS NULL OR (lower(u.nom), u.id) > ($2, $3::uuid))
     ORDER BY lower(u.nom), u.id LIMIT $4`,
    [mission.client_id, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return paginer(
    r.rows as { id: string; nom: string; email: string; roles: string[]; cle_tri: string }[],
    limite,
  );
}

/** Crée un envoi en brouillon pour la mission, avec ses répondants. */
export async function creerEnvoi(
  db: Db,
  auth: Auth,
  missionId: string,
  corps: EnvoiQuestionnaireCreation,
) {
  const mission = await exigerMissionOuverte(db, auth, missionId);
  const v = await db.query(
    "SELECT id, statut, definition FROM questionnaire_versions WHERE id = $1",
    [corps.version_id],
  );
  const version = v.rows[0] as
    { id: string; statut: string; definition: DefinitionQuestionnaire } | undefined;
  if (!version) throw introuvable("Version de questionnaire");
  if (version.statut !== "valide") throw conflit("Seule une version validée s'envoie.");
  const repondants = validerRepondants(
    corps.mode,
    corps.repondants.map((r) => ({
      id: r.utilisateur_id,
      ...(r.fonction ? { fonction: r.fonction } : {}),
    })),
  );
  const ids = repondants.map((r) => r.id);
  const eligibles = await db.query(
    `SELECT up.utilisateur_id FROM ${PORTAIL_ELIGIBLE}
     WHERE ${FILTRE_PORTAIL_ELIGIBLE} AND up.utilisateur_id = ANY($2::uuid[])`,
    [mission.client_id, ids],
  );
  if (eligibles.rowCount !== ids.length) {
    throw requeteInvalide(
      "Chaque répondant doit être un dirigeant ou un contributeur actif du portail du client de la mission.",
    );
  }
  const e = await db.query(
    `INSERT INTO questionnaire_envois (cabinet_id, mission_id, client_id, version_id, definition,
       titre, mode, relances_auto, date_limite, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      mission.client_id,
      version.id,
      JSON.stringify(version.definition),
      version.definition.titre,
      corps.mode,
      corps.relances_auto,
      corps.date_limite ?? null,
      auth.utilisateurId,
    ],
  );
  const envoiId = e.rows[0].id as string;
  for (const r of repondants) {
    await db.query(
      `INSERT INTO questionnaire_repondants (cabinet_id, envoi_id, utilisateur_id, client_id, fonction, ajoute_par)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.cabinetId, envoiId, r.id, mission.client_id, r.fonction ?? null, auth.utilisateurId],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "questionnaire_envoi",
    entiteId: envoiId,
    details: { mission_id: missionId, version_id: version.id, mode: corps.mode, repondants: ids },
  });
  return detailEnvoi(db, await exigerEnvoiVisible(db, auth, envoiId));
}

interface LigneRepondant {
  id: string;
  utilisateur_id: string;
  nom: string;
  email: string;
  fonction: string | null;
  reponse_statut: "brouillon" | "soumise" | null;
  reponses: Reponses | null;
  soumise_le: Date | null;
  modifie_le: Date | null;
  relances: number;
  derniere_relance: Date | null;
}

const vueProgression = (def: DefinitionQuestionnaire, reponses: Reponses | null) => {
  const p = progression(def, reponses ?? {});
  return {
    pourcentage: p.pourcentage,
    complet: p.complet,
    questions_visibles: p.questionsVisibles,
    questions_repondues: p.questionsRepondues,
    obligatoires_visibles: p.obligatoiresVisibles,
    obligatoires_repondues: p.obligatoiresRepondues,
  };
};

/** Détail d'un envoi : répondants, état de leur réponse, progression, relances, complétude. */
export async function detailEnvoi(db: Db, envoi: Envoi) {
  const def = envoi.definition as DefinitionQuestionnaire;
  const collectif = envoi.mode === "collectif";
  const r = await db.query(
    `SELECT r.id, r.utilisateur_id, u.nom, u.email, r.fonction,
       q.statut AS reponse_statut, q.reponses, q.soumise_le, q.modifie_le,
       (SELECT count(*)::int FROM questionnaire_relances x WHERE x.repondant_id = r.id) AS relances,
       (SELECT max(x.relance_le) FROM questionnaire_relances x WHERE x.repondant_id = r.id) AS derniere_relance
     FROM questionnaire_repondants r JOIN utilisateurs u ON u.id = r.utilisateur_id
     LEFT JOIN questionnaire_reponses q ON q.repondant_id = r.id
     WHERE r.envoi_id = $1 ORDER BY r.ajoute_le, r.id`,
    [envoi.id],
  );
  const lignes = r.rows as LigneRepondant[];
  const c = collectif
    ? await db.query(
        `SELECT q.statut, q.reponses, q.soumise_le, q.modifie_le, u.nom AS soumise_par_nom
         FROM questionnaire_reponses q LEFT JOIN utilisateurs u ON u.id = q.soumise_par
         WHERE q.envoi_id = $1 AND q.repondant_id IS NULL`,
        [envoi.id],
      )
    : null;
  const commune = c?.rows[0] as
    | {
        statut: string;
        reponses: Reponses;
        soumise_le: Date | null;
        modifie_le: Date;
        soumise_par_nom: string | null;
      }
    | undefined;
  const repondants = lignes.map((l) => ({
    id: l.id,
    utilisateur_id: l.utilisateur_id,
    nom: l.nom,
    email: l.email,
    fonction: l.fonction,
    relances: l.relances,
    derniere_relance: l.derniere_relance,
    ...(collectif
      ? {}
      : {
          statut: l.reponse_statut ?? "non_commence",
          soumise_le: l.soumise_le,
          derniere_saisie: l.modifie_le,
          progression: vueProgression(def, l.reponses),
        }),
  }));
  const soumis = collectif
    ? commune?.statut === "soumise"
      ? 1
      : 0
    : lignes.filter((l) => l.reponse_statut === "soumise").length;
  const attendus = collectif ? 1 : lignes.length;
  return {
    id: envoi.id,
    mission_id: envoi.mission_id,
    client_id: envoi.client_id,
    version_id: envoi.version_id,
    titre: envoi.titre,
    mode: envoi.mode,
    statut: envoi.statut,
    relances_auto: envoi.relances_auto,
    date_limite: envoi.date_limite,
    cree_le: envoi.cree_le,
    envoye_le: envoi.envoye_le,
    clos_le: envoi.clos_le,
    definition: envoi.definition,
    repondants,
    reponse_collective: collectif
      ? {
          statut: commune?.statut ?? "non_commence",
          soumise_le: commune?.soumise_le ?? null,
          soumise_par_nom: commune?.soumise_par_nom ?? null,
          derniere_saisie: commune?.modifie_le ?? null,
          progression: vueProgression(def, commune?.reponses ?? null),
        }
      : null,
    completude: { attendues: attendus, soumises: soumis, complet: soumis === attendus },
  };
}

/** Envoie un questionnaire en brouillon : notification et e-mail aux répondants, relances en file. */
export async function envoyerEnvoi(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ notifications: (NotificationCreee | null)[] }> {
  const envoi = await exigerEnvoiVisible(db, auth, id, true);
  await exigerMissionOuverte(db, auth, envoi.mission_id);
  if (envoi.statut !== "brouillon") throw conflit("Ce questionnaire est déjà envoyé.");
  await db.query(
    `UPDATE questionnaire_envois SET statut = 'envoye', envoye_par = $2, envoye_le = now()
     WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await planifierRelances(db, auth.cabinetId, id);
  const r = await db.query(
    "SELECT utilisateur_id FROM questionnaire_repondants WHERE envoi_id = $1 ORDER BY ajoute_le, id",
    [id],
  );
  const notifications: (NotificationCreee | null)[] = [];
  for (const l of r.rows) {
    notifications.push(
      await notifierRepondant(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: l.utilisateur_id as string,
        envoi,
        relance: false,
      }),
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "envoi",
    entite: "questionnaire_envoi",
    entiteId: id,
    details: { repondants: r.rowCount },
  });
  return { notifications };
}

/** Relances automatiques (activer/désactiver) et date limite ; refusé sur un envoi clos. */
export async function modifierEnvoi(
  db: Db,
  auth: Auth,
  id: string,
  modif: { relances_auto?: boolean; date_limite?: string | null },
) {
  const envoi = await exigerEnvoiVisible(db, auth, id, true);
  await exigerMissionOuverte(db, auth, envoi.mission_id);
  if (envoi.statut === "clos") throw conflit("Ce questionnaire est clos.");
  const set = clauseSet(modif, 2);
  await db.query(`UPDATE questionnaire_envois SET ${set.sql} WHERE id = $1`, [id, ...set.valeurs]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification",
    entite: "questionnaire_envoi",
    entiteId: id,
    details: modif,
  });
}

/** Clôture : plus aucune saisie ni relance. */
export async function cloreEnvoi(db: Db, auth: Auth, id: string) {
  const envoi = await exigerEnvoiVisible(db, auth, id, true);
  await exigerMissionOuverte(db, auth, envoi.mission_id);
  if (envoi.statut !== "envoye") throw conflit("Seul un questionnaire envoyé se clôt.");
  await db.query(
    "UPDATE questionnaire_envois SET statut = 'clos', clos_par = $2, clos_le = now() WHERE id = $1",
    [id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "cloture",
    entite: "questionnaire_envoi",
    entiteId: id,
  });
}

/** Envois d'une mission visible (page par curseur, plus récents d'abord). */
export async function listerEnvoisMission(
  db: Db,
  auth: Auth,
  missionId: string,
  apres: [string, string] | null,
  limite: number,
) {
  await exigerMissionVisible(db, auth, missionId);
  const cle = `to_char(e.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
  const r = await db.query(
    `SELECT e.id, e.titre, e.mode, e.statut, e.relances_auto, e.date_limite::text AS date_limite,
       e.cree_le, e.envoye_le, e.clos_le, e.version_id,
       (SELECT count(*)::int FROM questionnaire_repondants r WHERE r.envoi_id = e.id) AS repondants,
       (SELECT count(*)::int FROM questionnaire_reponses q WHERE q.envoi_id = e.id
        AND q.statut = 'soumise') AS reponses_soumises,
       ${cle} AS cle_tri
     FROM questionnaire_envois e
     WHERE e.mission_id = $1 AND ($2::text IS NULL OR (${cle}, e.id) < ($2, $3::uuid))
     ORDER BY cle_tri DESC, e.id DESC LIMIT $4`,
    [missionId, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return r.rows as { cle_tri: string; id: string }[];
}

interface ReponseSoumise {
  id: string;
  repondant_id: string | null;
  utilisateur_id: string | null;
  nom: string | null;
  fonction: string | null;
  reponses: Reponses;
  soumise_le: Date;
  soumise_par_nom: string;
}

/** Réponses SOUMISES d'un envoi (les brouillons du client ne sont pas servis). */
export async function reponsesSoumises(db: Db, envoiId: string): Promise<ReponseSoumise[]> {
  const r = await db.query(
    `SELECT q.id, q.repondant_id, r.utilisateur_id, u.nom, r.fonction, q.reponses, q.soumise_le,
       su.nom AS soumise_par_nom
     FROM questionnaire_reponses q
     LEFT JOIN questionnaire_repondants r ON r.id = q.repondant_id
     LEFT JOIN utilisateurs u ON u.id = r.utilisateur_id
     JOIN utilisateurs su ON su.id = q.soumise_par
     WHERE q.envoi_id = $1 AND q.statut = 'soumise' ORDER BY q.soumise_le, q.id`,
    [envoiId],
  );
  return r.rows as ReponseSoumise[];
}

/** Écarts entre répondants (NOT-05, partie déterministe du moteur) sur les réponses soumises. */
export async function ecartsEnvoi(db: Db, envoi: Envoi, seuil: number | undefined) {
  if (envoi.mode === "collectif") return { seuil: seuil ?? null, ecarts: [] };
  const soumises = await reponsesSoumises(db, envoi.id);
  const parId = new Map(
    soumises.map((s) => [
      s.repondant_id as string,
      { id: s.repondant_id, nom: s.nom, fonction: s.fonction },
    ]),
  );
  const ecarts = detecterEcarts(
    envoi.definition as DefinitionQuestionnaire,
    soumises.map((s) => ({ repondant: s.repondant_id as string, reponses: s.reponses })),
    seuil === undefined ? {} : { seuil },
  );
  return {
    seuil: seuil ?? null,
    ecarts: ecarts.map((e) => ({
      question: e.question,
      libelle: e.libelle,
      min: e.min,
      max: e.max,
      ecart: e.ecart,
      nombre_repondants: e.nombreRepondants,
      repondants_min: e.repondantsMin.map((id) => parId.get(id)),
      repondants_max: e.repondantsMax.map((id) => parId.get(id)),
    })),
  };
}
