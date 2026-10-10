import {
  formaterCentiemesJours,
  matriceCompetences,
  sommeCentiemes,
  tempsParBrique,
} from "@missionpilot/engines";
import type {
  CompetenceCreation,
  competenceModificationSchema,
  decisionCompetenceSchema,
  declarationCompetenceSchema,
  matriceQuerySchema,
} from "@missionpilot/shared";
import { aPermission } from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";

/*
 * Matrice de compétences (CAP-06). Le référentiel et la validation des niveaux relèvent de
 * `competence.gerer` (associé, directeur de mission, responsable des ressources) ; la lecture de
 * la matrice de TOUS les collaborateurs, de `competence.lire` (mêmes rôles : c'est une donnée
 * d'évaluation individuelle, pas un simple annuaire) ; chacun déclare et lit SES niveaux. Dans la
 * matrice, temps (centièmes, jours), preuves et dernier usage exigent EN PLUS `budget.lire_jours`
 * (champs ABSENTS sans ce droit). Une seule déclaration EN ATTENTE par couple (collaborateur,
 * compétence) et 50 déclarations au plus par couple (doublé en base, MPJ06 et MPJ07).
 * Un niveau n'est jamais posé par le calcul : déclaration puis décision humaine, jamais
 * par la personne évaluée, ni par son déclarant sauf associé (doublé en base, MPJ04). Les preuves
 * d'usage viennent des missions (temps validé sur une brique rattachée) et des revues qualité
 * (auteur ou relecteur d'un livrable), relevées à la validation du retour d'expérience.
 */

const COLONNES = `id, code, libelle, description, briques, types_livrable, active, cree_le, modifie_le`;

export async function listerCompetences(db: Db) {
  const r = await db.query(`SELECT ${COLONNES} FROM competences ORDER BY lower(libelle), id`);
  return { elements: r.rows };
}

export async function creerCompetence(db: Db, auth: Auth, c: CompetenceCreation) {
  const r = await db.query(
    `INSERT INTO competences (cabinet_id, code, libelle, description, briques, types_livrable, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLONNES}`,
    [
      auth.cabinetId,
      c.code,
      c.libelle,
      c.description ?? null,
      c.briques,
      c.types_livrable,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.competence.creer",
    entite: "competence",
    entiteId: r.rows[0].id,
    details: { code: c.code },
  });
  return r.rows[0];
}

export async function modifierCompetence(
  db: Db,
  auth: Auth,
  id: string,
  m: z.infer<typeof competenceModificationSchema>,
) {
  const r = await db.query(
    `UPDATE competences SET libelle = coalesce($2, libelle),
       description = CASE WHEN $3::boolean THEN $4 ELSE description END,
       briques = coalesce($5, briques), types_livrable = coalesce($6, types_livrable),
       active = coalesce($7, active), modifie_le = now()
     WHERE id = $1 RETURNING ${COLONNES}`,
    [
      id,
      m.libelle ?? null,
      m.description !== undefined,
      m.description ?? null,
      m.briques ?? null,
      m.types_livrable ?? null,
      m.active ?? null,
    ],
  );
  if (!r.rows[0]) throw introuvable("Compétence");
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.competence.modifier",
    entite: "competence",
    entiteId: id,
    details: { champs: Object.keys(m).filter((k) => m[k as keyof typeof m] !== undefined) },
  });
  return r.rows[0];
}

async function collaborateurDe(db: Db, auth: Auth): Promise<string | null> {
  const r = await db.query(`SELECT id FROM collaborateurs WHERE utilisateur_id = $1 AND actif`, [
    auth.utilisateurId,
  ]);
  return (r.rows[0]?.id as string | undefined) ?? null;
}

/** Déclarations d'un même couple (collaborateur, compétence) au plus (historique en ajout seul). */
export const DECLARATIONS_MAX_PAR_COUPLE = 50;

/**
 * Une déclaration en attente à la fois et un plafond par couple : sans cela, l'historique en
 * ajout seul se gonflerait sans limite. Sérialisé par couple (verrou consultatif) ; le
 * déclencheur MPJ06/MPJ07 (migration 0465) dit la même règle si ce code est contourné.
 */
async function limiterDeclarations(db: Db, collaborateurId: string, competenceId: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `cap_declaration:${collaborateurId}:${competenceId}`,
  ]);
  const r = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM competence_decisions x WHERE x.declaration_id = d.id))::int AS en_attente
     FROM competence_declarations d WHERE d.collaborateur_id = $1 AND d.competence_id = $2`,
    [collaborateurId, competenceId],
  );
  const { total, en_attente } = r.rows[0] as { total: number; en_attente: number };
  if (en_attente > 0) {
    throw new AppError(
      409,
      "DECLARATION_EN_ATTENTE",
      "Une déclaration est déjà en attente de décision pour cette compétence.",
    );
  }
  if (total >= DECLARATIONS_MAX_PAR_COUPLE) {
    throw new AppError(
      409,
      "PLAFOND_DECLARATIONS",
      `Au plus ${DECLARATIONS_MAX_PAR_COUPLE} déclarations par compétence et par collaborateur.`,
    );
  }
}

export async function declarerCompetence(
  db: Db,
  auth: Auth,
  d: z.infer<typeof declarationCompetenceSchema>,
) {
  const soi = await collaborateurDe(db, auth);
  const collaborateurId = d.collaborateur_id ?? soi;
  if (!collaborateurId) {
    throw new AppError(
      409,
      "COLLABORATEUR_NON_RATTACHE",
      "Votre compte n'est rattaché à aucun collaborateur.",
    );
  }
  if (collaborateurId !== soi && !aPermission(auth.roles, "competence.gerer")) throw interdit();
  const c = await db.query(`SELECT 1 FROM collaborateurs WHERE id = $1 AND actif`, [
    collaborateurId,
  ]);
  if (!c.rowCount) throw introuvable("Collaborateur");
  const k = await db.query(`SELECT active FROM competences WHERE id = $1`, [d.competence_id]);
  if (!k.rows[0]) throw introuvable("Compétence");
  if (k.rows[0].active !== true)
    throw new AppError(409, "COMPETENCE_INACTIVE", "Cette compétence est désactivée.");
  await limiterDeclarations(db, collaborateurId, d.competence_id);
  const r = await db.query(
    `INSERT INTO competence_declarations (cabinet_id, collaborateur_id, competence_id, niveau,
       commentaire, declare_par) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, cree_le`,
    [
      auth.cabinetId,
      collaborateurId,
      d.competence_id,
      d.niveau,
      d.commentaire ?? null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.competence.declarer",
    entite: "competence_declaration",
    entiteId: r.rows[0].id,
    details: {
      collaborateur_id: collaborateurId,
      competence_id: d.competence_id,
      niveau: d.niveau,
    },
  });
  return { id: r.rows[0].id as string, collaborateur_id: collaborateurId, niveau: d.niveau };
}

const separation = (message: string) => new AppError(403, "SEPARATION_DES_TACHES", message);

export async function deciderDeclaration(
  db: Db,
  auth: Auth,
  declarationId: string,
  d: z.infer<typeof decisionCompetenceSchema>,
) {
  const r = await db.query(
    `SELECT dc.declare_par, c.utilisateur_id FROM competence_declarations dc
     JOIN collaborateurs c ON c.id = dc.collaborateur_id WHERE dc.id = $1`,
    [declarationId],
  );
  const decl = r.rows[0] as { declare_par: string; utilisateur_id: string | null } | undefined;
  if (!decl) throw introuvable("Déclaration");
  if (decl.utilisateur_id === auth.utilisateurId) {
    throw separation("Un niveau ne se valide pas par la personne évaluée.");
  }
  if (decl.declare_par === auth.utilisateurId && !estAssocie(auth)) {
    throw separation("Le déclarant ne valide pas sa propre déclaration (sauf associé).");
  }
  await db.query(
    `INSERT INTO competence_decisions (cabinet_id, declaration_id, decision, commentaire, decide_par)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, declarationId, d.decision, d.commentaire ?? null, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.competence.decider",
    entite: "competence_declaration",
    entiteId: declarationId,
    details: { decision: d.decision },
  });
  return { declaration_id: declarationId, decision: d.decision };
}

async function donneesMatrice(db: Db, collaborateurs: string[], competences: string[]) {
  const decl = await db.query(
    `SELECT id, collaborateur_id, competence_id, niveau, cree_le::text AS cree_le
     FROM competence_declarations
     WHERE collaborateur_id = ANY ($1::uuid[]) AND competence_id = ANY ($2::uuid[])`,
    [collaborateurs, competences],
  );
  const dec = await db.query(
    `SELECT x.declaration_id, x.decision FROM competence_decisions x
     JOIN competence_declarations d ON d.id = x.declaration_id
     WHERE d.collaborateur_id = ANY ($1::uuid[])`,
    [collaborateurs],
  );
  const preuves = await db.query(
    `SELECT collaborateur_id, competence_id, centiemes::text AS centiemes, date_preuve::text AS date
     FROM competence_preuves
     WHERE collaborateur_id = ANY ($1::uuid[]) AND competence_id = ANY ($2::uuid[])`,
    [collaborateurs, competences],
  );
  return matriceCompetences({
    collaborateurs,
    competences,
    declarations: decl.rows,
    decisions: dec.rows,
    preuves: preuves.rows.map((p) => ({
      ...p,
      centiemes: p.centiemes === null ? null : Number(p.centiemes),
    })),
  });
}

type CelluleMoteur = ReturnType<typeof matriceCompetences>[number]["cellules"][number];

/** Vue complète : ses propres cellules (ses temps lui appartiennent). */
const vueCellule = (c: CelluleMoteur) => ({
  ...c,
  jours: formaterCentiemesJours(c.centiemes),
});

/**
 * Vue de groupe (matrice de l'équipe) : niveaux et attentes ; temps, preuves et dernier usage
 * seulement avec `budget.lire_jours` (champs ABSENTS sinon, jamais masqués par un zéro).
 */
export function vueCelluleGroupe(c: CelluleMoteur, avecJours: boolean) {
  if (avecJours) return vueCellule(c);
  const sans: Partial<CelluleMoteur> = { ...c };
  delete sans.preuves;
  delete sans.centiemes;
  delete sans.derniere_preuve;
  return sans as Omit<CelluleMoteur, "preuves" | "centiemes" | "derniere_preuve">;
}

/** Matrice des collaborateurs actifs × compétences actives (ou une seule compétence). */
export async function matrice(db: Db, auth: Auth, q: z.infer<typeof matriceQuerySchema>) {
  const avecJours = aPermission(auth.roles, "budget.lire_jours");
  const comp = await db.query(
    `SELECT id, code, libelle FROM competences WHERE active AND ($1::uuid IS NULL OR id = $1)
     ORDER BY lower(libelle), id`,
    [q.competence_id ?? null],
  );
  const coll = await db.query(
    `SELECT c.id, c.nom, g.libelle AS grade FROM collaborateurs c LEFT JOIN grades g ON g.id = c.grade_id
     WHERE c.actif ORDER BY lower(c.nom), c.id`,
  );
  const lignes = await donneesMatrice(
    db,
    coll.rows.map((c) => c.id as string),
    comp.rows.map((c) => c.id as string),
  );
  return {
    competences: comp.rows,
    lignes: lignes.map((l, i) => ({
      collaborateur: coll.rows[i],
      cellules: l.cellules.map((c) => vueCelluleGroupe(c, avecJours)),
    })),
  };
}

/** Ses propres compétences : niveaux, déclarations en attente, preuves d'usage. */
export async function mesCompetences(db: Db, auth: Auth) {
  const soi = await collaborateurDe(db, auth);
  const comp = await db.query(
    `SELECT id, code, libelle FROM competences WHERE active ORDER BY lower(libelle), id`,
  );
  if (!soi) return { collaborateur_id: null, competences: comp.rows, cellules: [] };
  const [ligne] = await donneesMatrice(
    db,
    [soi],
    comp.rows.map((c) => c.id as string),
  );
  return {
    collaborateur_id: soi,
    competences: comp.rows,
    cellules: (ligne?.cellules ?? []).map(vueCellule),
  };
}

/* ----- Preuves d'usage ----- */

interface CompetenceSource {
  id: string;
  briques: string[];
  types_livrable: string[];
}

async function preuvesTemps(db: Db, missionId: string, competences: CompetenceSource[]) {
  const ratt = await db.query(
    `SELECT tache_id, brique_code FROM cap_taches_briques WHERE mission_id = $1`,
    [missionId],
  );
  const lignes = await db.query(
    `SELECT f.collaborateur_id, l.tache_id, l.centiemes FROM lignes_temps l
     JOIN feuilles_temps f ON f.id = l.feuille_id
     WHERE l.mission_id = $1 AND f.statut IN ('validee', 'verrouillee')`,
    [missionId],
  );
  const parCollab = new Map<string, { tache_id: string; centiemes: number }[]>();
  for (const l of lignes.rows) {
    parCollab.set(l.collaborateur_id, [...(parCollab.get(l.collaborateur_id) ?? []), l]);
  }
  const preuves: {
    collaborateur_id: string;
    competence_id: string;
    centiemes: number;
    briques: string[];
  }[] = [];
  for (const [collab, temps] of parCollab) {
    const parBrique = tempsParBrique(ratt.rows, temps, []).filter((b) => b.realise_centiemes > 0);
    for (const k of competences) {
      const utiles = parBrique.filter((b) => k.briques.includes(b.brique_code));
      if (utiles.length === 0) continue;
      preuves.push({
        collaborateur_id: collab,
        competence_id: k.id,
        centiemes: sommeCentiemes(utiles.map((b) => b.realise_centiemes)),
        briques: utiles.map((b) => b.brique_code),
      });
    }
  }
  return preuves;
}

/**
 * SERVICE INTERNE : relève les preuves d'usage d'une mission (temps sur les briques, livrables
 * rédigés ou relus), dédoublonnées ; n'attribue aucun niveau. Rend le nombre de preuves ajoutées.
 */
export async function actualiserPreuvesCompetences(db: Db, missionId: string): Promise<number> {
  const k = await db.query(`SELECT id, briques, types_livrable FROM competences WHERE active`);
  const competences = k.rows as CompetenceSource[];
  if (competences.length === 0) return 0;
  const m = await db.query(
    `SELECT coalesce(cloturee_le, now())::date::text AS d FROM missions WHERE id = $1`,
    [missionId],
  );
  const date = m.rows[0]?.d as string;
  let ajoutees = 0;
  for (const p of await preuvesTemps(db, missionId, competences)) {
    const r = await db.query(
      `INSERT INTO competence_preuves (cabinet_id, collaborateur_id, competence_id, source_type,
         source_id, mission_id, centiemes, date_preuve, detail)
       SELECT cabinet_id, $1, $2, 'temps_brique', $3, $3, $4, $5, $6 FROM missions WHERE id = $3
       ON CONFLICT (collaborateur_id, competence_id, source_type, source_id) DO NOTHING`,
      [
        p.collaborateur_id,
        p.competence_id,
        missionId,
        p.centiemes,
        date,
        p.briques.join(", ").slice(0, 300),
      ],
    );
    ajoutees += r.rowCount ?? 0;
  }
  const revues = await db.query(
    `SELECT s.id AS suivi_id, s.type_livrable, s.auteur_id AS utilisateur_id, 'livrable_auteur' AS source,
            s.ouvert_le::date::text AS d, s.libelle AS detail
       FROM qualite_suivis s WHERE s.mission_id = $1 AND s.auteur_id IS NOT NULL
     UNION ALL
     SELECT s.id, s.type_livrable, v.acteur_id, 'revue', v.valide_le::date::text, v.etape
       FROM qualite_validations v JOIN qualite_suivis s ON s.id = v.suivi_id WHERE s.mission_id = $1`,
    [missionId],
  );
  for (const rv of revues.rows) {
    for (const c of competences.filter((x) => x.types_livrable.includes(rv.type_livrable))) {
      const r = await db.query(
        `INSERT INTO competence_preuves (cabinet_id, collaborateur_id, competence_id, source_type,
           source_id, mission_id, date_preuve, detail)
         SELECT co.cabinet_id, co.id, $2, $3, $4, $5, $6, $7 FROM collaborateurs co
         WHERE co.utilisateur_id = $1
         ON CONFLICT (collaborateur_id, competence_id, source_type, source_id) DO NOTHING`,
        [
          rv.utilisateur_id,
          c.id,
          rv.source,
          rv.suivi_id,
          missionId,
          rv.d,
          String(rv.detail).slice(0, 300),
        ],
      );
      ajoutees += r.rowCount ?? 0;
    }
  }
  return ajoutees;
}
