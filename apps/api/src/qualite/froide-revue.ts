import { calculerRevueFroide, type ResultatRevueFroide } from "@missionpilot/engines";
import {
  aPermission,
  CRITERES_REVUE_FROIDE,
  GRILLE_REVUE_FROIDE_VERSION,
  mesRevuesQuerySchema,
  type constatFroidCreationSchema,
  type evaluationRevueFroideSchema,
} from "@missionpilot/shared";
import { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable, requeteInvalide } from "../errors.js";
import { notifier } from "../notifications/notifier.js";
import {
  accesEchantillon,
  candidatsRelecteurs,
  contexteIndependance,
  exigerCampagne,
  exigerEchantillon,
  exigerRelecteurAffecte,
  jugerIndependance,
  revueTerminee,
} from "./froide-donnees.js";
import { detailCampagne } from "./froide-tirage.js";

/*
 * Revue à froid d'une mission tirée (QUA-05) : affectation d'un relecteur INDÉPENDANT, grille,
 * constats, terminaison. Le score et la conclusion sortent du moteur `calculerRevueFroide`,
 * jamais d'un modèle de langage ; l'IA n'intervient pas dans ce module. Les règles de l'API sont
 * doublées par les déclencheurs MQQ01 à MQQ13 (migrations 0287 à 0290).
 */

const POIDS_GRILLE = CRITERES_REVUE_FROIDE.map((c) => ({ code: c.code, poids: c.poids }));

const SQL_MISSION_VUE = `m.id AS mission_id, m.intitule AS mission_intitule, m.statut AS mission_statut,
    m.date_debut::text AS mission_date_debut, m.date_fin::text AS mission_date_fin,
    m.cloturee_le AS mission_cloturee_le, cl.raison_sociale AS client_nom,
    t.libelle AS type_mission_libelle, d.nom AS directeur_nom`;
const SQL_MISSION_JOINTURES = `JOIN missions m ON m.id = e.mission_id
  JOIN clients cl ON cl.id = m.client_id
  LEFT JOIN types_mission t ON t.id = m.type_mission_id
  LEFT JOIN utilisateurs d ON d.id = m.directeur_id`;

export async function relecteursEligibles(db: Db, echantillonId: string) {
  const e = await exigerEchantillon(db, echantillonId);
  const contexte = await contexteIndependance(db, e.mission_id);
  return {
    echantillon_id: e.id,
    relecteurs: (await candidatsRelecteurs(db)).map((u) => {
      const j = jugerIndependance(contexte, u.id);
      return { id: u.id, nom: u.nom, eligible: j.independant, violations: j.violations };
    }),
  };
}

export async function affecterRelecteur(
  db: Db,
  auth: Auth,
  echantillonId: string,
  relecteurId: string,
) {
  const e = await exigerEchantillon(db, echantillonId, true);
  if (e.statut === "terminee") throw revueTerminee();
  // Revue commencée : le relecteur affecté tient la grille, il ne se remplace plus (doublé MQQ13).
  if (e.statut === "en_revue") {
    throw new AppError(
      409,
      "REAFFECTATION_EN_REVUE",
      "La revue est commencée : le relecteur ne peut plus être remplacé.",
    );
  }
  const u = await db.query("SELECT id, nom, roles, actif FROM utilisateurs WHERE id = $1", [
    relecteurId,
  ]);
  const relecteur = u.rows[0] as
    | { id: string; nom: string; roles: Parameters<typeof aPermission>[0]; actif: boolean }
    | undefined;
  // Un utilisateur d'un autre cabinet n'existe pas pour ce cabinet (RLS) : 404.
  if (!relecteur) throw introuvable("Relecteur");
  if (!relecteur.actif || !aPermission(relecteur.roles, "qualite.froide.relire")) {
    throw new AppError(
      409,
      "RELECTEUR_NON_HABILITE",
      "Le relecteur doit être un utilisateur actif habilité à la revue à froid.",
    );
  }
  const j = jugerIndependance(await contexteIndependance(db, e.mission_id), relecteurId);
  if (!j.independant) {
    throw new AppError(
      409,
      "RELECTEUR_NON_INDEPENDANT",
      "Le relecteur n'est pas indépendant de la mission tirée.",
      { violations: j.violations },
    );
  }
  await db.query(
    `UPDATE qualite_froide_echantillon
     SET relecteur_id = $2, affecte_par = $3, affecte_le = now(),
         statut = CASE WHEN statut = 'a_affecter' THEN 'affectee' ELSE statut END
     WHERE id = $1`,
    [e.id, relecteurId, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.affecter",
    entite: "qualite_froide_echantillon",
    entiteId: e.id,
    details: {
      campagne_id: e.campagne_id,
      relecteur_id: relecteurId,
      ancien_relecteur_id: e.relecteur_id,
    },
  });
  if (relecteurId !== auth.utilisateurId) {
    const m = await db.query("SELECT intitule FROM missions WHERE id = $1", [e.mission_id]);
    await notifier(db, {
      cabinetId: auth.cabinetId,
      destinataireId: relecteurId,
      type: "revue_froide_affectee",
      titre: "Revue à froid à réaliser",
      corps: `Vous êtes désigné relecteur indépendant de la mission « ${m.rows[0].intitule as string} ».`,
      lien: "/qualite/revue-froide",
    });
  }
  return detailRevue(db, auth, e.id);
}

/**
 * Curseur de « mes revues » : clé de la dernière ligne servie, dans l'ordre de la liste (non
 * terminées d'abord, affectation la plus récente d'abord, puis identifiant). Les directions de
 * tri sont mixtes : le curseur est propre à cette liste, validé par Zod (400 s'il est invalide).
 */
const cleMesRevues = z.tuple([
  z.union([z.literal(0), z.literal(1)]),
  z.string().regex(/^\d{20}$/),
  z.string().uuid(),
]);
type CleMesRevues = z.infer<typeof cleMesRevues>;

function decoderCurseurMesRevues(curseur: string | undefined): CleMesRevues | null {
  if (!curseur) return null;
  try {
    return cleMesRevues.parse(JSON.parse(Buffer.from(curseur, "base64url").toString("utf8")));
  } catch {
    throw requeteInvalide("Curseur de pagination invalide.");
  }
}

export async function mesRevues(
  db: Db,
  auth: Auth,
  requete: z.input<typeof mesRevuesQuerySchema> = {},
) {
  const q = mesRevuesQuerySchema.parse(requete);
  const apres = decoderCurseurMesRevues(q.curseur);
  const r = await db.query(
    `SELECT e.id, e.campagne_id, c.intitule AS campagne_intitule, e.rang, e.statut, e.affecte_le,
       e.score::float8 AS score, e.conclusion, e.terminee_le, ${SQL_MISSION_VUE},
       (SELECT count(*)::int FROM qualite_froide_evaluations v WHERE v.echantillon_id = e.id)
         AS criteres_evalues,
       ${CRITERES_REVUE_FROIDE.length} AS criteres_total,
       (e.statut = 'terminee')::int AS cle_terminee,
       to_char(e.affecte_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS cle_affecte
     FROM qualite_froide_echantillon e
     JOIN qualite_froide_campagnes c ON c.id = e.campagne_id
     ${SQL_MISSION_JOINTURES}
     WHERE e.relecteur_id = $1
       AND ($3::int IS NULL
            OR (e.statut = 'terminee')::int > $3
            OR ((e.statut = 'terminee')::int = $3
                AND (to_char(e.affecte_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') < $4
                     OR (to_char(e.affecte_le AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') = $4
                         AND e.id > $5::uuid))))
     ORDER BY cle_terminee, cle_affecte DESC, e.id LIMIT $2`,
    [auth.utilisateurId, q.limite + 1, apres?.[0] ?? null, apres?.[1] ?? null, apres?.[2] ?? null],
  );
  const lignes = r.rows as (Record<string, unknown> & {
    id: string;
    cle_terminee: 0 | 1;
    cle_affecte: string;
  })[];
  const page = lignes.slice(0, q.limite);
  const derniere = page[page.length - 1];
  const curseur_suivant =
    lignes.length > q.limite && derniere
      ? Buffer.from(
          JSON.stringify([derniere.cle_terminee, derniere.cle_affecte, derniere.id]),
          "utf8",
        ).toString("base64url")
      : null;
  return {
    elements: page.map(({ cle_terminee: _t, cle_affecte: _a, ...reste }) => reste),
    curseur_suivant,
  };
}

interface EvaluationLue {
  critere: string;
  note: number | null;
  commentaire: string | null;
  evaluateur_id: string;
  evalue_le: Date;
}

interface ConstatLu {
  id: string;
  critere: string | null;
  gravite: "mineur" | "majeur" | "critique";
  description: string;
  recommandation: string | null;
  auteur_id: string;
  cree_le: Date;
}

async function evaluationsDe(db: Db, id: string): Promise<EvaluationLue[]> {
  const r = await db.query(
    `SELECT critere, note, commentaire, evaluateur_id, evalue_le
     FROM qualite_froide_evaluations WHERE echantillon_id = $1`,
    [id],
  );
  const ordre = new Map<string, number>(CRITERES_REVUE_FROIDE.map((c, i) => [c.code, i]));
  return (r.rows as EvaluationLue[]).sort(
    (a, b) => (ordre.get(a.critere) ?? 0) - (ordre.get(b.critere) ?? 0),
  );
}

async function constatsDe(db: Db, id: string): Promise<ConstatLu[]> {
  const r = await db.query(
    `SELECT id, critere, gravite, description, recommandation, auteur_id, cree_le
     FROM qualite_froide_constats WHERE echantillon_id = $1 ORDER BY cree_le, id`,
    [id],
  );
  return r.rows as ConstatLu[];
}

function resultatMoteur(evaluations: EvaluationLue[], constats: ConstatLu[]): ResultatRevueFroide {
  return calculerRevueFroide(
    POIDS_GRILLE,
    evaluations.map((v) => ({ critere: v.critere, note: v.note })),
    constats,
  );
}

/** Détail d'une revue : mission, évaluations, constats, résultat du moteur et grille. */
export async function detailRevue(db: Db, auth: Auth, id: string) {
  const e = await accesEchantillon(db, auth, id);
  const c = await exigerCampagne(db, e.campagne_id);
  const mission = await db.query(
    `SELECT ${SQL_MISSION_VUE} FROM qualite_froide_echantillon e ${SQL_MISSION_JOINTURES}
     WHERE e.id = $1`,
    [id],
  );
  const relecteur = e.relecteur_id
    ? (await db.query("SELECT id, nom FROM utilisateurs WHERE id = $1", [e.relecteur_id])).rows[0]
    : null;
  const evaluations = await evaluationsDe(db, id);
  const constats = await constatsDe(db, id);
  return {
    echantillon: {
      id: e.id,
      rang: e.rang,
      statut: e.statut,
      campagne: { id: c.id, intitule: c.intitule, statut: c.statut },
      mission: mission.rows[0],
      relecteur,
      affecte_le: e.affecte_le,
      score: e.score,
      conclusion: e.conclusion,
      synthese: e.synthese,
      version_grille: e.version_grille,
      terminee_le: e.terminee_le,
    },
    evaluations,
    constats,
    resultat: resultatMoteur(evaluations, constats),
    grille: { version: GRILLE_REVUE_FROIDE_VERSION, criteres: CRITERES_REVUE_FROIDE },
    peut_ecrire: e.relecteur_id === auth.utilisateurId && e.statut !== "terminee",
  };
}

export async function evaluerCritere(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof evaluationRevueFroideSchema>,
) {
  const e = await exigerRelecteurAffecte(db, auth, id);
  if (e.statut === "terminee") throw revueTerminee();
  await db.query(
    `INSERT INTO qualite_froide_evaluations
       (cabinet_id, echantillon_id, critere, note, commentaire, evaluateur_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (echantillon_id, critere) DO UPDATE
       SET note = EXCLUDED.note, commentaire = EXCLUDED.commentaire,
           evaluateur_id = EXCLUDED.evaluateur_id, evalue_le = now()`,
    [auth.cabinetId, id, corps.critere, corps.note, corps.commentaire || null, auth.utilisateurId],
  );
  if (e.statut === "affectee") {
    await db.query("UPDATE qualite_froide_echantillon SET statut = 'en_revue' WHERE id = $1", [id]);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.evaluer",
    entite: "qualite_froide_echantillon",
    entiteId: id,
    details: { critere: corps.critere, note: corps.note },
  });
  return detailRevue(db, auth, id);
}

export async function ajouterConstat(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof constatFroidCreationSchema>,
) {
  const e = await exigerRelecteurAffecte(db, auth, id);
  if (e.statut === "terminee") throw revueTerminee();
  const r = await db.query(
    `INSERT INTO qualite_froide_constats
       (cabinet_id, echantillon_id, critere, gravite, description, recommandation, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      id,
      corps.critere ?? null,
      corps.gravite,
      corps.description,
      corps.recommandation || null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.constat.ajouter",
    entite: "qualite_froide_echantillon",
    entiteId: id,
    details: { constat_id: r.rows[0].id, gravite: corps.gravite, critere: corps.critere ?? null },
  });
  return { constat_id: r.rows[0].id as string, ...(await detailRevue(db, auth, id)) };
}

export async function retirerConstat(db: Db, auth: Auth, id: string, constatId: string) {
  const e = await exigerRelecteurAffecte(db, auth, id);
  if (e.statut === "terminee") throw revueTerminee();
  const r = await db.query(
    "DELETE FROM qualite_froide_constats WHERE id = $1 AND echantillon_id = $2 RETURNING gravite",
    [constatId, id],
  );
  if (!r.rows[0]) throw introuvable("Constat");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.constat.retirer",
    entite: "qualite_froide_echantillon",
    entiteId: id,
    details: { constat_id: constatId, gravite: r.rows[0].gravite },
  });
}

export async function terminerRevue(db: Db, auth: Auth, id: string, synthese: string) {
  const e = await exigerRelecteurAffecte(db, auth, id);
  if (e.statut === "terminee") throw revueTerminee();
  const evaluations = await evaluationsDe(db, id);
  const constats = await constatsDe(db, id);
  const r = resultatMoteur(evaluations, constats);
  if (!r.complete) {
    throw new AppError(
      409,
      "GRILLE_INCOMPLETE",
      "La grille doit être complète : évaluez chaque critère (ou déclarez-le sans objet).",
      { manquants: r.manquants },
    );
  }
  if (r.conclusion === null || r.score === null) {
    throw new AppError(
      409,
      "GRILLE_SANS_NOTE",
      "Tous les critères sont sans objet : aucune conclusion n'est possible.",
    );
  }
  await db.query(
    `UPDATE qualite_froide_echantillon
     SET statut = 'terminee', score = $2, conclusion = $3, synthese = $4, version_grille = $5,
         terminee_le = now()
     WHERE id = $1`,
    [id, r.score, r.conclusion, synthese, GRILLE_REVUE_FROIDE_VERSION],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.terminer",
    entite: "qualite_froide_echantillon",
    entiteId: id,
    details: { campagne_id: e.campagne_id, score: r.score, conclusion: r.conclusion },
  });
  return detailRevue(db, auth, id);
}

/** Clôt la campagne quand toutes les revues sont terminées (le plan d'amélioration continue après). */
export async function cloturerCampagne(db: Db, auth: Auth, id: string) {
  const c = await exigerCampagne(db, id, true);
  if (c.statut === "close") {
    throw new AppError(409, "CAMPAGNE_CLOSE", "La campagne est déjà close.");
  }
  const restantes = await db.query(
    `SELECT id FROM qualite_froide_echantillon WHERE campagne_id = $1 AND statut <> 'terminee'
     ORDER BY rang`,
    [id],
  );
  if (restantes.rows.length > 0) {
    throw new AppError(
      409,
      "REVUES_NON_TERMINEES",
      "Toutes les revues doivent être terminées avant de clore la campagne.",
      { manquants: restantes.rows.map((l) => l.id as string) },
    );
  }
  await db.query(
    `UPDATE qualite_froide_campagnes
     SET statut = 'close', cloturee_par = $2, cloturee_le = now() WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.froide.campagne.cloturer",
    entite: "qualite_froide_campagne",
    entiteId: id,
  });
  return detailCampagne(db, id);
}
