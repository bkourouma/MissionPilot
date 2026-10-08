import {
  FACTEURS_RISQUE_CLIENT,
  NIVEAUX_RISQUE_CLIENT,
  acceptationSchema,
  aPermission,
  relationClientSchema,
  type NiveauRisqueClient,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable, requeteInvalide } from "../errors.js";
import { exigerMissionVisible } from "../missions/acces.js";

/*
 * Acceptation de mission (QUA-07) : conflits d'intérêts SIMPLES (relations déclarées entre clients
 * du cabinet) et profil de risque du client.
 *
 * - Les conflits sont calculés par le SERVEUR à chaque évaluation (jamais reçus du client) et
 *   figés dans la ligne d'évaluation (ajout seul, `qualite_acceptations`).
 * - Le niveau du profil est le plus élevé des niveaux imposés par les facteurs cochés ; le
 *   relecteur peut le relever, jamais le baisser.
 * - Décider (accepter, accepter sous conditions, refuser) exige `qualite.signer` ; une simple
 *   évaluation « en attente » exige `qualite.relire`. Accepter malgré un conflit exige un motif.
 * - Un conflit révèle l'existence d'un client lié (raison sociale) et le NOMBRE de ses missions
 *   en cours, jamais leur intitulé : la vérification de conflit est un contrôle du cabinet, que
 *   la visibilité des missions ne doit pas empêcher.
 */

export interface ConflitDetecte {
  relation_id: string;
  nature: string;
  client_lie_id: string;
  client_lie_nom: string;
  missions_en_cours: number;
  note: string | null;
}

export async function detecterConflits(
  db: Db,
  clientId: string,
  missionId: string,
): Promise<ConflitDetecte[]> {
  const r = await db.query(
    `SELECT r.id AS relation_id, r.nature, r.note,
       CASE WHEN r.client_id = $1 THEN r.client_lie_id ELSE r.client_id END AS client_lie_id
     FROM qualite_relations_clients r WHERE r.client_id = $1 OR r.client_lie_id = $1
     ORDER BY r.cree_le, r.id`,
    [clientId],
  );
  if (r.rows.length === 0) return [];
  const ids = r.rows.map((l) => l.client_lie_id as string);
  const c = await db.query(
    `SELECT c.id, c.raison_sociale,
       (SELECT count(*)::int FROM missions m
        WHERE m.client_id = c.id AND m.id <> $2
          AND m.statut IN ('proposition', 'signee', 'en_cours', 'a_cloturer')) AS missions_en_cours
     FROM clients c WHERE c.id = ANY($1::uuid[])`,
    [ids, missionId],
  );
  const parClient = new Map(c.rows.map((l) => [l.id as string, l]));
  return r.rows.map((l) => {
    const cl = parClient.get(l.client_lie_id as string);
    return {
      relation_id: l.relation_id as string,
      nature: l.nature as string,
      client_lie_id: l.client_lie_id as string,
      client_lie_nom: (cl?.raison_sociale as string | undefined) ?? "Client",
      missions_en_cours: (cl?.missions_en_cours as number | undefined) ?? 0,
      note: (l.note as string | null) ?? null,
    };
  });
}

const rangNiveau = (n: NiveauRisqueClient) => NIVEAUX_RISQUE_CLIENT.indexOf(n);

/** Niveau imposé par les facteurs cochés : le plus élevé (faible si aucun). */
export function niveauDesFacteurs(codes: readonly string[]): NiveauRisqueClient {
  let niveau: NiveauRisqueClient = "faible";
  for (const code of codes) {
    const f = FACTEURS_RISQUE_CLIENT.find((x) => x.code === code);
    if (f && rangNiveau(f.niveau) > rangNiveau(niveau)) niveau = f.niveau;
  }
  return niveau;
}

export interface Acceptation {
  id: string;
  mission_id: string;
  client_id: string;
  rang: number;
  conflits: ConflitDetecte[];
  profil_risque: Record<string, unknown>;
  niveau_risque: string;
  decision: string;
  motif: string | null;
  evalue_par: string;
  evalue_par_nom: string | null;
  evalue_le: Date;
}

const COLONNES = `a.id, a.mission_id, a.client_id, a.rang, a.conflits, a.profil_risque, a.niveau_risque,
  a.decision, a.motif, a.evalue_par, u.nom AS evalue_par_nom, a.evalue_le`;

export async function lireAcceptation(db: Db, auth: Auth, missionId: string) {
  const mission = await exigerMissionVisible(db, auth, missionId);
  const h = await db.query(
    `SELECT ${COLONNES} FROM qualite_acceptations a LEFT JOIN utilisateurs u ON u.id = a.evalue_par
     WHERE a.mission_id = $1 ORDER BY a.rang DESC`,
    [missionId],
  );
  const historique = h.rows as Acceptation[];
  return {
    derniere: historique[0] ?? null,
    historique,
    conflits_actuels: await detecterConflits(db, mission.client_id, missionId),
  };
}

export async function evaluerAcceptation(
  db: Db,
  auth: Auth,
  missionId: string,
  brut: unknown,
): Promise<Acceptation> {
  const c = acceptationSchema.parse(brut);
  const mission = await exigerMissionVisible(db, auth, missionId, true);
  if (c.decision !== "en_attente" && !aPermission(auth.roles, "qualite.signer")) throw interdit();
  const conflits = await detecterConflits(db, mission.client_id, missionId);
  const calcule = niveauDesFacteurs(c.facteurs);
  const retenu =
    c.niveau_retenu && rangNiveau(c.niveau_retenu) > rangNiveau(calcule)
      ? c.niveau_retenu
      : calcule;
  if (c.niveau_retenu && rangNiveau(c.niveau_retenu) < rangNiveau(calcule)) {
    throw requeteInvalide(
      "Le niveau retenu ne peut pas être inférieur au niveau des facteurs cochés.",
    );
  }
  const motif = c.motif ?? null;
  if ((c.decision === "refusee" || c.decision === "acceptee_sous_conditions") && !motif) {
    throw requeteInvalide("Un motif est requis pour refuser ou accepter sous conditions.");
  }
  if (c.decision === "acceptee" && conflits.length > 0 && !motif) {
    throw new AppError(
      409,
      "MOTIF_CONFLIT_REQUIS",
      "Un conflit d'intérêts est détecté : motivez l'acceptation.",
    );
  }
  const rang = await db.query(
    "SELECT COALESCE(MAX(rang), 0) + 1 AS rang FROM qualite_acceptations WHERE mission_id = $1",
    [missionId],
  );
  const r = await db.query(
    `INSERT INTO qualite_acceptations (cabinet_id, mission_id, client_id, rang, conflits, profil_risque,
       niveau_risque, decision, motif, evalue_par)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      mission.client_id,
      rang.rows[0].rang,
      JSON.stringify(conflits),
      JSON.stringify({ facteurs: c.facteurs, niveau_calcule: calcule, niveau_retenu: retenu }),
      retenu,
      c.decision,
      motif,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.acceptation.evaluer",
    entite: "mission",
    entiteId: missionId,
    details: {
      acceptation_id: r.rows[0].id,
      decision: c.decision,
      niveau_risque: retenu,
      conflits: conflits.length,
    },
  });
  const lu = await db.query(
    `SELECT ${COLONNES} FROM qualite_acceptations a LEFT JOIN utilisateurs u ON u.id = a.evalue_par
     WHERE a.id = $1`,
    [r.rows[0].id],
  );
  return lu.rows[0] as Acceptation;
}

// ---------------------------------------------------------------------------
// Relations déclarées entre clients
// ---------------------------------------------------------------------------

export async function listerRelations(db: Db, clientId: string | null) {
  const r = await db.query(
    `SELECT r.id, r.client_id, a.raison_sociale AS client_nom, r.client_lie_id,
       b.raison_sociale AS client_lie_nom, r.nature, r.note, r.cree_le
     FROM qualite_relations_clients r
     JOIN clients a ON a.id = r.client_id JOIN clients b ON b.id = r.client_lie_id
     WHERE ($1::uuid IS NULL OR r.client_id = $1 OR r.client_lie_id = $1)
     ORDER BY lower(a.raison_sociale), r.id`,
    [clientId],
  );
  return { elements: r.rows };
}

export async function declarerRelation(db: Db, auth: Auth, brut: unknown) {
  const c = relationClientSchema.parse(brut);
  const r = await db.query(
    `INSERT INTO qualite_relations_clients (cabinet_id, client_id, client_lie_id, nature, note, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [auth.cabinetId, c.client_id, c.client_lie_id, c.nature, c.note ?? null, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.relation.declarer",
    entite: "qualite_relation_client",
    entiteId: r.rows[0].id as string,
    details: { client_id: c.client_id, client_lie_id: c.client_lie_id, nature: c.nature },
  });
  return (await listerRelations(db, c.client_id)).elements.find((e) => e.id === r.rows[0].id);
}

export async function retirerRelation(db: Db, auth: Auth, id: string): Promise<void> {
  const r = await db.query(
    "DELETE FROM qualite_relations_clients WHERE id = $1 RETURNING client_id, client_lie_id, nature",
    [id],
  );
  if (!r.rows[0]) throw introuvable("Relation");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.relation.retirer",
    entite: "qualite_relation_client",
    entiteId: id,
    details: r.rows[0],
  });
}
