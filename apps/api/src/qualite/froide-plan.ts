import {
  actionEnRetard,
  etatPlanAmelioration,
  transitionActionValide,
  type StatutAction,
} from "@missionpilot/engines";
import {
  aPermission,
  type actionsFroidesQuerySchema,
  type actionFroideCreationSchema,
  type actionFroideModificationSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { aujourdhui } from "../missions/outils.js";
import { notifier } from "../notifications/notifier.js";
import { exigerCampagne, peutGererFroide } from "./froide-donnees.js";

/*
 * Plan d'amélioration continue de la revue à froid (QUA-05). Les actions naissent de la campagne
 * (souvent d'un constat) ; le responsable fait avancer SON action, seul qui gère la revue à froid
 * change le responsable ou l'échéance. Les transitions sont celles du moteur
 * (`transitionActionValide`), doublées par le déclencheur MQQ06 ; chaque changement écrit une
 * ligne d'historique en ajout seul. « Aujourd'hui » vient de `aujourdhui()` (missions/outils).
 */

interface ActionLue {
  id: string;
  campagne_id: string;
  constat_id: string | null;
  titre: string;
  description: string | null;
  responsable_id: string;
  responsable_nom: string | null;
  echeance: string;
  statut: StatutAction;
  cree_par: string;
  cree_le: Date;
  modifie_le: Date;
  cloturee_le: Date | null;
}

const COLONNES_ACTION = `a.id, a.campagne_id, a.constat_id, a.titre, a.description, a.responsable_id,
  u.nom AS responsable_nom, a.echeance::text AS echeance, a.statut, a.cree_par, a.cree_le, a.modifie_le,
  a.cloturee_le`;
const JOINTURE_ACTION =
  "FROM qualite_froide_actions a LEFT JOIN utilisateurs u ON u.id = a.responsable_id";

function vueAction(a: ActionLue, aujourdhuiISO: string) {
  return { ...a, en_retard: actionEnRetard(a, aujourdhuiISO) };
}

async function exigerAction(db: Db, id: string, verrouiller = false): Promise<ActionLue> {
  const r = await db.query(
    `SELECT ${COLONNES_ACTION} ${JOINTURE_ACTION} WHERE a.id = $1 ${verrouiller ? "FOR UPDATE OF a" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Action");
  return r.rows[0] as ActionLue;
}

/** Visible du responsable de l'action et de qui gère la revue à froid ; sinon 404. */
async function accesAction(db: Db, auth: Auth, id: string, verrouiller = false) {
  const a = await exigerAction(db, id, verrouiller);
  if (!peutGererFroide(auth) && a.responsable_id !== auth.utilisateurId)
    throw introuvable("Action");
  return a;
}

function exigerEcheance(echeance: string): void {
  if (echeance < aujourdhui()) {
    throw new AppError(
      400,
      "ECHEANCE_PASSEE",
      "L'échéance ne peut pas être antérieure à aujourd'hui.",
    );
  }
}

/** Responsable : utilisateur actif du cabinet qui peut consulter les actions (`mission.lire`). */
async function exigerResponsable(db: Db, responsableId: string): Promise<void> {
  const r = await db.query("SELECT roles, actif FROM utilisateurs WHERE id = $1", [responsableId]);
  const u = r.rows[0] as { roles: Parameters<typeof aPermission>[0]; actif: boolean } | undefined;
  if (!u || !u.actif || !aPermission(u.roles, "mission.lire")) {
    throw new AppError(
      400,
      "RESPONSABLE_INVALIDE",
      "Le responsable doit être un utilisateur actif du cabinet, interne.",
    );
  }
}

async function ecrireHistorique(
  db: Db,
  auth: Auth,
  a: { id: string },
  ligne: {
    de: StatutAction | null;
    vers: StatutAction;
    responsable_id: string;
    echeance: string;
    commentaire: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO qualite_froide_actions_historique
       (cabinet_id, action_id, rang, de_statut, vers_statut, responsable_id, echeance, commentaire,
        auteur_id)
     SELECT $1, $2, COALESCE(MAX(rang), 0) + 1, $3, $4, $5, $6, $7, $8
     FROM qualite_froide_actions_historique WHERE action_id = $2`,
    [
      auth.cabinetId,
      a.id,
      ligne.de,
      ligne.vers,
      ligne.responsable_id,
      ligne.echeance,
      ligne.commentaire,
      auth.utilisateurId,
    ],
  );
}

async function notifierResponsable(
  db: Db,
  auth: Auth,
  destinataireId: string,
  titreAction: string,
): Promise<void> {
  if (destinataireId === auth.utilisateurId) return;
  await notifier(db, {
    cabinetId: auth.cabinetId,
    destinataireId,
    type: "revue_froide_action",
    titre: "Action du plan d'amélioration",
    corps: `Vous êtes responsable de l'action « ${titreAction} » du plan d'amélioration de la revue à froid.`,
    lien: "/qualite/revue-froide",
  });
}

export async function creerAction(
  db: Db,
  auth: Auth,
  campagneId: string,
  corps: z.infer<typeof actionFroideCreationSchema>,
) {
  await exigerCampagne(db, campagneId, true);
  exigerEcheance(corps.echeance);
  await exigerResponsable(db, corps.responsable_id);
  if (corps.constat_id) {
    const c = await db.query(
      `SELECT e.campagne_id, e.statut FROM qualite_froide_constats c
       JOIN qualite_froide_echantillon e ON e.id = c.echantillon_id WHERE c.id = $1`,
      [corps.constat_id],
    );
    const ligne = c.rows[0] as { campagne_id: string; statut: string } | undefined;
    if (!ligne || ligne.campagne_id !== campagneId) throw introuvable("Constat");
    if (ligne.statut !== "terminee") {
      throw new AppError(
        409,
        "CONSTAT_INVALIDE",
        "Le constat doit venir d'une revue terminée de la même campagne.",
      );
    }
  }
  const r = await db.query(
    `INSERT INTO qualite_froide_actions
       (cabinet_id, campagne_id, constat_id, titre, description, responsable_id, echeance, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      campagneId,
      corps.constat_id ?? null,
      corps.titre,
      corps.description || null,
      corps.responsable_id,
      corps.echeance,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await ecrireHistorique(
    db,
    auth,
    { id },
    {
      de: null,
      vers: "a_faire",
      responsable_id: corps.responsable_id,
      echeance: corps.echeance,
      commentaire: null,
    },
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.action.creer",
    entite: "qualite_froide_action",
    entiteId: id,
    details: {
      campagne_id: campagneId,
      responsable_id: corps.responsable_id,
      echeance: corps.echeance,
    },
  });
  await notifierResponsable(db, auth, corps.responsable_id, corps.titre);
  return detailAction(db, auth, id);
}

export async function planCampagne(db: Db, campagneId: string) {
  await exigerCampagne(db, campagneId);
  const r = await db.query(
    `SELECT ${COLONNES_ACTION} ${JOINTURE_ACTION} WHERE a.campagne_id = $1
     ORDER BY a.echeance, a.id`,
    [campagneId],
  );
  const aujourdhuiISO = aujourdhui();
  const actions = r.rows as ActionLue[];
  return {
    campagne_id: campagneId,
    date_reference: aujourdhuiISO,
    etat: etatPlanAmelioration(actions, aujourdhuiISO),
    actions: actions.map((a) => vueAction(a, aujourdhuiISO)),
  };
}

export async function listerActions(
  db: Db,
  auth: Auth,
  requete: z.infer<typeof actionsFroidesQuerySchema>,
) {
  // `requete` est déjà validée par la route (la transformation de `en_retard` n'est pas rejouable).
  const q = requete;
  const apres = decoderCurseur(q.curseur);
  const aujourdhuiISO = aujourdhui();
  // Retard : même définition que le moteur `actionEnRetard` (ouverte et échéance dépassée).
  const r = await db.query(
    `SELECT ${COLONNES_ACTION}, c.intitule AS campagne_intitule,
       to_char(a.echeance, 'YYYYMMDD') AS cle_tri
     ${JOINTURE_ACTION} JOIN qualite_froide_campagnes c ON c.id = a.campagne_id
     WHERE ($2::boolean OR a.responsable_id = $3)
       AND ($4::uuid IS NULL OR a.campagne_id = $4)
       AND ($5::text IS NULL OR a.statut = $5)
       AND ($6::boolean IS NULL
            OR ($6::boolean = (a.statut IN ('a_faire', 'en_cours') AND a.echeance < $7::date)))
       AND ($8::text IS NULL OR (to_char(a.echeance, 'YYYYMMDD'), a.id) > ($8, $9::uuid))
     ORDER BY cle_tri, a.id LIMIT $1`,
    [
      q.limite + 1,
      peutGererFroide(auth),
      auth.utilisateurId,
      q.campagne_id ?? null,
      q.statut ?? null,
      q.en_retard ?? null,
      aujourdhuiISO,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
    ],
  );
  const page = paginer(r.rows as (ActionLue & { cle_tri: string; id: string })[], q.limite);
  return {
    elements: page.elements.map((a) => vueAction(a as unknown as ActionLue, aujourdhuiISO)),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function detailAction(db: Db, auth: Auth, id: string) {
  const a = await accesAction(db, auth, id);
  const h = await db.query(
    `SELECT h.rang, h.de_statut, h.vers_statut, h.responsable_id, ru.nom AS responsable_nom,
       h.echeance::text AS echeance, h.commentaire, h.auteur_id, au.nom AS auteur_nom, h.le
     FROM qualite_froide_actions_historique h
     LEFT JOIN utilisateurs ru ON ru.id = h.responsable_id
     LEFT JOIN utilisateurs au ON au.id = h.auteur_id
     WHERE h.action_id = $1 ORDER BY h.rang`,
    [id],
  );
  const c = await db.query("SELECT intitule FROM qualite_froide_campagnes WHERE id = $1", [
    a.campagne_id,
  ]);
  const constat = a.constat_id
    ? (
        await db.query(
          "SELECT id, critere, gravite, description FROM qualite_froide_constats WHERE id = $1",
          [a.constat_id],
        )
      ).rows[0]
    : null;
  return {
    ...vueAction(a, aujourdhui()),
    campagne_intitule: (c.rows[0]?.intitule as string | undefined) ?? null,
    constat,
    historique: h.rows,
  };
}

export async function modifierAction(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof actionFroideModificationSchema>,
) {
  const a = await accesAction(db, auth, id, true);
  const gere = peutGererFroide(auth);
  const estResponsable = a.responsable_id === auth.utilisateurId;
  const changeResponsable =
    corps.responsable_id !== undefined && corps.responsable_id !== a.responsable_id;
  const changeEcheance = corps.echeance !== undefined && corps.echeance !== a.echeance;
  // Responsable et échéance : qui gère la revue à froid seul. Statut : le responsable de l'action.
  if ((changeResponsable || changeEcheance) && !gere) throw interdit();
  if (corps.statut !== undefined && !estResponsable) throw interdit();
  if (a.statut === "faite" || a.statut === "abandonnee") {
    throw new AppError(409, "ACTION_CLOSE", "Cette action est close : elle est figée.");
  }
  if (corps.statut !== undefined && !transitionActionValide(a.statut, corps.statut)) {
    throw new AppError(
      409,
      "ACTION_TRANSITION_IMPOSSIBLE",
      `Une action « ${a.statut} » ne peut pas passer à « ${corps.statut} ».`,
    );
  }
  if (changeEcheance) exigerEcheance(corps.echeance as string);
  if (changeResponsable) await exigerResponsable(db, corps.responsable_id as string);

  const statut = corps.statut ?? a.statut;
  const responsable = changeResponsable ? (corps.responsable_id as string) : a.responsable_id;
  const echeance = changeEcheance ? (corps.echeance as string) : a.echeance;
  const clot = statut === "faite" || statut === "abandonnee";
  await db.query(
    `UPDATE qualite_froide_actions
     SET statut = $2, responsable_id = $3, echeance = $4, modifie_le = now(),
         cloturee_le = CASE WHEN $5::boolean THEN now() ELSE NULL END
     WHERE id = $1`,
    [id, statut, responsable, echeance, clot],
  );
  await ecrireHistorique(db, auth, a, {
    de: a.statut,
    vers: statut,
    responsable_id: responsable,
    echeance,
    commentaire: corps.commentaire || null,
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.action.modifier",
    entite: "qualite_froide_action",
    entiteId: id,
    details: {
      de_statut: a.statut,
      vers_statut: statut,
      responsable_id: responsable,
      echeance,
    },
  });
  if (changeResponsable) await notifierResponsable(db, auth, responsable, a.titre);
  return detailAction(db, auth, id);
}
