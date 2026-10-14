import {
  CATEGORIES_CREANCIER_RED,
  CATEGORIES_DECAISSEMENT_RED,
  CATEGORIES_ENCAISSEMENT_RED,
  CLES_RATIO_REDRESSEMENT,
  CODES_LEVIER,
  CRITERES_ALERTE,
  DOMAINES_URGENCE,
  POSTES_RATIO_REDRESSEMENT,
  REPONSES_URGENCE,
  SENS_CRITERE_ALERTE,
  STATUTS_ACTION_RED,
  VOLETS_PLAN_RED,
  CATALOGUE_LEVIERS,
} from "@missionpilot/engines";
import {
  RED_CATEGORIES_CREANCIER,
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  RED_CLES_RATIO,
  RED_CODES_LEVIER,
  RED_COLONNES_KANBAN,
  RED_CRITERE_ALERTE_SENS,
  RED_CRITERES_ALERTE,
  RED_DOMAINES,
  RED_FAMILLES_LEVIER,
  RED_NIVEAUX_ALERTE,
  RED_POSTES,
  RED_REPONSES_URGENCE,
  RED_SECTEURS,
  RED_SENS_FLUX,
  RED_SOURCES_SEUILS,
  RED_STATUTS_ACTION,
  RED_STATUTS_DOSSIER,
  RED_STATUTS_SEUILS,
  RED_STATUTS_VERSION_PLAN,
  RED_TYPES_EVENEMENT_ACTION,
  RED_TYPES_EVENEMENT_NEGOCIATION,
  RED_VOLETS,
  RED_VOYANTS,
} from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Parité des énumérations : MOTEUR ↔ SCHÉMAS PARTAGÉS (listes dupliquées, `packages/shared` n'importe pas
 * `packages/engines`) et SCHÉMAS PARTAGÉS ↔ BASE (valeurs des CHECK lues dans `pg_constraint`).
 */

let ctx: Contexte;

beforeAll(async () => {
  ctx = await demarrer();
});

afterAll(async () => {
  await ctx.fermer();
});

const trie = (l: readonly string[]) => [...l].sort();

describe("moteur ↔ schémas partagés", () => {
  it("postes, ratios, domaines, réponses, critères, catégories, volets, statuts, leviers", () => {
    expect(trie(POSTES_RATIO_REDRESSEMENT)).toEqual(trie(RED_POSTES));
    expect(trie(CLES_RATIO_REDRESSEMENT)).toEqual(trie(RED_CLES_RATIO));
    expect(trie(DOMAINES_URGENCE)).toEqual(trie(RED_DOMAINES));
    expect(trie(REPONSES_URGENCE)).toEqual(trie(RED_REPONSES_URGENCE));
    expect(trie(CRITERES_ALERTE)).toEqual(trie(RED_CRITERES_ALERTE));
    expect(trie(CATEGORIES_ENCAISSEMENT_RED)).toEqual(trie(RED_CATEGORIES_ENCAISSEMENT));
    expect(trie(CATEGORIES_DECAISSEMENT_RED)).toEqual(trie(RED_CATEGORIES_DECAISSEMENT));
    expect(trie(CATEGORIES_CREANCIER_RED)).toEqual(trie(RED_CATEGORIES_CREANCIER));
    expect(trie(VOLETS_PLAN_RED)).toEqual(trie(RED_VOLETS));
    expect(trie(STATUTS_ACTION_RED)).toEqual(trie(RED_STATUTS_ACTION));
    expect(trie(CODES_LEVIER)).toEqual(trie(RED_CODES_LEVIER));
    expect(trie(CATALOGUE_LEVIERS.map((l) => l.famille))).toEqual(
      trie(CATALOGUE_LEVIERS.map((l) => l.famille)),
    );
    for (const l of CATALOGUE_LEVIERS) expect(RED_FAMILLES_LEVIER).toContain(l.famille);
  });

  it("sens des critères d'alerte, colonnes du kanban", () => {
    expect(RED_CRITERE_ALERTE_SENS).toEqual(SENS_CRITERE_ALERTE);
    expect(RED_COLONNES_KANBAN).toEqual(["a_faire", "en_cours", "bloquee", "terminee"]);
    for (const c of RED_COLONNES_KANBAN) expect(STATUTS_ACTION_RED).toContain(c);
  });
});

/** Valeurs entre apostrophes des CHECK d'une table qui portent sur `colonne`. */
async function valeursCheck(table: string, colonne: string): Promise<string[]> {
  const r = await proprietaire((c) =>
    c.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = $1::regclass AND contype = 'c'`,
      [table],
    ),
  );
  const valeurs = new Set<string>();
  for (const { def } of r.rows as { def: string }[]) {
    if (!new RegExp(`\\(?${colonne}\\b`).test(def) || !/ANY|IN \(/.test(def)) continue;
    // Seules les constantes de la liste qui suit le nom de la colonne.
    for (const m of def.matchAll(/'([a-z0-9_]+)'::text/g)) valeurs.add(m[1] as string);
  }
  return [...valeurs].sort();
}

describe("schémas partagés ↔ base (CHECK)", () => {
  const cas: [string, string, readonly string[]][] = [
    ["red_dossiers", "secteur", RED_SECTEURS],
    ["red_dossiers", "statut", RED_STATUTS_DOSSIER],
    ["red_seuils_versions", "secteur", RED_SECTEURS],
    ["red_seuils_versions", "statut", RED_STATUTS_SEUILS],
    ["red_scores", "secteur", RED_SECTEURS],
    ["red_scores", "seuils_source", RED_SOURCES_SEUILS],
    ["red_scores", "niveau", RED_NIVEAUX_ALERTE],
    ["red_urgences", "voyant", RED_VOYANTS],
    ["red_creanciers", "categorie", RED_CATEGORIES_CREANCIER],
    ["red_negociation_evenements", "type", RED_TYPES_EVENEMENT_NEGOCIATION],
    ["red_actions", "volet", RED_VOLETS],
    ["red_actions", "domaine", RED_DOMAINES],
    ["red_actions", "statut", RED_STATUTS_ACTION],
    ["red_action_evenements", "type", RED_TYPES_EVENEMENT_ACTION],
    ["red_plan_versions", "statut", RED_STATUTS_VERSION_PLAN],
  ];
  for (const [table, colonne, liste] of cas) {
    it(`${table}.${colonne}`, async () => {
      expect(await valeursCheck(table, colonne)).toEqual(trie(liste));
    });
  }

  it("red_tresorerie_lignes : sens et catégories (union des listes d'encaissement et de décaissement)", async () => {
    const lues = await valeursCheck("red_tresorerie_lignes", "categorie");
    // Le CHECK qui relie le sens à la catégorie cite aussi les deux sens (WHEN 'encaissement' ... ELSE décaissement).
    expect(lues).toEqual(
      trie([RED_SENS_FLUX[0], ...RED_CATEGORIES_ENCAISSEMENT, ...RED_CATEGORIES_DECAISSEMENT]),
    );
  });

  it("les plafonds du paquet partagé sont ceux des déclencheurs (nombres posés en paramètre)", async () => {
    const r = await proprietaire((c) =>
      c.query(
        `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
         WHERE NOT tgisinternal AND tgname LIKE 'red\\_%\\_plafond'`,
      ),
    );
    const nombres = Object.fromEntries(
      (r.rows as { tgname: string; def: string }[]).map((x) => [
        x.tgname,
        Number(/red_controler_plafond\('[a-z_]+', '(\d+)'/.exec(x.def)?.[1]),
      ]),
    );
    // Actions : plafond dédié (300 non abandonnées, 1 000 au total), pas le déclencheur générique.
    const actions = (r.rows as { tgname: string; def: string }[]).find(
      (x) => x.tgname === "red_actions_plafond",
    );
    expect(actions?.def).toContain("red_controler_plafond_actions");
    expect(nombres).toMatchObject({
      red_correspondances_plafond: 100,
      red_urgences_plafond: 200,
      red_scores_plafond: 500,
      red_tresorerie_versions_plafond: 200,
      red_tresorerie_lignes_plafond: 600,
      red_tresorerie_realises_plafond: 1000,
      red_creanciers_plafond: 200,
      red_creances_plafond: 100,
      red_negociation_evenements_plafond: 300,
      red_echeances_plafond: 60,
      red_action_evenements_plafond: 200,
      red_plan_versions_plafond: 100,
    });
  });
});
