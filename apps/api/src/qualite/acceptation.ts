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
 *   évaluation « en attente » exige `qualite.relire`, TANT QU'AUCUNE décision n'est prise : ensuite,
 *   toute nouvelle évaluation exige `qualite.signer` (un « en attente » annulerait la décision) et
 *   le niveau retenu ne descend plus sous celui de la dernière évaluation (doublé en base, MPY09).
 *   Accepter malgré un conflit exige un motif.
 * - La note interne d'une relation n'est servie qu'avec `qualite.signer` (conflits compris).
 * - Une relation ne se supprime pas : son retrait est un événement en ajout seul
 *   (`qualite_relations_retraits`, migration 0286) ; seules les relations actives comptent.
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
  /** Note interne de la relation : ABSENTE de la réponse sans `qualite.signer`. */
  note?: string | null;
}

/** Relation non retirée (fragment SQL sur l'alias `r`). */
const RELATION_ACTIVE =
  "NOT EXISTS (SELECT 1 FROM qualite_relations_retraits x WHERE x.relation_id = r.id)";

/** Retire la note interne d'un conflit pour qui n'a pas `qualite.signer`. */
function selonDroitNote<T extends { note?: string | null }>(c: T, voirNote: boolean): T {
  if (voirNote) return c;
  const copie = { ...c };
  delete copie.note;
  return copie;
}

export async function detecterConflits(
  db: Db,
  clientId: string,
  missionId: string,
): Promise<ConflitDetecte[]> {
  const r = await db.query(
    `SELECT r.id AS relation_id, r.nature, r.note,
       CASE WHEN r.client_id = $1 THEN r.client_lie_id ELSE r.client_id END AS client_lie_id
     FROM qualite_relations_clients r
     WHERE (r.client_id = $1 OR r.client_lie_id = $1) AND ${RELATION_ACTIVE}
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
  const voirNote = aPermission(auth.roles, "qualite.signer");
  const historique = (h.rows as Acceptation[]).map((a) => ({
    ...a,
    conflits: a.conflits.map((c) => selonDroitNote(c, voirNote)),
  }));
  return {
    derniere: historique[0] ?? null,
    historique,
    conflits_actuels: (await detecterConflits(db, mission.client_id, missionId)).map((c) =>
      selonDroitNote(c, voirNote),
    ),
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
  const signataire = aPermission(auth.roles, "qualite.signer");
  if (c.decision !== "en_attente" && !signataire) throw interdit();
  // Après une décision, seule une personne habilitée à décider réévalue (sous le verrou de la mission).
  const precedente = await db.query(
    `SELECT niveau_risque,
       EXISTS (SELECT 1 FROM qualite_acceptations d
               WHERE d.mission_id = $1 AND d.decision <> 'en_attente') AS decidee
     FROM qualite_acceptations WHERE mission_id = $1 ORDER BY rang DESC LIMIT 1`,
    [missionId],
  );
  const derniere = precedente.rows[0] as
    { niveau_risque: NiveauRisqueClient; decidee: boolean } | undefined;
  if (derniere?.decidee && !signataire) throw interdit();
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
  if (derniere?.decidee && rangNiveau(retenu) < rangNiveau(derniere.niveau_risque)) {
    throw new AppError(
      409,
      "NIVEAU_RISQUE_ABAISSE",
      `Une décision a été prise : le niveau de risque retenu ne descend plus sous « ${derniere.niveau_risque} ».`,
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

/** Relations ACTIVES (non retirées) ; `voirNote` : la note interne n'est servie qu'avec qualite.signer. */
export async function listerRelations(db: Db, clientId: string | null, voirNote: boolean) {
  const r = await db.query(
    `SELECT r.id, r.client_id, a.raison_sociale AS client_nom, r.client_lie_id,
       b.raison_sociale AS client_lie_nom, r.nature, r.note, r.cree_le
     FROM qualite_relations_clients r
     JOIN clients a ON a.id = r.client_id JOIN clients b ON b.id = r.client_lie_id
     WHERE ($1::uuid IS NULL OR r.client_id = $1 OR r.client_lie_id = $1) AND ${RELATION_ACTIVE}
     ORDER BY lower(a.raison_sociale), r.id`,
    [clientId],
  );
  return {
    elements: r.rows.map((l) =>
      selonDroitNote(l as { id: string; note?: string | null }, voirNote),
    ),
  };
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
  return (await listerRelations(db, c.client_id, true)).elements.find((e) => e.id === r.rows[0].id);
}

/** Retrait d'une relation : événement en ajout seul (la relation reste dans l'historique). */
export async function retirerRelation(db: Db, auth: Auth, id: string): Promise<void> {
  const r = await db.query(
    `SELECT r.client_id, r.client_lie_id, r.nature FROM qualite_relations_clients r
     WHERE r.id = $1 AND ${RELATION_ACTIVE}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Relation");
  await db.query(
    "INSERT INTO qualite_relations_retraits (cabinet_id, relation_id, retire_par) VALUES ($1, $2, $3)",
    [auth.cabinetId, id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.relation.retirer",
    entite: "qualite_relation_client",
    entiteId: id,
    details: r.rows[0],
  });
}
