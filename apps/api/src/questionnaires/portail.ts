import type { FastifyInstance } from "fastify";
import {
  exigerReponsesValides,
  fusionnerReponses,
  progression,
  soumettreReponses,
  validerReponses,
  ErreurQuestionnaire,
  type DefinitionQuestionnaire,
  type ReponseCollective,
  type Reponses,
  type Signature,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { conflit } from "../errors.js";
import { paginer } from "../http/outils.js";
import { aujourdhui } from "../missions/outils.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { avecPortail, introuvablePortail, type AccesPortail } from "../portail/acces.js";

/*
 * Réponses aux questionnaires depuis le portail client (SOC-09, SOC-10).
 *
 * RÈGLES (testées dans test/questionnaires-portail.test.ts) :
 * 1. Toute transaction pose, en plus du cabinet et du client
 *    (`avecPortail`), l'utilisateur du portail (`app.portail_utilisateur_id`) :
 *    les politiques RESTRICTIVES de la migration 0143 ne laissent voir que
 *    SES désignations, les envois envoyés ou clos où il est répondant et SA
 *    réponse (ou la réponse collective de ces envois). Chaque requête filtre
 *    EN PLUS explicitement sur le client et l'utilisateur (double barrière).
 * 2. Inexistant, d'un autre client, d'un autre cabinet, brouillon ou non
 *    adressé : le MÊME 404 du portail.
 * 3. Saisie en brouillon (fusion des réponses citées, validées par le
 *    moteur), puis soumission (réponses complètes exigées par le moteur) ;
 *    collectif : réponse partagée, verrouillée à la PREMIÈRE soumission
 *    (moteur `soumettreReponses` et déclencheur MPQ04).
 * 4. Projection explicite : ni auteur interne, ni historique des relances, ni
 *    réponse d'un autre répondant ; la réponse collective est servie sans le
 *    détail des contributeurs.
 */

/** Transaction du portail restreinte, en plus, à l'utilisateur (politiques 0143). */
export function avecPortailQuestionnaires<T>(
  app: FastifyInstance,
  acces: AccesPortail,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return avecPortail(app, acces, async (db) => {
    await db.query("SELECT set_config('app.portail_utilisateur_id', $1, true)", [
      acces.auth.utilisateurId,
    ]);
    return fn(db);
  });
}

interface MonEnvoi {
  id: string;
  titre: string;
  mode: "individuel" | "collectif" | "par_fonction";
  statut: "envoye" | "clos";
  date_limite: string | null;
  envoye_le: Date;
  definition: DefinitionQuestionnaire;
  envoye_par: string;
  repondant_id: string;
  fonction: string | null;
}

interface LigneReponse {
  id: string;
  statut: "brouillon" | "soumise";
  reponses: Reponses;
  saisies: Record<string, Signature>;
  soumise_par: string | null;
  soumise_le: Date | null;
  modifie_le: Date;
}

const DEPUIS_MES_ENVOIS = `questionnaire_envois e
  JOIN questionnaire_repondants r ON r.envoi_id = e.id AND r.utilisateur_id = $2 AND r.client_id = e.client_id`;
const FILTRE_MES_ENVOIS = `e.client_id = $1 AND e.statut IN ('envoye', 'clos')`;

/**
 * Envoi adressé à l'utilisateur (envoyé ou clos), sinon 404 du portail.
 * `verrouiller` sérialise les saisies et soumissions d'un même envoi par un
 * verrou CONSULTATIF de transaction, pris avant la lecture : l'envoi est en
 * lecture seule dans le portail (0143), un `FOR UPDATE` n'y trouverait aucune
 * ligne. L'état de l'envoi au moment de l'écriture est revérifié par le
 * déclencheur des réponses (MPQ04).
 */
export async function exigerMonEnvoi(
  db: Db,
  acces: AccesPortail,
  id: string,
  verrouiller = false,
): Promise<MonEnvoi> {
  if (verrouiller) {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('questionnaire_envoi:' || $1, 0))",
      [id],
    );
  }
  const r = await db.query(
    `SELECT e.id, e.titre, e.mode, e.statut, e.date_limite::text AS date_limite, e.envoye_le,
       e.definition, e.envoye_par, r.id AS repondant_id, r.fonction
     FROM ${DEPUIS_MES_ENVOIS} WHERE ${FILTRE_MES_ENVOIS} AND e.id = $3`,
    [acces.clientId, acces.auth.utilisateurId, id],
  );
  if (!r.rows[0]) throw introuvablePortail();
  return r.rows[0] as MonEnvoi;
}

/** Ma réponse (individuel, par fonction) ou la réponse partagée (collectif), ou undefined. */
async function lireReponse(
  db: Db,
  envoi: MonEnvoi,
  verrouiller = false,
): Promise<LigneReponse | undefined> {
  const r = await db.query(
    `SELECT id, statut, reponses, saisies, soumise_par, soumise_le, modifie_le
     FROM questionnaire_reponses
     WHERE envoi_id = $1 AND ${envoi.mode === "collectif" ? "repondant_id IS NULL" : "repondant_id = $2"}
     ${verrouiller ? "FOR UPDATE" : ""}`,
    envoi.mode === "collectif" ? [envoi.id] : [envoi.id, envoi.repondant_id],
  );
  return r.rows[0] as LigneReponse | undefined;
}

/** Réponse existante (créée vide au besoin), verrouillée pour la transaction. */
async function reponseVerrouillee(
  db: Db,
  acces: AccesPortail,
  envoi: MonEnvoi,
): Promise<LigneReponse> {
  await db.query(
    envoi.mode === "collectif"
      ? `INSERT INTO questionnaire_reponses (cabinet_id, envoi_id, repondant_id, client_id, modifie_par)
         VALUES ($1, $2, NULL, $3, $4)
         ON CONFLICT (cabinet_id, envoi_id) WHERE repondant_id IS NULL DO NOTHING`
      : `INSERT INTO questionnaire_reponses (cabinet_id, envoi_id, repondant_id, client_id, modifie_par)
         VALUES ($1, $2, $5, $3, $4)
         ON CONFLICT (cabinet_id, envoi_id, repondant_id) WHERE repondant_id IS NOT NULL DO NOTHING`,
    envoi.mode === "collectif"
      ? [acces.auth.cabinetId, envoi.id, acces.clientId, acces.auth.utilisateurId]
      : [
          acces.auth.cabinetId,
          envoi.id,
          acces.clientId,
          acces.auth.utilisateurId,
          envoi.repondant_id,
        ],
  );
  return (await lireReponse(db, envoi, true)) as LigneReponse;
}

function exigerOuvert(envoi: MonEnvoi, reponse: LigneReponse | undefined): void {
  if (reponse?.statut === "soumise") {
    throw new ErreurQuestionnaire(
      "DEJA_SOUMISE",
      envoi.mode === "collectif"
        ? "La réponse collective est déjà soumise : elle est verrouillée."
        : "Vos réponses sont déjà soumises : elles sont verrouillées.",
    );
  }
  if (envoi.statut !== "envoye")
    throw conflit("Ce questionnaire est clos : il n'accepte plus de réponse.");
}

/** Vue servie au client (projection explicite). */
export function vueQuestionnaire(
  acces: AccesPortail,
  envoi: MonEnvoi,
  reponse: LigneReponse | undefined,
  avecDefinition: boolean,
) {
  const reponses = reponse?.reponses ?? {};
  const p = progression(envoi.definition, reponses);
  return {
    id: envoi.id,
    titre: envoi.titre,
    mode: envoi.mode,
    statut: envoi.statut,
    date_limite: envoi.date_limite,
    envoye_le: envoi.envoye_le,
    fonction: envoi.fonction,
    ...(avecDefinition ? { definition: envoi.definition } : {}),
    reponse: {
      statut: reponse?.statut ?? "non_commence",
      ...(avecDefinition ? { reponses } : {}),
      derniere_saisie: reponse?.modifie_le ?? null,
      soumission:
        reponse?.statut === "soumise"
          ? { le: reponse.soumise_le, par_moi: reponse.soumise_par === acces.auth.utilisateurId }
          : null,
      progression: {
        pourcentage: p.pourcentage,
        complet: p.complet,
        obligatoires_visibles: p.obligatoiresVisibles,
        obligatoires_repondues: p.obligatoiresRepondues,
      },
    },
  };
}

/** Questionnaires adressés à l'utilisateur (page par curseur, plus récents d'abord). */
export async function mesQuestionnaires(
  db: Db,
  acces: AccesPortail,
  apres: [string, string] | null,
  limite: number,
) {
  const cle = `to_char(e.envoye_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
  const r = await db.query(
    `SELECT e.id, e.titre, e.mode, e.statut, e.date_limite::text AS date_limite, e.envoye_le,
       e.definition, e.envoye_par, r.id AS repondant_id, r.fonction, ${cle} AS cle_tri
     FROM ${DEPUIS_MES_ENVOIS}
     WHERE ${FILTRE_MES_ENVOIS} AND ($3::text IS NULL OR (${cle}, e.id) < ($3, $4::uuid))
     ORDER BY cle_tri DESC, e.id DESC LIMIT $5`,
    [acces.clientId, acces.auth.utilisateurId, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  const page = paginer(r.rows as (MonEnvoi & { cle_tri: string })[], limite);
  const elements = [];
  for (const ligne of page.elements) {
    const envoi = ligne as MonEnvoi;
    elements.push(vueQuestionnaire(acces, envoi, await lireReponse(db, envoi), false));
  }
  return { elements, curseur_suivant: page.curseur_suivant };
}

/** Lecture d'un questionnaire adressé : définition et réponse courante. */
export async function monQuestionnaire(db: Db, acces: AccesPortail, id: string) {
  const envoi = await exigerMonEnvoi(db, acces, id);
  return vueQuestionnaire(acces, envoi, await lireReponse(db, envoi), true);
}

/**
 * Sauvegarde d'un brouillon : les réponses citées sont fusionnées avec les
 * réponses enregistrées (une valeur vide efface), puis validées par le
 * moteur en mode brouillon (individuel) ou fusionnées par le moteur
 * (collectif : dernière saisie gagnante, auteur et date tracés).
 */
export async function enregistrerBrouillon(
  db: Db,
  acces: AccesPortail,
  id: string,
  saisie: Reponses,
) {
  const envoi = await exigerMonEnvoi(db, acces, id, true);
  exigerOuvert(envoi, await lireReponse(db, envoi));
  const reponse = await reponseVerrouillee(db, acces, envoi);
  exigerOuvert(envoi, reponse);
  let reponses: Reponses;
  let saisies: Record<string, Signature> = reponse.saisies;
  if (envoi.mode === "collectif") {
    const etat: ReponseCollective = {
      statut: "brouillon",
      reponses: reponse.reponses as ReponseCollective["reponses"],
      saisies: reponse.saisies,
      soumission: null,
    };
    const suivant = fusionnerReponses(envoi.definition, etat, {
      auteur: acces.auth.utilisateurId,
      date: aujourdhui(),
      reponses: saisie,
    });
    reponses = suivant.reponses;
    saisies = { ...suivant.saisies };
  } else {
    const r = validerReponses(envoi.definition, { ...reponse.reponses, ...saisie }, "brouillon");
    if (!r.valide) {
      throw new ErreurQuestionnaire("REPONSES_INVALIDES", "Réponses invalides.", r.erreurs);
    }
    reponses = r.reponses;
  }
  await db.query(
    `UPDATE questionnaire_reponses SET reponses = $2, saisies = $3, modifie_par = $4 WHERE id = $1`,
    [reponse.id, JSON.stringify(reponses), JSON.stringify(saisies), acces.auth.utilisateurId],
  );
  return { envoi, reponse: (await lireReponse(db, envoi)) as LigneReponse };
}

/** Soumission : réponses complètes exigées par le moteur, puis verrouillage. */
export async function soumettre(
  db: Db,
  acces: AccesPortail,
  id: string,
): Promise<{ vue: ReturnType<typeof vueQuestionnaire>; notification: NotificationCreee | null }> {
  const envoi = await exigerMonEnvoi(db, acces, id, true);
  exigerOuvert(envoi, await lireReponse(db, envoi));
  const reponse = await reponseVerrouillee(db, acces, envoi);
  exigerOuvert(envoi, reponse);
  const signature = { auteur: acces.auth.utilisateurId, date: aujourdhui() };
  let reponses: Reponses;
  let saisies: Record<string, Signature> = reponse.saisies;
  if (envoi.mode === "collectif") {
    const soumise = soumettreReponses(
      envoi.definition,
      {
        statut: "brouillon",
        reponses: reponse.reponses as ReponseCollective["reponses"],
        saisies: reponse.saisies,
        soumission: null,
      },
      signature,
    );
    reponses = soumise.reponses;
    saisies = { ...soumise.saisies };
  } else {
    reponses = exigerReponsesValides(envoi.definition, reponse.reponses, "soumission");
  }
  await db.query(
    `UPDATE questionnaire_reponses SET reponses = $2, saisies = $3, modifie_par = $4,
       statut = 'soumise', soumise_par = $4, soumise_le = now()
     WHERE id = $1`,
    [reponse.id, JSON.stringify(reponses), JSON.stringify(saisies), acces.auth.utilisateurId],
  );
  const notification = await notifier(db, {
    cabinetId: acces.auth.cabinetId,
    destinataireId: envoi.envoye_par,
    type: "questionnaire_soumis",
    titre: `Questionnaire soumis : « ${envoi.titre} »`,
    corps: `${acces.auth.nom} a soumis ${envoi.mode === "collectif" ? "la réponse collective" : "ses réponses"} au questionnaire « ${envoi.titre} » depuis le portail client.`,
    lien: `/questionnaires/envois/${envoi.id}`,
  });
  const vue = vueQuestionnaire(acces, envoi, (await lireReponse(db, envoi)) as LigneReponse, true);
  return { vue, notification };
}
