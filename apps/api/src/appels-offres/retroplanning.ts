import {
  alertesAppelsOffres,
  retroPlanning,
  STATUTS_AO_OUVERTS,
  type AlerteAppelOffres,
  type StatutAppelOffres,
} from "@missionpilot/engines";
import {
  aPermission,
  type EtapeRetroplanningModification,
  type EtapeTache,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { authDe } from "../collaboration/entites.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { exigerFicheOuverte } from "./exigences.js";
import { lireFiche } from "./fiches.js";

/*
 * Rétro-planning de réponse (AO-08) : étapes datées à rebours de la date limite par le moteur
 * (`retroPlanning`), modifiables (date, responsable, fait) tant que la réponse est en
 * préparation ; une étape se CONFIE par une tâche assignée existante (`taches_collaboration`,
 * SOC-08 : notification de l'assigné, écran « Mes tâches »), créée sans entité liée et dont
 * l'identifiant reste attaché à l'étape.
 *
 * Alertes : CALCULÉES à la lecture par le moteur (`alertesAppelsOffres`), jamais stockées ;
 * `alertesAppelsOffresCabinet` est le point de lecture du brief quotidien (AUT-07) et de la
 * route GET /api/appels-offres/alertes. La date du jour est un paramètre (UTC).
 */

/** Plafond des fiches ouvertes lues pour les alertes (au-delà : signalé `tronque`). */
export const ALERTES_FICHES_MAX = 500;

const LIEN_MES_TACHES = "/mes-taches";

/** Date du jour UTC (AAAA-MM-JJ). */
export const aujourdhuiUtc = (maintenant: Date = new Date()) =>
  maintenant.toISOString().slice(0, 10);

const COLONNES_ETAPE = `e.id, e.ao_id, e.ordre, e.code, e.libelle, e.date_prevue::text AS date_prevue,
  e.responsable_id, r.nom AS responsable_nom, e.faite, e.faite_le, e.tache_id,
  t.statut AS tache_statut, ta.nom AS tache_assignee_nom, e.modifie_le`;
const DEPUIS_ETAPE = `ao_retroplanning_etapes e LEFT JOIN utilisateurs r ON r.id = e.responsable_id
  LEFT JOIN taches_collaboration t ON t.id = e.tache_id
  LEFT JOIN utilisateurs ta ON ta.id = t.assignee_id`;

interface EtapeDb extends Record<string, unknown> {
  id: string;
  ao_id: string;
  code: string;
  libelle: string;
  date_prevue: string;
  faite: boolean;
  tache_id: string | null;
}

async function etapesDeFiche(db: Db, aoId: string): Promise<EtapeDb[]> {
  const r = await db.query(
    `SELECT ${COLONNES_ETAPE} FROM ${DEPUIS_ETAPE} WHERE e.ao_id = $1 ORDER BY e.ordre`,
    [aoId],
  );
  return r.rows as EtapeDb[];
}

async function lireEtape(db: Db, id: string, verrouiller = false): Promise<EtapeDb> {
  const r = await db.query(
    `SELECT ${COLONNES_ETAPE} FROM ${DEPUIS_ETAPE} WHERE e.id = $1
     ${verrouiller ? "FOR UPDATE OF e" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Étape");
  return r.rows[0] as EtapeDb;
}

/** Rétro-planning d'une fiche et ses alertes du jour. */
export async function lireRetroplanning(db: Db, aoId: string, aujourdhui: string) {
  const fiche = await lireFiche(db, aoId);
  const etapes = await etapesDeFiche(db, aoId);
  const alertes = alertesAppelsOffres(
    [
      {
        id: fiche.id,
        statut: fiche.statut,
        dateLimite: fiche.date_limite,
        etapes: etapes.map((e) => ({
          code: e.code,
          libelle: e.libelle,
          datePrevue: e.date_prevue,
          faite: e.faite,
        })),
      },
    ],
    aujourdhui,
  );
  return { date_limite: fiche.date_limite, statut: fiche.statut, etapes, alertes };
}

/** Génère les étapes standard à rebours de la date limite (une seule fois par fiche). */
export async function genererRetroplanning(db: Db, auth: Auth, aoId: string, aujourdhui: string) {
  const fiche = await exigerFicheOuverte(db, aoId);
  if (!fiche.date_limite) {
    throw new AppError(
      409,
      "AO_DATE_LIMITE_REQUISE",
      "Renseignez la date limite de l'appel d'offres pour planifier la réponse.",
    );
  }
  const existe = await db.query("SELECT 1 FROM ao_retroplanning_etapes WHERE ao_id = $1 LIMIT 1", [
    aoId,
  ]);
  if (existe.rows[0]) {
    throw new AppError(
      409,
      "AO_RETROPLANNING_EXISTANT",
      "Le rétro-planning de cet appel d'offres existe déjà.",
    );
  }
  const plan = retroPlanning(fiche.date_limite, aujourdhui);
  for (const e of plan.etapes) {
    await db.query(
      `INSERT INTO ao_retroplanning_etapes (cabinet_id, ao_id, ordre, code, libelle, date_prevue,
         responsable_id, cree_par, modifie_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        auth.cabinetId,
        aoId,
        e.ordre,
        e.code,
        e.libelle,
        e.datePrevue,
        (fiche.responsable_id as string | null) ?? null,
        auth.utilisateurId,
      ],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "generation_retroplanning",
    entite: "appel_offres",
    entiteId: aoId,
    details: { etapes: plan.etapes.length, compresse: plan.compresse },
  });
  return { ...(await lireRetroplanning(db, aoId, aujourdhui)), compresse: plan.compresse };
}

export async function modifierEtape(
  db: Db,
  auth: Auth,
  etapeId: string,
  m: EtapeRetroplanningModification,
) {
  const avant = await lireEtape(db, etapeId);
  await exigerFicheOuverte(db, avant.ao_id);
  await lireEtape(db, etapeId, true);
  if (m.responsable_id && !(await authDe(db, auth.cabinetId, m.responsable_id))) {
    throw requeteInvalide("Responsable inconnu ou inactif.");
  }
  await db.query(
    `UPDATE ao_retroplanning_etapes SET
       date_prevue = coalesce($2::date, date_prevue),
       responsable_id = CASE WHEN $3::boolean THEN $4::uuid ELSE responsable_id END,
       faite = coalesce($5::boolean, faite),
       faite_le = CASE WHEN $5::boolean IS NULL THEN faite_le
                       WHEN $5::boolean THEN coalesce(faite_le, now()) ELSE NULL END,
       modifie_par = $6, modifie_le = now()
     WHERE id = $1`,
    [
      etapeId,
      m.date_prevue ?? null,
      m.responsable_id !== undefined,
      m.responsable_id ?? null,
      m.faite ?? null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "suivi_retroplanning",
    entite: "appel_offres",
    entiteId: avant.ao_id,
    details: { etape_id: etapeId, faite: m.faite ?? null },
  });
  return lireEtape(db, etapeId);
}

/**
 * Confie une étape à un collègue par une tâche assignée (SOC-08). L'assigné est un utilisateur
 * actif du cabinet ; l'étape ne porte qu'une tâche. Renvoie la notification à envoyer après la
 * validation de la transaction.
 */
export async function confierEtape(
  db: Db,
  auth: Auth,
  etapeId: string,
  corps: EtapeTache,
): Promise<{ etape: EtapeDb; notifications: (NotificationCreee | null)[] }> {
  const avant = await lireEtape(db, etapeId);
  const fiche = await exigerFicheOuverte(db, avant.ao_id);
  const etape = await lireEtape(db, etapeId, true);
  if (etape.tache_id) throw conflit("Cette étape est déjà confiée par une tâche.");
  const assigne = await authDe(db, auth.cabinetId, corps.assignee_id);
  if (!assigne) throw requeteInvalide("Assigné inconnu ou inactif.");
  // La tâche porte le nom de l'appel d'offres : l'assigné doit pouvoir le lire (ao.lire).
  if (!aPermission(assigne.roles, "ao.lire")) {
    throw requeteInvalide("L'assigné n'a pas accès aux appels d'offres.");
  }
  const titre = `Appel d'offres « ${fiche.titre.slice(0, 120)} » : ${etape.libelle}`.slice(0, 200);
  const t = await db.query(
    `INSERT INTO taches_collaboration (cabinet_id, titre, description, assignee_id, cree_par,
       echeance) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      auth.cabinetId,
      titre,
      corps.description ?? "",
      corps.assignee_id,
      auth.utilisateurId,
      etape.date_prevue,
    ],
  );
  const tacheId = t.rows[0].id as string;
  await db.query(
    `UPDATE ao_retroplanning_etapes SET tache_id = $2, responsable_id = $3, modifie_par = $4,
       modifie_le = now() WHERE id = $1`,
    [etapeId, tacheId, corps.assignee_id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "tache_collaboration",
    entiteId: tacheId,
    details: { assignee_id: corps.assignee_id, entite_type: null, ao_id: fiche.id },
  });
  const notifications: (NotificationCreee | null)[] = [];
  if (corps.assignee_id !== auth.utilisateurId) {
    notifications.push(
      await notifier(db, {
        cabinetId: auth.cabinetId,
        destinataireId: corps.assignee_id,
        type: "tache_assignee",
        titre: `Tâche assignée par ${auth.nom} : ${titre}`,
        corps: `Échéance : ${etape.date_prevue}`,
        lien: LIEN_MES_TACHES,
        email: true,
      }),
    );
  }
  return { etape: await lireEtape(db, etapeId), notifications };
}

export interface AlerteAoLue {
  ao_id: string;
  titre: string;
  statut: StatutAppelOffres;
  date_limite: string | null;
  type: AlerteAppelOffres["type"];
  niveau: string | null;
  jours_restants: number;
  etape_code: string | null;
  etape_libelle: string | null;
}

/**
 * Alertes avant la date limite de toutes les fiches ouvertes du cabinet courant (RLS), triées
 * par urgence. Point de lecture du brief quotidien : appelée dans la transaction de l'appelant,
 * sans écriture.
 */
export async function alertesAppelsOffresCabinet(
  db: Db,
  aujourdhui: string,
): Promise<{ alertes: AlerteAoLue[]; tronque: boolean }> {
  const fiches = await db.query(
    `SELECT a.id, a.titre, a.statut, a.date_limite::text AS date_limite FROM appels_offres a
     WHERE a.statut = ANY($1::text[]) AND a.date_limite IS NOT NULL
     ORDER BY a.date_limite, a.id LIMIT $2`,
    [STATUTS_AO_OUVERTS, ALERTES_FICHES_MAX + 1],
  );
  const lues = fiches.rows.slice(0, ALERTES_FICHES_MAX) as {
    id: string;
    titre: string;
    statut: StatutAppelOffres;
    date_limite: string;
  }[];
  const etapes = await db.query(
    `SELECT e.ao_id, e.code, e.libelle, e.date_prevue::text AS date_prevue, e.faite
     FROM ao_retroplanning_etapes e WHERE e.ao_id = ANY($1::uuid[]) AND NOT e.faite`,
    [lues.map((f) => f.id)],
  );
  const parFiche = new Map<
    string,
    { code: string; libelle: string; datePrevue: string; faite: boolean }[]
  >();
  for (const e of etapes.rows) {
    const liste = parFiche.get(e.ao_id as string) ?? [];
    liste.push({
      code: e.code as string,
      libelle: e.libelle as string,
      datePrevue: e.date_prevue as string,
      faite: e.faite as boolean,
    });
    parFiche.set(e.ao_id as string, liste);
  }
  const index = new Map(lues.map((f) => [f.id, f]));
  const alertes = alertesAppelsOffres(
    lues.map((f) => ({
      id: f.id,
      statut: f.statut,
      dateLimite: f.date_limite,
      etapes: parFiche.get(f.id) ?? [],
    })),
    aujourdhui,
  ).map((a) => {
    const f = index.get(a.aoId) as (typeof lues)[number];
    return {
      ao_id: a.aoId,
      titre: f.titre,
      statut: f.statut,
      date_limite: f.date_limite,
      type: a.type,
      niveau: a.type === "date_limite" ? a.niveau : null,
      jours_restants: a.joursRestants,
      etape_code: a.type === "date_limite" ? null : a.etapeCode,
      etape_libelle: a.type === "date_limite" ? null : a.etapeLibelle,
    };
  });
  return { alertes, tronque: fiches.rows.length > ALERTES_FICHES_MAX };
}
