import type {
  propositionStandardCreationSchema,
  propositionStandardRevueSchema,
  propositionsStandardQuerySchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";

/*
 * Comité méthode (STD-12) : un expert propose une évolution (d'une méthode
 * visible, ou une nouvelle méthode), un AUTRE expert la prend en revue puis
 * l'accepte ou la refuse (motif), et l'acceptée se publie en citant la
 * version publiée du cabinet qui la porte. Tout passe par `standard.gerer`
 * (associé, expert métier) ; la lecture par `standard.lire`. Transitions et
 * séparation des tâches doublées en base (MPM05).
 */

const COLONNES = `p.id, p.methode_id, m.libelle AS methode_libelle, m.cabinet_id IS NULL AS methode_standard,
  p.titre, p.description, p.statut, p.auteur_id, ua.nom AS auteur_nom, p.relecteur_id,
  ur.nom AS relecteur_nom, p.avis, p.version_publiee_id, p.cree_le, p.revue_le, p.decide_le, p.publie_le`;

const JOINTURES = `FROM propositions_standard p
  LEFT JOIN methodes m ON m.id = p.methode_id
  LEFT JOIN utilisateurs ua ON ua.id = p.auteur_id
  LEFT JOIN utilisateurs ur ON ur.id = p.relecteur_id`;

async function lire(db: Db, id: string, verrouiller = false) {
  if (verrouiller) {
    const v = await db.query(`SELECT id FROM propositions_standard WHERE id = $1 FOR UPDATE`, [id]);
    if (!v.rowCount) throw introuvable("Proposition");
  }
  const r = await db.query(`SELECT ${COLONNES} ${JOINTURES} WHERE p.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Proposition");
  return r.rows[0];
}

export async function listerPropositions(
  db: Db,
  q: z.infer<typeof propositionsStandardQuerySchema>,
) {
  const curseur = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES}, p.cree_le::text AS cle_tri ${JOINTURES}
     WHERE ($1::text IS NULL OR p.statut = $1)
       AND ($2::timestamptz IS NULL OR (p.cree_le, p.id) < ($2::timestamptz, $3::uuid))
     ORDER BY p.cree_le DESC, p.id DESC
     LIMIT $4`,
    [q.statut ?? null, curseur?.[0] ?? null, curseur?.[1] ?? null, q.limite + 1],
  );
  return paginer(r.rows, q.limite);
}

export async function creerProposition(
  db: Db,
  auth: Auth,
  corps: z.infer<typeof propositionStandardCreationSchema>,
) {
  if (corps.methode_id) {
    const m = await db.query(`SELECT 1 FROM methodes WHERE id = $1`, [corps.methode_id]);
    if (!m.rowCount) throw requeteInvalide("Méthode inconnue.");
  }
  const r = await db.query(
    `INSERT INTO propositions_standard (cabinet_id, methode_id, titre, description, auteur_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [auth.cabinetId, corps.methode_id ?? null, corps.titre, corps.description, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.proposition.creer",
    entite: "proposition_standard",
    entiteId: r.rows[0].id,
    details: { methode_id: corps.methode_id ?? null },
  });
  return lire(db, r.rows[0].id);
}

const separation = () =>
  new AppError(
    403,
    "SEPARATION_DES_TACHES",
    "L'auteur d'une proposition ne la relit pas lui-même.",
  );

export async function revoirProposition(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof propositionStandardRevueSchema>,
) {
  const p = await lire(db, id, true);
  if (p.auteur_id === auth.utilisateurId) throw separation();
  const attendu = corps.action === "prendre_en_revue" ? "proposee" : "en_revue";
  if (p.statut !== attendu) {
    throw new AppError(
      409,
      "PROPOSITION_TRANSITION_REFUSEE",
      "Transition impossible depuis cet état.",
    );
  }
  if (corps.action !== "prendre_en_revue" && p.relecteur_id !== auth.utilisateurId) {
    throw new AppError(
      403,
      "RELECTEUR_ATTENDU",
      "Seul le relecteur désigné décide de la proposition.",
    );
  }
  if (corps.action === "prendre_en_revue") {
    await db.query(
      `UPDATE propositions_standard SET statut = 'en_revue', relecteur_id = $2, revue_le = now(),
         avis = coalesce($3, avis) WHERE id = $1`,
      [id, auth.utilisateurId, corps.avis ?? null],
    );
  } else {
    await db.query(
      `UPDATE propositions_standard SET statut = $2, decide_le = now(), avis = coalesce($3, avis)
       WHERE id = $1`,
      [id, corps.action === "accepter" ? "acceptee" : "refusee", corps.avis ?? null],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: `standard.proposition.${corps.action}`,
    entite: "proposition_standard",
    entiteId: id,
  });
  return lire(db, id);
}

export async function publierProposition(db: Db, auth: Auth, id: string, versionId: string) {
  const p = await lire(db, id, true);
  if (p.statut !== "acceptee") {
    throw new AppError(
      409,
      "PROPOSITION_TRANSITION_REFUSEE",
      "Seule une proposition acceptée se publie.",
    );
  }
  await db.query(
    `UPDATE propositions_standard SET statut = 'publiee', version_publiee_id = $2, publie_le = now()
     WHERE id = $1`,
    [id, versionId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "standard.proposition.publier",
    entite: "proposition_standard",
    entiteId: id,
    details: { version_id: versionId },
  });
  return lire(db, id);
}
