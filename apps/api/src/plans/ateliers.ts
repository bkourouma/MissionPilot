import {
  aPermission,
  type AtelierCreation,
  type AtelierModification,
  type MethodeAtelier,
  type Role,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { filtreVisibilite } from "../missions/acces.js";
import { exigerPlanRedigeable, exigerPlanVisible, type PlanAcces } from "./acces.js";
import {
  agregerAtelier,
  appliquerSeuil,
  SEUIL_PARTICIPANTS_AGREGATS,
  contributionsCourantes,
  participationEnCours,
  type AtelierParametres,
  type OptionDb,
} from "./ateliers-resultats.js";

/*
 * Ateliers stratégiques en ligne (PLA-15), migrations 0425 et 0426.
 *
 * - Lire : « plan.lire », mission visible (plans/acces.ts). Écrire (créer, modifier, ouvrir, clore,
 *   inviter) : « plan.ecrire », mission visible et NON clôturée (409), plan verrouillé. Inviter un
 *   dirigeant du client exige en plus « portail.gerer » (comme le partage du plan).
 * - Cycle : brouillon (contenu modifiable) → ouvert (contributions) → clos (figé). À la clôture, les
 *   agrégats sont calculés par le MOTEUR (ateliers-resultats.ts) et figés dans l'enregistrement.
 * - Anonymat : les contributions individuelles ne sont jamais servies. Pendant l'atelier, seul le
 *   taux de participation (calculé par le moteur) est visible ; les agrégats ne le sont qu'après la
 *   clôture. Le portail ne passe pas par ce module (routes/portail-ateliers.ts).
 * - Un verrou consultatif exclusif sur l'atelier sérialise la clôture avec les contributions, qui
 *   prennent le verrou partagé (ateliers-contributions.ts).
 */

export const ATELIERS_LISTE_MAX = 100;

export interface AtelierDb extends AtelierParametres {
  plan_id: string;
  mission_id: string;
  client_id: string;
  titre: string;
  consigne: string;
  statut: "brouillon" | "ouvert" | "clos";
  resultats: Record<string, unknown> | null;
  cree_par: string;
  cree_le: Date;
  modifie_le: Date;
  ouvert_par: string | null;
  ouvert_le: Date | null;
  clos_par: string | null;
  clos_le: Date | null;
}

export const COLONNES_ATELIER = `a.id, a.plan_id, a.mission_id, a.client_id, a.titre, a.consigne,
  a.methode_vote, a.methode_priorisation, a.methode_matrice, a.budget_points, a.plafond_par_option,
  a.axe_x_libelle, a.axe_x_inverse, a.axe_y_libelle, a.axe_y_inverse, a.statut, a.resultats,
  a.cree_par, a.cree_le, a.modifie_le, a.ouvert_par, a.ouvert_le, a.clos_par, a.clos_le`;

export const cleVerrouAtelier = (atelierId: string) => `plan_atelier:${atelierId}`;

/** Atelier du plan, ou 404 (même réponse qu'un atelier d'un autre plan ou d'un autre cabinet). */
export async function exigerAtelier(
  db: Db,
  planId: string,
  atelierId: string,
  verrouiller = false,
): Promise<AtelierDb> {
  const r = await db.query(
    `SELECT ${COLONNES_ATELIER} FROM plan_ateliers a WHERE a.id = $1 AND a.plan_id = $2
     ${verrouiller ? "FOR UPDATE OF a" : ""}`,
    [atelierId, planId],
  );
  if (!r.rows[0]) throw introuvable("Atelier");
  return r.rows[0] as AtelierDb;
}

/** Options d'un atelier, dans l'ordre de saisie (50 au plus : plafond de la base). */
export async function optionsDe(db: Db, atelierId: string): Promise<OptionDb[]> {
  const r = await db.query(
    `SELECT id, rang::int AS rang, libelle, description FROM plan_atelier_options
     WHERE atelier_id = $1 ORDER BY rang LIMIT 50`,
    [atelierId],
  );
  return r.rows as OptionDb[];
}

export const methodesActives = (a: AtelierParametres): MethodeAtelier[] => [
  ...(a.methode_vote ? (["vote"] as const) : []),
  ...(a.methode_priorisation ? (["priorisation"] as const) : []),
  ...(a.methode_matrice ? (["matrice"] as const) : []),
];

const colonnesMethodes = (m: readonly MethodeAtelier[]) => ({
  methode_vote: m.includes("vote"),
  methode_priorisation: m.includes("priorisation"),
  methode_matrice: m.includes("matrice"),
});

async function insererOptions(
  db: Db,
  auth: Auth,
  atelierId: string,
  options: AtelierCreation["options"],
): Promise<void> {
  await db.query(
    `INSERT INTO plan_atelier_options (cabinet_id, atelier_id, rang, libelle, description)
     SELECT $1, $2, t.rang, t.libelle, t.description
     FROM unnest($3::text[], $4::text[]) WITH ORDINALITY AS t(libelle, description, rang)`,
    [
      auth.cabinetId,
      atelierId,
      options.map((o) => o.libelle),
      options.map((o) => o.description ?? null),
    ],
  );
}

interface LigneParticipant {
  id: string;
  utilisateur_id: string;
  partie: "cabinet" | "client";
  nom: string;
  invite_le: Date;
}

/** Participants (100 au plus : plafond de la base), avec leur nom : servis au cabinet seulement. */
async function participantsDe(db: Db, atelierId: string): Promise<LigneParticipant[]> {
  const r = await db.query(
    `SELECT p.id, p.utilisateur_id, p.partie, u.nom, p.invite_le
     FROM plan_atelier_participants p JOIN utilisateurs u ON u.id = p.utilisateur_id
     WHERE p.atelier_id = $1 ORDER BY p.invite_le, p.id LIMIT 100`,
    [atelierId],
  );
  return r.rows as LigneParticipant[];
}

function vueOptions(options: readonly OptionDb[]) {
  return options.map((o) => ({
    id: o.id,
    rang: o.rang,
    libelle: o.libelle,
    description: o.description,
  }));
}

function vueCommune(a: AtelierDb) {
  return {
    id: a.id,
    plan_id: a.plan_id,
    titre: a.titre,
    consigne: a.consigne,
    statut: a.statut,
    methodes: methodesActives(a),
    budget_points: a.budget_points,
    plafond_par_option: a.plafond_par_option,
    axes: {
      x: { libelle: a.axe_x_libelle, inverse: a.axe_x_inverse },
      y: { libelle: a.axe_y_libelle, inverse: a.axe_y_inverse },
    },
    cree_par: a.cree_par,
    cree_le: a.cree_le,
    ouvert_le: a.ouvert_le,
    clos_le: a.clos_le,
  };
}

/** Vue détaillée au cabinet : jamais une contribution individuelle ; agrégats après clôture seulement. */
async function vueAtelier(db: Db, a: AtelierDb) {
  const [options, participants] = await Promise.all([
    optionsDe(db, a.id),
    participantsDe(db, a.id),
  ]);
  const contributeurs =
    a.statut === "ouvert" ? (await contributionsCourantes(db, a.id)).contributeurs : [];
  const seuil = a.statut === "clos" ? appliquerSeuil(a.resultats) : null;
  const participation =
    a.statut === "ouvert"
      ? participationEnCours(options, contributeurs, participants.length)
      : null;
  return {
    ...vueCommune(a),
    options: vueOptions(options),
    participants: participants.map((p) => ({
      id: p.id,
      utilisateur_id: p.utilisateur_id,
      partie: p.partie,
      nom: p.nom,
      invite_le: p.invite_le,
    })),
    // Taux seul pendant l'atelier (calculé par le moteur) ; agrégats figés après la clôture.
    participation:
      a.statut === "ouvert"
        ? {
            invites: participants.length,
            ayant_contribue: contributeurs.length,
            taux_centiemes_pourcent: participation?.tauxCentiemesPourcent ?? null,
          }
        : { invites: participants.length, ayant_contribue: null, taux_centiemes_pourcent: null },
    // Agrégats masqués sous le seuil de participants (anonymat) : null + indicateur explicite.
    // Seuil par méthode : une méthode masquée porte `masque_seuil: true` et `resultat: null` ;
    // `resultats` est null si toutes le sont.
    resultats: seuil?.vue ?? null,
    masque_seuil: seuil?.tout_masque ?? false,
    methodes_masquees: seuil?.masquees ?? [],
    seuil_participants: SEUIL_PARTICIPANTS_AGREGATS,
  };
}

/* ----- Lecture ----- */

export async function listerAteliers(
  db: Db,
  auth: Auth,
  planId: string,
  q: { limite: number; curseur?: string | undefined },
) {
  await exigerPlanVisible(db, auth, planId);
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT lpad(((extract(epoch FROM a.cree_le) * 1000000)::bigint)::text, 17, '0') AS cle_tri,
       a.id, a.titre, a.statut, a.methode_vote, a.methode_priorisation, a.methode_matrice,
       a.cree_le, a.ouvert_le, a.clos_le,
       (SELECT count(*)::int FROM plan_atelier_options o WHERE o.atelier_id = a.id) AS nombre_options,
       (SELECT count(*)::int FROM plan_atelier_participants p WHERE p.atelier_id = a.id)
         AS nombre_participants
     FROM plan_ateliers a
     WHERE a.plan_id = $1
       AND ($2::text IS NULL
            OR (lpad(((extract(epoch FROM a.cree_le) * 1000000)::bigint)::text, 17, '0'), a.id)
               < ($2, $3::uuid))
     ORDER BY a.cree_le DESC, a.id DESC LIMIT $4`,
    [planId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as { cle_tri: string; id: string }[], q.limite);
  return {
    elements: (page.elements as Record<string, unknown>[]).map((l) => ({
      id: l.id,
      titre: l.titre,
      statut: l.statut,
      methodes: methodesActives(l as unknown as AtelierParametres),
      nombre_options: l.nombre_options,
      nombre_participants: l.nombre_participants,
      cree_le: l.cree_le,
      ouvert_le: l.ouvert_le,
      clos_le: l.clos_le,
    })),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function lireAtelier(db: Db, auth: Auth, planId: string, atelierId: string) {
  await exigerPlanVisible(db, auth, planId);
  return vueAtelier(db, await exigerAtelier(db, planId, atelierId));
}

/* ----- Écriture ----- */

function plafondCoherent(budget: number, plafond: number | null) {
  if (plafond !== null && plafond > budget) {
    throw requeteInvalide("Le plafond par option ne dépasse pas le budget de points.");
  }
}

export async function creerAtelier(db: Db, auth: Auth, planId: string, corps: AtelierCreation) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const r = await db.query(
    `INSERT INTO plan_ateliers (cabinet_id, plan_id, mission_id, client_id, titre, consigne,
       methode_vote, methode_priorisation, methode_matrice, budget_points, plafond_par_option,
       axe_x_libelle, axe_x_inverse, axe_y_libelle, axe_y_inverse, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [
      auth.cabinetId,
      plan.id,
      plan.mission_id,
      plan.client_id,
      corps.titre,
      corps.consigne,
      ...Object.values(colonnesMethodes(corps.methodes)),
      corps.budget_points,
      corps.plafond_par_option,
      corps.axes.x.libelle,
      corps.axes.x.inverse,
      corps.axes.y.libelle,
      corps.axes.y.inverse,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await insererOptions(db, auth, id, corps.options);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.atelier.creer",
    entite: "plan_atelier",
    entiteId: id,
    details: { plan_id: plan.id, methodes: corps.methodes, options: corps.options.length },
  });
  return vueAtelier(db, await exigerAtelier(db, plan.id, id));
}

function exigerBrouillon(a: AtelierDb) {
  if (a.statut !== "brouillon") {
    throw new AppError(409, "ATELIER_ETAT", "Seul un atelier en brouillon se modifie.");
  }
}

export async function modifierAtelier(
  db: Db,
  auth: Auth,
  planId: string,
  atelierId: string,
  corps: AtelierModification,
) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const a = await exigerAtelier(db, planId, atelierId, true);
  exigerBrouillon(a);
  const budget = corps.budget_points ?? a.budget_points;
  const plafond =
    corps.plafond_par_option === undefined ? a.plafond_par_option : corps.plafond_par_option;
  plafondCoherent(budget, plafond);
  const modif: Record<string, unknown> = {
    ...(corps.titre === undefined ? {} : { titre: corps.titre }),
    ...(corps.consigne === undefined ? {} : { consigne: corps.consigne }),
    ...(corps.methodes === undefined ? {} : colonnesMethodes(corps.methodes)),
    ...(corps.budget_points === undefined ? {} : { budget_points: corps.budget_points }),
    ...(corps.plafond_par_option === undefined
      ? {}
      : { plafond_par_option: corps.plafond_par_option }),
    ...(corps.axes === undefined
      ? {}
      : {
          axe_x_libelle: corps.axes.x.libelle,
          axe_x_inverse: corps.axes.x.inverse,
          axe_y_libelle: corps.axes.y.libelle,
          axe_y_inverse: corps.axes.y.inverse,
        }),
  };
  const colonnes = Object.keys(modif);
  if (colonnes.length > 0) {
    // Colonnes issues de l'objet construit ci-dessus (constantes), valeurs paramétrées.
    await db.query(
      `UPDATE plan_ateliers SET ${colonnes.map((c, i) => `${c} = $${i + 3}`).join(", ")},
         modifie_le = now() WHERE id = $1 AND plan_id = $2`,
      [atelierId, plan.id, ...Object.values(modif)],
    );
  }
  if (corps.options) {
    await db.query("DELETE FROM plan_atelier_options WHERE atelier_id = $1", [atelierId]);
    await insererOptions(db, auth, atelierId, corps.options);
    if (colonnes.length === 0) {
      await db.query("UPDATE plan_ateliers SET modifie_le = now() WHERE id = $1", [atelierId]);
    }
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.atelier.modifier",
    entite: "plan_atelier",
    entiteId: atelierId,
    details: { plan_id: plan.id, champs: [...colonnes, ...(corps.options ? ["options"] : [])] },
  });
  return vueAtelier(db, await exigerAtelier(db, plan.id, atelierId));
}

export async function ouvrirAtelier(db: Db, auth: Auth, planId: string, atelierId: string) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const a = await exigerAtelier(db, planId, atelierId, true);
  exigerBrouillon(a);
  const [options, participants] = await Promise.all([
    optionsDe(db, atelierId),
    participantsDe(db, atelierId),
  ]);
  if (options.length < 2) throw conflit("Un atelier s'ouvre avec au moins deux options.");
  if (participants.length < 1) throw conflit("Invitez au moins un participant avant d'ouvrir.");
  await db.query(
    `UPDATE plan_ateliers SET statut = 'ouvert', ouvert_par = $2, ouvert_le = now(), modifie_le = now()
     WHERE id = $1`,
    [atelierId, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.atelier.ouvrir",
    entite: "plan_atelier",
    entiteId: atelierId,
    details: { plan_id: plan.id, participants: participants.length },
  });
  return vueAtelier(db, await exigerAtelier(db, plan.id, atelierId));
}

/** Clôture : agrégats du moteur, figés dans l'enregistrement avec le statut « clos ». */
export async function cloreAtelier(db: Db, auth: Auth, planId: string, atelierId: string) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  // Attend les contributions en cours (verrou partagé) ; les suivantes verront « clos ».
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    cleVerrouAtelier(atelierId),
  ]);
  const a = await exigerAtelier(db, planId, atelierId, true);
  if (a.statut !== "ouvert") {
    throw new AppError(409, "ATELIER_ETAT", "Seul un atelier ouvert se clôt.");
  }
  const [options, participants, courantes] = await Promise.all([
    optionsDe(db, atelierId),
    participantsDe(db, atelierId),
    contributionsCourantes(db, atelierId),
  ]);
  const synthese = agregerAtelier(a, options, participants.length, courantes);
  await db.query(
    `UPDATE plan_ateliers SET statut = 'clos', resultats = $2, clos_par = $3, clos_le = now(),
       modifie_le = now() WHERE id = $1`,
    [
      atelierId,
      JSON.stringify({
        ...synthese,
        invites: participants.length,
        ayant_contribue: courantes.contributeurs.length,
      }),
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.atelier.clore",
    entite: "plan_atelier",
    entiteId: atelierId,
    details: {
      plan_id: plan.id,
      participants: participants.length,
      ayant_contribue: courantes.contributeurs.length,
    },
  });
  return vueAtelier(db, await exigerAtelier(db, plan.id, atelierId));
}

/* ----- Participants ----- */

interface Candidat {
  id: string;
  nom: string;
  roles: string[];
  actif: boolean;
  client_id: string | null;
  statut_portail: string | null;
}

async function lireCandidat(db: Db, utilisateurId: string): Promise<Candidat | undefined> {
  const r = await db.query(
    `SELECT u.id, u.nom, u.roles, u.actif, up.client_id, up.statut AS statut_portail
     FROM utilisateurs u LEFT JOIN utilisateurs_portail up ON up.utilisateur_id = u.id
     WHERE u.id = $1`,
    [utilisateurId],
  );
  return r.rows[0] as Candidat | undefined;
}

const ROLES_CLIENT = ["client_dirigeant", "client_contributeur", "client_investisseur"];

/** Le membre du cabinet voit-il la mission du plan (même règle que les missions) ? */
async function voitLaMission(db: Db, plan: PlanAcces, c: Candidat): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM missions m WHERE m.id = $1 AND ${filtreVisibilite(2, 3)}`,
    [plan.mission_id, aPermission(c.roles as Role[], "mission.lire_toutes"), c.id],
  );
  return r.rows.length > 0;
}

/**
 * Plafonds DÉCLARÉS de la liste des candidats (pas de pagination : le filtrage par droits se fait
 * après la requête). Atteints, la réponse porte `tronque: true` (dette connue, CODING_STANDARDS §10).
 * - CANDIDATS_CABINET_LUS_MAX : utilisateurs actifs du cabinet examinés ;
 * - CANDIDATS_CABINET_MAX / CANDIDATS_DIRIGEANTS_MAX : candidats rendus par liste.
 */
export const CANDIDATS_CABINET_LUS_MAX = 500;
export const CANDIDATS_CABINET_MAX = 200;
export const CANDIDATS_DIRIGEANTS_MAX = 200;

/** Candidats invitables : membres du cabinet ayant accès à la mission, dirigeants du client (portail.gerer). */
export async function candidatsAtelier(db: Db, auth: Auth, planId: string, atelierId: string) {
  const plan = await exigerPlanVisible(db, auth, planId);
  await exigerAtelier(db, planId, atelierId);
  const deja = await db.query(
    "SELECT utilisateur_id FROM plan_atelier_participants WHERE atelier_id = $1 LIMIT 100",
    [atelierId],
  );
  const invites = new Set(deja.rows.map((x) => x.utilisateur_id as string));
  const membres = await db.query(
    `SELECT u.id, u.nom, u.roles,
       (m.directeur_id = u.id OR m.chef_id = u.id
        OR EXISTS (SELECT 1 FROM mission_equipe e WHERE e.mission_id = m.id AND e.utilisateur_id = u.id))
         AS dans_mission
     FROM utilisateurs u CROSS JOIN missions m
     WHERE m.id = $2 AND u.actif AND NOT (u.roles && $1::text[])
     ORDER BY lower(u.nom), u.id LIMIT $3`,
    [ROLES_CLIENT, plan.mission_id, CANDIDATS_CABINET_LUS_MAX + 1],
  );
  const lus = (membres.rows as (Candidat & { dans_mission: boolean })[]).slice(
    0,
    CANDIDATS_CABINET_LUS_MAX,
  );
  const eligibles = lus
    .filter(
      (m) =>
        !invites.has(m.id) &&
        aPermission(m.roles as Role[], "plan.lire") &&
        (m.dans_mission || aPermission(m.roles as Role[], "mission.lire_toutes")),
    )
    .map((m) => ({ id: m.id, nom: m.nom }));
  const cabinet = eligibles.slice(0, CANDIDATS_CABINET_MAX);
  const dirigeantsLus = aPermission(auth.roles, "portail.gerer")
    ? (
        await db.query(
          `SELECT u.id, u.nom FROM utilisateurs_portail up JOIN utilisateurs u ON u.id = up.utilisateur_id
           WHERE up.client_id = $1 AND up.statut = 'actif' AND u.actif
             AND 'client_dirigeant' = ANY (u.roles)
           ORDER BY lower(u.nom), u.id LIMIT $2`,
          [plan.client_id, CANDIDATS_DIRIGEANTS_MAX + 1],
        )
      ).rows
    : [];
  const dirigeants = dirigeantsLus
    .slice(0, CANDIDATS_DIRIGEANTS_MAX)
    .filter((d) => !invites.has(d.id as string));
  const tronque =
    membres.rows.length > CANDIDATS_CABINET_LUS_MAX ||
    eligibles.length > CANDIDATS_CABINET_MAX ||
    dirigeantsLus.length > CANDIDATS_DIRIGEANTS_MAX;
  return { cabinet, dirigeants, tronque };
}

export async function inviterParticipant(
  db: Db,
  auth: Auth,
  planId: string,
  atelierId: string,
  utilisateurId: string,
) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const a = await exigerAtelier(db, planId, atelierId, true);
  if (a.statut === "clos") {
    throw new AppError(409, "ATELIER_ETAT", "On n'invite pas sur un atelier clos.");
  }
  const c = await lireCandidat(db, utilisateurId);
  if (!c) throw introuvable("Utilisateur");
  const client = c.roles.some((r) => ROLES_CLIENT.includes(r));
  if (client) {
    if (!aPermission(auth.roles, "portail.gerer")) throw interdit();
    // Même réponse pour un compte d'un autre client, inactif ou d'un autre rôle : rien n'est révélé.
    if (
      !c.actif ||
      c.statut_portail !== "actif" ||
      c.client_id !== plan.client_id ||
      !c.roles.includes("client_dirigeant")
    ) {
      throw introuvable("Utilisateur");
    }
  } else if (
    !c.actif ||
    !aPermission(c.roles as Role[], "plan.lire") ||
    !(await voitLaMission(db, plan, c))
  ) {
    throw introuvable("Utilisateur");
  }
  const dejaInvite = await db.query(
    "SELECT 1 FROM plan_atelier_participants WHERE atelier_id = $1 AND utilisateur_id = $2",
    [atelierId, utilisateurId],
  );
  if (dejaInvite.rows[0]) throw conflit("Cette personne est déjà invitée.");
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO plan_atelier_participants (cabinet_id, atelier_id, utilisateur_id, partie, client_id,
         invite_par) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        auth.cabinetId,
        atelierId,
        utilisateurId,
        client ? "client" : "cabinet",
        client ? plan.client_id : null,
        auth.utilisateurId,
      ],
    ),
    { "*": "Cette personne est déjà invitée." },
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.atelier.inviter",
    entite: "plan_atelier",
    entiteId: atelierId,
    details: {
      plan_id: plan.id,
      partie: client ? "client" : "cabinet",
      utilisateur_id: utilisateurId,
    },
  });
  return {
    id: r.rows[0].id as string,
    utilisateur_id: utilisateurId,
    partie: client ? "client" : "cabinet",
    nom: c.nom,
  };
}
