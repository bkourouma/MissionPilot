import {
  controlerProposition,
  definitionDepuisSelection,
  dureeSelection,
  exigerItemValide,
  selectionnerItems,
  type ItemBanque,
  type ItemSelectionne,
  type ReglesSelection,
} from "@missionpilot/engines";
import {
  GRILLE_GENERIQUE,
  type ItemBanqueDonnees,
  type SelectionNotation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { paginer } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { exigerExpertMetier, exigerMissionOuverte } from "../questionnaires/acces.js";

/*
 * Banque d'items standard étalonnée et questionnaire adaptatif contrôlé (NOT-09, migration
 * 0400). RÈGLES (testées dans test/notation-augmentee.test.ts, doublées en base) :
 *
 * 1. Un item est versionné : brouillon modifiable par qui rédige (notation.gerer ou
 *    notation.publier), validé par un expert métier qui n'en est ni l'auteur ni le dernier
 *    modificateur (MPN04), puis figé (MPN08). Le contenu est contrôlé par le moteur.
 * 2. Seule la DERNIÈRE version VALIDÉE de chaque code sert à une sélection ; un brouillon
 *    n'y entre jamais (contrôle ici, puis MPN09 sur chaque ligne enregistrée).
 * 3. La sélection est faite par le moteur (`selectionnerItems`) ou proposée (IA, consultant)
 *    puis contrôlée par le moteur (`controlerProposition`) : jamais d'item hors banque ni de
 *    formulation libre. La définition du questionnaire est construite par le moteur.
 * 4. Une sélection enregistrée l'est en ajout seul, rattachée à une mission visible et ouverte.
 * Aucun appel IA ici : une proposition de l'IA arrive par le même contrôle que celle d'un humain.
 */

/** Au-delà, la banque doit être découpée par dimension (sélection refusée, jamais tronquée). */
export const BANQUE_SELECTION_MAX = 2000;

interface LigneItem {
  id: string;
  code: string;
  version: number;
  dimension: string;
  pratique: string;
  statut: "brouillon" | "valide";
  contenu: ItemBanque;
  cree_par: string;
  modifie_par: string;
  valide_par: string | null;
}

const COLONNES = `i.id, i.code, i.version, i.dimension, i.pratique, i.statut, i.contenu, i.cree_par,
  i.cree_le, i.modifie_par, i.modifie_le, i.valide_par, i.valide_le`;

function controler(contenu: ItemBanqueDonnees): ItemBanque {
  const item = contenu as ItemBanque;
  exigerItemValide(item);
  return item;
}

/** Banque du cabinet : dernière version de chaque code (filtres sur cette version). */
export async function listerItems(
  db: Db,
  filtres: { dimension?: string; statut?: string },
  apres: [string, string] | null,
  limite: number,
) {
  const r = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (i.code) i.id, i.code, i.version, i.dimension, i.pratique, i.statut,
         i.contenu ->> 'intitule' AS intitule, i.modifie_le, i.code AS cle_tri,
         (SELECT v.version FROM notation_banque_items v WHERE v.code = i.code AND v.statut = 'valide'
          ORDER BY v.version DESC LIMIT 1) AS version_validee
       FROM notation_banque_items i ORDER BY i.code, i.version DESC) d
     WHERE ($1::text IS NULL OR (d.cle_tri, d.id) > ($1, $2::uuid))
       AND ($3::text IS NULL OR d.dimension = $3) AND ($4::text IS NULL OR d.statut = $4)
     ORDER BY d.cle_tri, d.id LIMIT $5`,
    [
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      filtres.dimension ?? null,
      filtres.statut ?? null,
      limite + 1,
    ],
  );
  return paginer(r.rows as { cle_tri: string; id: string }[], limite);
}

async function ligneItem(db: Db, id: string, verrouiller = false): Promise<LigneItem> {
  const r = await db.query(
    `SELECT ${COLONNES} FROM notation_banque_items i WHERE i.id = $1 ${verrouiller ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Item de la banque");
  return r.rows[0] as LigneItem;
}

/** Une version d'item et l'historique des versions de son code. */
export async function lireItem(db: Db, id: string) {
  const item = await ligneItem(db, id);
  const v = await db.query(
    `SELECT i.id, i.version, i.statut, i.cree_le, i.valide_le FROM notation_banque_items i
     WHERE i.code = $1 ORDER BY i.version DESC`,
    [item.code],
  );
  return { ...item, versions: v.rows };
}

/** Nouvelle version (1 pour un nouveau code) en brouillon ; un seul brouillon par code. */
export async function creerItem(db: Db, auth: Auth, contenu: ItemBanqueDonnees) {
  const item = controler(contenu);
  const p = await db.query(
    `SELECT max(version) AS v, bool_or(statut = 'brouillon') AS brouillon
     FROM notation_banque_items WHERE code = $1`,
    [item.code],
  );
  if (p.rows[0]?.brouillon) throw conflit("Un brouillon existe déjà pour cet item : modifiez-le.");
  const precedente = await db.query(
    `SELECT dimension, pratique FROM notation_banque_items WHERE code = $1
     ORDER BY version DESC LIMIT 1`,
    [item.code],
  );
  const avant = precedente.rows[0] as { dimension: string; pratique: string } | undefined;
  if (avant && (avant.dimension !== item.dimension || avant.pratique !== item.pratique)) {
    throw requeteInvalide(
      "La dimension et la pratique d'un item ne changent pas d'une version à l'autre.",
    );
  }
  const version = ((p.rows[0]?.v as number | null) ?? 0) + 1;
  const r = await db.query(
    `INSERT INTO notation_banque_items (cabinet_id, code, version, dimension, pratique, contenu,
       cree_par, modifie_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [
      auth.cabinetId,
      item.code,
      version,
      item.dimension,
      item.pratique,
      JSON.stringify(item),
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "creation",
    entite: "notation_banque_item",
    entiteId: id,
    details: { code: item.code, version },
  });
  return lireItem(db, id);
}

/** Modification d'un brouillon (code, dimension et pratique figés). */
export async function modifierItem(db: Db, auth: Auth, id: string, contenu: ItemBanqueDonnees) {
  const ligne = await ligneItem(db, id, true);
  if (ligne.statut !== "brouillon") {
    throw new AppError(409, "ITEM_FIGE", "Un item validé est figé : créez une nouvelle version.");
  }
  const item = controler(contenu);
  if (
    item.code !== ligne.code ||
    item.dimension !== ligne.dimension ||
    item.pratique !== ligne.pratique
  ) {
    throw requeteInvalide("Le code, la dimension et la pratique d'une version sont figés.");
  }
  await db.query("UPDATE notation_banque_items SET contenu = $2, modifie_par = $3 WHERE id = $1", [
    id,
    JSON.stringify(item),
    auth.utilisateurId,
  ]);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "modification",
    entite: "notation_banque_item",
    entiteId: id,
    details: { code: ligne.code, version: ligne.version },
  });
  return lireItem(db, id);
}

/** Validation par un expert métier qui n'est ni l'auteur ni le dernier modificateur (MPN04). */
export async function validerItem(db: Db, auth: Auth, id: string) {
  exigerExpertMetier(auth, "valide un item de la banque");
  const ligne = await ligneItem(db, id, true);
  if (ligne.statut !== "brouillon") throw conflit("Cette version est déjà validée.");
  if (auth.utilisateurId === ligne.cree_par || auth.utilisateurId === ligne.modifie_par) {
    throw new AppError(
      403,
      "SEPARATION_DES_TACHES",
      "L'auteur ou le dernier modificateur d'un item ne le valide pas : un autre expert doit relire.",
    );
  }
  await db.query(
    `UPDATE notation_banque_items SET statut = 'valide', valide_par = $2, valide_le = now()
     WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "validation",
    entite: "notation_banque_item",
    entiteId: id,
    details: { code: ligne.code, version: ligne.version },
  });
  return lireItem(db, id);
}

/** Dernière version VALIDÉE de chaque code, avec son identifiant. */
async function banqueValidee(db: Db): Promise<{ items: ItemBanque[]; ids: Map<string, string> }> {
  const r = await db.query(
    `SELECT DISTINCT ON (i.code) i.id, i.code, i.contenu FROM notation_banque_items i
     WHERE i.statut = 'valide' ORDER BY i.code, i.version DESC LIMIT $1`,
    [BANQUE_SELECTION_MAX + 1],
  );
  if (r.rows.length > BANQUE_SELECTION_MAX) {
    throw conflit(
      "La banque validée est trop volumineuse pour une sélection : restreignez les dimensions.",
    );
  }
  return {
    items: r.rows.map((l) => l.contenu as ItemBanque),
    ids: new Map(r.rows.map((l) => [l.code as string, l.id as string])),
  };
}

function regles(corps: SelectionNotation): ReglesSelection {
  const r = corps.regles;
  return {
    public: r.public,
    maxParDimension: r.max_par_dimension,
    ...(r.dimensions ? { dimensions: r.dimensions } : {}),
    ...(r.duree_max_secondes !== undefined ? { dureeMaxSecondes: r.duree_max_secondes } : {}),
    ...(r.exclure ? { exclure: r.exclure } : {}),
    ...(r.pratiques_connues ? { pratiquesConnues: r.pratiques_connues } : {}),
  };
}

const vueItemSelectionne = (i: ItemSelectionne) => ({
  code: i.code,
  dimension: i.dimension,
  pratique: i.pratique,
  formulation: i.formulation,
  duree_secondes: i.dureeSecondes,
});

const LIBELLES_DIMENSIONS: Record<string, string> = Object.fromEntries(
  GRILLE_GENERIQUE.dimensions.map((d) => [d.id, d.libelle]),
);

/**
 * Questionnaire adaptatif d'une mission : sélection par le moteur ou proposition contrôlée,
 * définition construite par le moteur ; enregistrée en ajout seul si `enregistrer`.
 */
export async function selectionner(
  db: Db,
  auth: Auth,
  missionId: string,
  corps: SelectionNotation,
) {
  if (corps.enregistrer) await exigerMissionOuverte(db, auth, missionId);
  else await exigerMissionVisible(db, auth, missionId);
  const banque = await banqueValidee(db);
  const r = regles(corps);
  const calcul = corps.proposition
    ? {
        items: controlerProposition(banque.items, corps.proposition, r),
        ecartes: [],
        couverture: [],
      }
    : selectionnerItems(banque.items, r);
  if (calcul.items.length === 0) {
    throw conflit("Aucun item validé de la banque ne répond à ces règles.");
  }
  const titre = corps.titre ?? "Questionnaire adaptatif de notation";
  const definition = definitionDepuisSelection(banque.items, calcul.items, {
    id: "notation_adaptatif",
    titre,
    libellesDimensions: LIBELLES_DIMENSIONS,
  });
  const duree = dureeSelection(calcul.items);
  const origine = corps.proposition ? "proposition" : "moteur";
  let selectionId: string | null = null;
  if (corps.enregistrer) {
    selectionId = await enregistrerSelection(db, auth, missionId, {
      origine,
      corps,
      definition,
      duree,
      items: calcul.items.map((i) => ({
        id: banque.ids.get(i.code) as string,
        public: i.formulation.public,
      })),
    });
  }
  return {
    selection_id: selectionId,
    origine,
    public: corps.regles.public,
    items: calcul.items.map(vueItemSelectionne),
    ecartes: calcul.ecartes,
    couverture: calcul.couverture,
    duree_totale_secondes: duree,
    definition,
  };
}

async function enregistrerSelection(
  db: Db,
  auth: Auth,
  missionId: string,
  s: {
    origine: string;
    corps: SelectionNotation;
    definition: unknown;
    duree: number;
    items: { id: string; public: string }[];
  },
): Promise<string> {
  const r = await db.query(
    `INSERT INTO notation_selections (cabinet_id, mission_id, public, origine, regles, definition,
       duree_secondes, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      missionId,
      s.corps.regles.public,
      s.origine,
      JSON.stringify(s.corps.regles),
      JSON.stringify(s.definition),
      s.duree,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  for (const [rang, item] of s.items.entries()) {
    await db.query(
      `INSERT INTO notation_selection_items (cabinet_id, selection_id, rang, item_id, public_formulation)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.cabinetId, id, rang + 1, item.id, item.public],
    );
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "selection",
    entite: "notation_selection",
    entiteId: id,
    details: { mission_id: missionId, origine: s.origine, items: s.items.length },
  });
  return id;
}

/** Sélections enregistrées d'une mission visible, plus récentes d'abord. */
export async function listerSelections(
  db: Db,
  auth: Auth,
  missionId: string,
  apres: [string, string] | null,
  limite: number,
) {
  await exigerMissionVisible(db, auth, missionId);
  const r = await db.query(
    `SELECT s.id, s.public, s.origine, s.regles, s.definition, s.duree_secondes, s.cree_par,
       u.nom AS cree_par_nom, s.cree_le, s.cree_le::text AS cle_tri,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'version', i.version,
          'public_formulation', x.public_formulation) ORDER BY x.rang), '[]'::jsonb)
        FROM notation_selection_items x JOIN notation_banque_items i ON i.id = x.item_id
        WHERE x.selection_id = s.id) AS items
     FROM notation_selections s JOIN utilisateurs u ON u.id = s.cree_par
     WHERE s.mission_id = $1
       AND ($2::text IS NULL OR (s.cree_le, s.id) < ($2::timestamptz, $3::uuid))
     ORDER BY s.cree_le DESC, s.id DESC LIMIT $4`,
    [missionId, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return paginer(r.rows as { cle_tri: string; id: string }[], limite);
}
