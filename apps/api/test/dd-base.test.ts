import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import {
  BASE_FIGEE_OK,
  colonnesVersion,
  inserer,
  json,
  peuplerDd,
  preparerDd,
  sql,
  TABLES_DD,
  type DonneesDd,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerAssertion, creerPreuve } from "./preuves-outils.js";

/*
 * Garanties de la base du service #2 « Due diligence » (migrations 0500 à 0508), éprouvées avec le
 * rôle applicatif réel et avec le propriétaire : ajout seul des vingt tables (MPZ21 même pour le
 * propriétaire), RLS et portail fermé, UN TEST SQL DIRECT PAR CODE (MPZ22 à MPZ32, MPR01, MPR04),
 * contraintes CHECK (matrice des colonnes par type, bornes, base figée bornée à 1 Mo).
 */

let ctx: Contexte;
let s: ScenarioDd;
let d: DonneesDd;
let A: string;
let B: string;
let E: string;
let associe: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD base");
  d = await peuplerDd(s);
  A = s.consultantEquipe.utilisateurId;
  B = s.consultant2.utilisateurId;
  E = s.expertMetier.utilisateurId;
  associe = s.a.associeId;
}, 240_000);
afterAll(() => ctx.fermer());

const refus = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

/* ----- fabriques de lignes neuves (chacune indépendante des autres tests) ----- */

const cab = () => s.a.cabinetId;

async function nouvelElement(
  type: string,
  extra: Record<string, unknown> = {},
  version: Record<string, unknown> = {},
  dossierId = d.dossierId,
  creePar = A,
) {
  const el = await inserer("dd_elements", {
    cabinet_id: cab(),
    dossier_id: dossierId,
    type,
    cree_par: creePar,
    ...extra,
  });
  await inserer("dd_element_versions", {
    cabinet_id: cab(),
    element_id: el.id,
    type,
    version: 1,
    auteur_id: creePar,
    ...colonnesVersion(type, version),
  });
  return el.id as string;
}

/** Hypothèse neuve (créée par `creePar`) avec une assertion de `auteurAssertion` liée « soutient ». */
async function hypotheseSourcee(creePar = B, auteurAssertion = s.consultantEquipe) {
  const h = await nouvelElement("hypothese", {}, {}, d.dossierId, creePar);
  const a = (await creerAssertion(auteurAssertion, s.missionId)).id as string;
  await inserer("dd_hypothese_liens", {
    cabinet_id: cab(),
    dossier_id: d.dossierId,
    hypothese_id: h,
    assertion_id: a,
    action: "lier",
    sens: "soutient",
    cree_par: A,
  });
  return { h, a };
}

function valeursVerdict(h: string, a: string | null, extra: Record<string, unknown> = {}) {
  return {
    cabinet_id: cab(),
    dossier_id: d.dossierId,
    hypothese_id: h,
    hypothese_version: 1,
    verdict: "confirmee",
    indication_moteur: "confirmee",
    motif: "Les sources soutiennent l'hypothèse.",
    assertions_citees: json(
      a === null
        ? []
        : [
            {
              assertion_id: a,
              version: 1,
              sens: "soutient",
              indice_num: 1,
              indice_den: 1,
              lecture: "solide",
            },
          ],
    ),
    proposee_par: A,
    ...extra,
  };
}

async function nouvelleNote(creePar = A, version: Record<string, unknown> = {}) {
  const n = await inserer("dd_notes", {
    cabinet_id: cab(),
    dossier_id: d.dossierId,
    titre: "Note de test",
    cree_par: creePar,
  });
  const v = await inserer("dd_note_versions", {
    cabinet_id: cab(),
    note_id: n.id,
    version: 1,
    etat: "soumise",
    recommandation: "reservee",
    synthese: "Synthèse.",
    base_figee: json(BASE_FIGEE_OK),
    soumise_le: new Date().toISOString(),
    cree_par: creePar,
    ...version,
  });
  return { noteId: n.id as string, versionId: v.id as string };
}

/** Prochain numéro de version d'une identité (pour les tests de contraintes de ligne). */
async function suivante(table: string, colonne: string, id: string): Promise<number> {
  const r = await sql(
    `SELECT coalesce(max(version), 0)::int + 1 AS n FROM ${table} WHERE ${colonne} = $1`,
    [id],
  );
  return r[0].n as number;
}

async function nouveauFiltrage(auteur = A) {
  return inserer("dd_filtrages", {
    cabinet_id: cab(),
    dossier_id: d.dossierId,
    liste_version_id: d.listeVersionId,
    declarations: json({ activites: [], secteur_codes: [], pays_codes: [] }),
    themes: json([]),
    resultat: json({ touches: [{ regle: "r1", criteres: ["mot_cle"], mots_trouves: ["casino"] }] }),
    auteur_id: auteur,
  });
}

describe("ajout seul (MPZ21)", () => {
  it("le jeu de données couvre les vingt tables", async () => {
    expect(TABLES_DD).toHaveLength(20);
    for (const t of TABLES_DD) {
      const r = await sql(`SELECT count(*)::int AS n FROM ${t} WHERE cabinet_id = $1`, [cab()]);
      expect(r[0].n, t).toBeGreaterThan(0);
    }
  });

  it("le rôle applicatif ne peut ni modifier ni supprimer une ligne d'aucune table", async () => {
    for (const t of TABLES_DD) {
      await expect(
        ctx.db.withTenant(cab(), (db) => db.query(`UPDATE ${t} SET cabinet_id = cabinet_id`)),
        `UPDATE ${t}`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        ctx.db.withTenant(cab(), (db) => db.query(`DELETE FROM ${t}`)),
        `DELETE ${t}`,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("même le propriétaire de la base est refusé par les déclencheurs (MPZ21)", async () => {
    for (const t of TABLES_DD) {
      await refus(sql(`UPDATE ${t} SET cabinet_id = cabinet_id`), "MPZ21");
      await refus(sql(`DELETE FROM ${t}`), "MPZ21");
    }
  });
});

describe("isolation entre cabinets et portail fermé", () => {
  it("un autre cabinet ne voit aucune ligne des vingt tables", async () => {
    for (const t of TABLES_DD) {
      const r = await ctx.db.withTenant(s.b.cabinetId, (db) => db.query(`SELECT 1 FROM ${t}`));
      expect(r.rows, t).toHaveLength(0);
      const propre = await ctx.db.withTenant(cab(), (db) => db.query(`SELECT 1 FROM ${t}`));
      expect(propre.rows.length, t).toBeGreaterThan(0);
    }
  });

  it("écrire dans le cabinet d'un autre est refusé par la RLS", async () => {
    await expect(
      ctx.db.withTenant(s.b.cabinetId, (db) =>
        db.query(`INSERT INTO dd_signaux (cabinet_id, code, cree_par) VALUES ($1, $2, $3)`, [
          cab(),
          "intrus",
          A,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("dans une transaction du portail, rien n'est visible ni insérable", async () => {
    for (const t of TABLES_DD) {
      const r = await ctx.db.withTenant(cab(), async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
        return db.query(`SELECT 1 FROM ${t}`);
      });
      expect(r.rows, t).toHaveLength(0);
    }
    await expect(
      ctx.db.withTenant(cab(), async (db) => {
        await db.query("SELECT set_config('app.portail_client_id', $1, true)", [s.a.clientId]);
        await db.query(`INSERT INTO dd_signaux (cabinet_id, code, cree_par) VALUES ($1, $2, $3)`, [
          cab(),
          "intrus",
          A,
        ]);
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("un compte du portail ne peut pas être désigné comme auteur", async () => {
    const [portail] = await sql(
      `INSERT INTO utilisateurs (cabinet_id, email, nom, roles, mot_de_passe_hash)
       VALUES ($1, $2, 'Client', ARRAY['client_dirigeant'], 'x') RETURNING id`,
      [cab(), `portail-${randomUUID()}@exemple.test`],
    );
    await expect(
      inserer("dd_notes", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        titre: "Note",
        cree_par: portail.id,
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
});

describe("MPZ22 : rattachement incohérent", () => {
  it("le dossier porte sur le client de sa mission", async () => {
    await refus(
      inserer("dd_dossiers", {
        cabinet_id: cab(),
        mission_id: s.missionId,
        client_id: s.autreClientId,
        cree_par: A,
      }),
      "MPZ22",
    );
  });

  it("l'assertion d'un point appartient à la mission du dossier", async () => {
    const autre = (await creerAssertion(s.a.chef, s.mission2Id)).id;
    await refus(
      inserer("dd_elements", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        type: "point_analyse",
        analyse: "swot",
        assertion_id: autre,
        cree_par: A,
      }),
      "MPZ22",
    );
  });

  it("une assertion ne sert qu'un élément (unicité)", async () => {
    await expect(
      inserer("dd_elements", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        type: "point_analyse",
        analyse: "swot",
        assertion_id: d.pointAssertionId,
        cree_par: A,
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("le parent est une hypothèse et la profondeur ne dépasse pas 4", async () => {
    await refus(
      inserer("dd_elements", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        type: "hypothese",
        parent_id: d.etapeId,
        cree_par: A,
      }),
      "MPZ22",
    );
    let parent = await nouvelElement("hypothese");
    for (let niveau = 2; niveau <= 4; niveau += 1) {
      parent = await nouvelElement("hypothese", { parent_id: parent });
    }
    await refus(
      inserer("dd_elements", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        type: "hypothese",
        parent_id: parent,
        cree_par: A,
      }),
      "MPZ22",
    );
  });

  it("catégorie, famille et étape d'une version d'élément", async () => {
    const el = await nouvelElement(
      "point_analyse",
      { analyse: "swot", assertion_id: (await creerAssertion(s.a.chef, s.missionId)).id },
      { categorie: "forces" },
    );
    await refus(
      inserer("dd_element_versions", {
        cabinet_id: cab(),
        element_id: el,
        type: "point_analyse",
        version: 2,
        auteur_id: A,
        motif: "Catégorie d'une autre analyse.",
        ...colonnesVersion("point_analyse", { categorie: "politique" }),
      }),
      "MPZ22",
    );
    const risque = await nouvelElement("risque", {
      assertion_id: (await creerAssertion(s.a.chef, s.missionId)).id,
    });
    await refus(
      inserer("dd_element_versions", {
        cabinet_id: cab(),
        element_id: risque,
        type: "risque",
        version: 2,
        auteur_id: A,
        motif: "Famille inconnue.",
        ...colonnesVersion("risque", { categorie: "inconnue" }),
      }),
      "MPZ22",
    );
    await refus(
      inserer("dd_element_versions", {
        cabinet_id: cab(),
        element_id: risque,
        type: "risque",
        version: 2,
        auteur_id: A,
        motif: "Étape qui n'en est pas une.",
        etape_id: d.hypotheseId,
        ...colonnesVersion("risque"),
      }),
      "MPZ22",
    );
  });

  it("le risque d'un constat est un risque du même dossier", async () => {
    await refus(
      inserer("dd_signal_constats", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        signal_id: d.signalId,
        signal_version: 1,
        etat: "a_verifier",
        risque_element_id: d.etapeId,
        cree_par: A,
      }),
      "MPZ22",
    );
  });

  it("un lien d'hypothèse : élément, assertion de la mission, délien d'un lien absent", async () => {
    const autre = (await creerAssertion(s.a.chef, s.mission2Id)).id;
    const neuve = (await creerAssertion(s.a.chef, s.missionId)).id;
    const base = { cabinet_id: cab(), dossier_id: d.dossierId, cree_par: A };
    await refus(
      inserer("dd_hypothese_liens", {
        ...base,
        hypothese_id: d.etapeId,
        assertion_id: neuve,
        action: "lier",
        sens: "soutient",
      }),
      "MPZ22",
    );
    await refus(
      inserer("dd_hypothese_liens", {
        ...base,
        hypothese_id: d.hypotheseId,
        assertion_id: autre,
        action: "lier",
        sens: "soutient",
      }),
      "MPZ22",
    );
    await refus(
      inserer("dd_hypothese_liens", {
        ...base,
        hypothese_id: d.hypotheseId,
        assertion_id: neuve,
        action: "delier",
      }),
      "MPZ22",
    );
  });

  it("un verdict porte sur la version courante d'une hypothèse non retirée", async () => {
    const { h, a } = await hypotheseSourcee();
    await refus(inserer("dd_verdicts", valeursVerdict(h, a, { hypothese_version: 7 })), "MPZ22");
    await refus(inserer("dd_verdicts", valeursVerdict(d.etapeId, a)), "MPZ22");
    await inserer("dd_element_versions", {
      cabinet_id: cab(),
      element_id: h,
      type: "hypothese",
      version: 2,
      auteur_id: B,
      motif: "Retrait de l'hypothèse.",
      retire: true,
      ...colonnesVersion("hypothese"),
    });
    await refus(inserer("dd_verdicts", valeursVerdict(h, a, { hypothese_version: 2 })), "MPZ22");
  });

  it("un ajustement vise une cible existante du type annoncé, dans le dossier", async () => {
    const base = {
      cabinet_id: cab(),
      dossier_id: d.dossierId,
      champ: "niveau",
      valeur_avant: "modere",
      valeur_apres: "eleve",
      motif: "Écart motivé par l'expert.",
      auteur_id: A,
    };
    await refus(
      inserer("dd_ajustements", { ...base, cible_type: "risque", cible_id: d.verdictId }),
      "MPZ22",
    );
    await refus(
      inserer("dd_ajustements", { ...base, cible_type: "verdict", cible_id: randomUUID() }),
      "MPZ22",
    );
    await inserer("dd_ajustements", { ...base, cible_type: "risque", cible_id: d.risqueId });
  });

  it("filtrage et listes d'exclusion : assertion d'un thème, structure des règles", async () => {
    const autre = (await creerAssertion(s.a.chef, s.mission2Id)).id;
    await refus(
      inserer("dd_filtrages", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        liste_version_id: d.listeVersionId,
        declarations: json({ activites: [], secteur_codes: [], pays_codes: [] }),
        themes: json([
          { code: "main_oeuvre", niveau: "eleve", justification: "x", assertion_id: autre },
        ]),
        resultat: json({ touches: [] }),
        auteur_id: A,
      }),
      "MPZ22",
    );
    const liste = (await sql("SELECT id FROM dd_exclusion_listes WHERE id = $1", [d.listeId]))[0]
      .id;
    const base = {
      cabinet_id: cab(),
      liste_id: liste,
      version: 2,
      motif: "Correction.",
      cree_par: E,
    };
    const regle = {
      code: "r2",
      libelle: "Tabac",
      mots_cles: ["tabac"],
      secteur_codes: [],
      pays_codes: [],
    };
    await refus(
      inserer("dd_exclusion_liste_versions", {
        ...base,
        regles: json([{ ...regle, mots_cles: [] }]),
      }),
      "MPZ22",
    );
    await refus(
      inserer("dd_exclusion_liste_versions", { ...base, regles: json([regle, regle]) }),
      "MPZ22",
    );
    await inserer("dd_exclusion_liste_versions", { ...base, regles: json([regle]) });
  });
});

describe("MPZ23 : versions sans trou", () => {
  it("six tables de versions refusent un numéro qui saute", async () => {
    await refus(
      inserer("dd_cadrage_versions", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        version: 3,
        titre: "Saut",
        secteur_code: "cacao",
        pays_code: "ci",
        type_operation: "entree_marche",
        devise: "XOF",
        motif: "Saut de version.",
        cree_par: A,
      }),
      "MPZ23",
    );
    await refus(
      inserer("dd_element_versions", {
        cabinet_id: cab(),
        element_id: d.etapeId,
        type: "etape_chaine",
        version: 3,
        auteur_id: A,
        motif: "Saut de version.",
        ...colonnesVersion("etape_chaine"),
      }),
      "MPZ23",
    );
    await refus(
      inserer("dd_signal_versions", {
        cabinet_id: cab(),
        signal_id: d.signalId,
        version: 4,
        libelle: "Saut",
        famille: "pays",
        gravite_indicative: "faible",
        motif: "Saut de version.",
        cree_par: E,
      }),
      "MPZ23",
    );
    await refus(
      inserer("dd_dimensionnement_versions", {
        cabinet_id: cab(),
        dimensionnement_id: d.dimId,
        version: 1,
        libelle: "Doublon de la version 1",
        parametres: json([
          { code: "x", source: { type: "avis_expert", motif: "Estimation de l'expert." } },
        ]),
        resultat: json({}),
        auteur_id: A,
      }),
      "MPZ23",
    );
    await refus(
      inserer("dd_exclusion_liste_versions", {
        cabinet_id: cab(),
        liste_id: d.listeId,
        version: 5,
        regles: json([
          { code: "r9", libelle: "x", mots_cles: ["x"], secteur_codes: [], pays_codes: [] },
        ]),
        motif: "Saut de version.",
        cree_par: E,
      }),
      "MPZ23",
    );
    await refus(
      inserer("dd_note_versions", {
        cabinet_id: cab(),
        note_id: d.noteId,
        version: 9,
        etat: "brouillon",
        recommandation: "reservee",
        synthese: "Saut.",
        motif: "Saut de version.",
        cree_par: A,
      }),
      "MPZ23",
    );
  });
});

describe("MPZ24 : « chaque verdict est sourcé »", () => {
  it("un verdict confirmé ou infirmé sans citation est refusé", async () => {
    const { h } = await hypotheseSourcee();
    await refus(inserer("dd_verdicts", valeursVerdict(h, null)), "MPZ24");
    await refus(
      inserer(
        "dd_verdicts",
        valeursVerdict(h, null, { verdict: "infirmee", indication_moteur: "infirmee" }),
      ),
      "MPZ24",
    );
  });

  it("une assertion non liée à l'hypothèse, ou liée dans l'autre sens, est refusée", async () => {
    const { h, a } = await hypotheseSourcee();
    const nonLiee = (await creerAssertion(s.consultantEquipe, s.missionId)).id;
    await refus(inserer("dd_verdicts", valeursVerdict(h, nonLiee)), "MPZ24");
    // Liée « soutient » mais citée « contredit » (verdict infirmé).
    await refus(
      inserer("dd_verdicts", {
        ...valeursVerdict(h, a, { verdict: "infirmee", indication_moteur: "infirmee" }),
        assertions_citees: json([
          {
            assertion_id: a,
            version: 1,
            sens: "contredit",
            indice_num: 1,
            indice_den: 1,
            lecture: "solide",
          },
        ]),
      }),
      "MPZ24",
    );
    // Verdict infirmé avec seulement un soutien cité.
    await refus(
      inserer(
        "dd_verdicts",
        valeursVerdict(h, a, { verdict: "infirmee", indication_moteur: "infirmee" }),
      ),
      "MPZ24",
    );
  });

  it("une assertion d'une autre mission ne se cite pas, un délien invalide la citation", async () => {
    const { h, a } = await hypotheseSourcee();
    const autre = (await creerAssertion(s.a.chef, s.mission2Id)).id;
    await refus(inserer("dd_verdicts", valeursVerdict(h, autre)), "MPZ24");
    await inserer("dd_hypothese_liens", {
      cabinet_id: cab(),
      dossier_id: d.dossierId,
      hypothese_id: h,
      assertion_id: a,
      action: "delier",
      cree_par: A,
    });
    await refus(inserer("dd_verdicts", valeursVerdict(h, a)), "MPZ24");
  });

  it("un verdict sourcé est enregistré (photographie jsonb)", async () => {
    const { h, a } = await hypotheseSourcee();
    const v = await inserer("dd_verdicts", valeursVerdict(h, a));
    expect(v.assertions_citees[0].assertion_id).toBe(a);
  });

  it("un verdict qui s'écarte de l'indication exige un motif d'au moins 20 caractères (CHECK)", async () => {
    const { h } = await hypotheseSourcee();
    await refus(
      inserer(
        "dd_verdicts",
        valeursVerdict(h, null, {
          verdict: "non_concluante",
          indication_moteur: "confirmee",
          motif: "Court.",
        }),
      ),
      "23514",
    );
  });
});

describe("MPZ32 : un seul verdict en attente par hypothèse", () => {
  it("un second verdict est refusé tant que le premier attend une décision", async () => {
    const { h } = await hypotheseSourcee();
    const non = valeursVerdict(h, null, {
      verdict: "non_concluante",
      indication_moteur: "non_concluante",
    });
    const premier = await inserer("dd_verdicts", non);
    await refus(inserer("dd_verdicts", non), "MPZ32");
    await inserer("dd_verdict_validations", {
      cabinet_id: cab(),
      verdict_id: premier.id,
      decision: "rejete",
      motif: "Sources insuffisantes.",
      valide_par: E,
    });
    await inserer("dd_verdicts", non);
  });
});

describe("MPZ25 : séparation des tâches, validation d'un verdict", () => {
  async function verdictEnAttente(
    creeHypothese = B,
    auteurAssertion = s.consultantEquipe,
    proposant = A,
  ) {
    const { h, a } = await hypotheseSourcee(creeHypothese, auteurAssertion);
    const v = await inserer("dd_verdicts", valeursVerdict(h, a, { proposee_par: proposant }));
    return { h, a, verdictId: v.id as string };
  }
  const valider = (verdictId: string, par: string) =>
    inserer("dd_verdict_validations", {
      cabinet_id: cab(),
      verdict_id: verdictId,
      decision: "valide",
      valide_par: par,
    });

  it("le proposant, le créateur de l'hypothèse et l'auteur d'une assertion citée sont refusés", async () => {
    const proposant = await verdictEnAttente(B, s.consultantEquipe, A);
    await refus(valider(proposant.verdictId, A), "MPZ25");
    const auteurHypothese = await verdictEnAttente(B, s.consultantEquipe, A);
    await refus(valider(auteurHypothese.verdictId, B), "MPZ25");
    // Auteur de l'assertion citée : le chef (ni proposant ni auteur de l'hypothèse).
    const auteurAssertion = await verdictEnAttente(B, s.a.chef, A);
    await refus(valider(auteurAssertion.verdictId, s.a.chef.utilisateurId), "MPZ25");
  });

  it("un tiers (expert métier) valide ; un associé est dispensé", async () => {
    const tiers = await verdictEnAttente();
    await valider(tiers.verdictId, E);
    const propre = await verdictEnAttente(B, s.consultantEquipe, associe);
    const v = await valider(propre.verdictId, associe);
    expect(v.decision).toBe("valide");
  });

  it("une décision de rejet suit la même règle", async () => {
    const x = await verdictEnAttente();
    await refus(
      inserer("dd_verdict_validations", {
        cabinet_id: cab(),
        verdict_id: x.verdictId,
        decision: "rejete",
        motif: "Je rejette mon propre verdict.",
        valide_par: A,
      }),
      "MPZ25",
    );
    await refus(
      inserer("dd_verdict_validations", {
        cabinet_id: cab(),
        verdict_id: x.verdictId,
        decision: "rejete",
        valide_par: E,
      }),
      "23514",
    );
  });

  it("un verdict ne se décide qu'une fois (unicité)", async () => {
    const x = await verdictEnAttente();
    await valider(x.verdictId, E);
    await expect(valider(x.verdictId, s.a.chef.utilisateurId)).rejects.toMatchObject({
      code: "23505",
    });
  });
});

describe("MPZ27 : validation d'une version périmée", () => {
  it("l'hypothèse a changé depuis la proposition du verdict", async () => {
    const { h, a } = await hypotheseSourcee();
    const v = await inserer("dd_verdicts", valeursVerdict(h, a));
    await inserer("dd_element_versions", {
      cabinet_id: cab(),
      element_id: h,
      type: "hypothese",
      version: 2,
      auteur_id: B,
      motif: "Reformulation.",
      ...colonnesVersion("hypothese", { libelle: "Hypothèse reformulée" }),
    });
    await refus(
      inserer("dd_verdict_validations", {
        cabinet_id: cab(),
        verdict_id: v.id,
        decision: "valide",
        valide_par: associe,
      }),
      "MPZ27",
    );
  });

  it("seule la dernière version soumise d'une note se valide", async () => {
    const { noteId, versionId } = await nouvelleNote();
    const recente = await inserer("dd_note_versions", {
      cabinet_id: cab(),
      note_id: noteId,
      version: 2,
      etat: "soumise",
      recommandation: "reservee",
      synthese: "Seconde soumission.",
      base_figee: json(BASE_FIGEE_OK),
      soumise_le: new Date().toISOString(),
      motif: "Nouvelle soumission.",
      cree_par: A,
    });
    const brouillon = await inserer("dd_note_versions", {
      cabinet_id: cab(),
      note_id: noteId,
      version: 3,
      etat: "brouillon",
      recommandation: "reservee",
      synthese: "Brouillon suivant.",
      motif: "Brouillon.",
      cree_par: A,
    });
    const v = (id: string) => ({
      cabinet_id: cab(),
      note_version_id: id,
      decision: "valide",
      valide_par: E,
    });
    await refus(inserer("dd_note_validations", v(versionId)), "MPZ27");
    await refus(inserer("dd_note_validations", v(brouillon.id)), "MPZ27");
    await inserer("dd_note_validations", v(recente.id));
  });
});

describe("MPZ26 : séparation des tâches, validation d'une note", () => {
  const valider = (versionId: string, par: string) =>
    inserer("dd_note_validations", {
      cabinet_id: cab(),
      note_version_id: versionId,
      decision: "valide",
      valide_par: par,
    });

  it("le créateur de la note et l'auteur d'une version (brouillon compris) sont refusés", async () => {
    const x = await nouvelleNote(A);
    await refus(valider(x.versionId, A), "MPZ26");
    const y = await nouvelleNote(A);
    // Une version précédente d'un autre auteur : B soumet après un brouillon de A.
    await inserer("dd_note_versions", {
      cabinet_id: cab(),
      note_id: y.noteId,
      version: 2,
      etat: "soumise",
      recommandation: "reservee",
      synthese: "Soumise par B.",
      base_figee: json(BASE_FIGEE_OK),
      soumise_le: new Date().toISOString(),
      motif: "Soumission.",
      cree_par: B,
    });
    const derniere = (
      await sql("SELECT id FROM dd_note_versions WHERE note_id = $1 AND version = 2", [y.noteId])
    )[0].id;
    await refus(valider(derniere, B), "MPZ26");
    await refus(valider(derniere, A), "MPZ26");
  });

  it("un tiers valide ; un associé est dispensé", async () => {
    const x = await nouvelleNote(A);
    expect((await valider(x.versionId, E)).decision).toBe("valide");
    const y = await nouvelleNote(associe);
    expect((await valider(y.versionId, associe)).decision).toBe("valide");
  });

  it("un rejet exige un motif (CHECK)", async () => {
    const x = await nouvelleNote(A);
    await refus(
      inserer("dd_note_validations", {
        cabinet_id: cab(),
        note_version_id: x.versionId,
        decision: "rejete",
        valide_par: E,
      }),
      "23514",
    );
  });
});

describe("MPZ28 : séparation des tâches, décision sur une exclusion", () => {
  const decider = (filtrageId: string, par: string, regle = "r1") =>
    inserer("dd_filtrage_decisions", {
      cabinet_id: cab(),
      filtrage_id: filtrageId,
      regle_code: regle,
      decision: "confirmee",
      motif: "Exclusion confirmée par le décideur.",
      decideur_id: par,
    });

  it("l'auteur du filtrage ne décide pas ; un tiers décide", async () => {
    const f = await nouveauFiltrage(A);
    await refus(decider(f.id, A), "MPZ28");
    expect((await decider(f.id, E)).decision).toBe("confirmee");
  });

  it("un associé est dispensé", async () => {
    const f = await nouveauFiltrage(associe);
    expect((await decider(f.id, associe)).decision).toBe("confirmee");
  });

  it("une règle absente des règles touchées est refusée (indice regle_inconnue)", async () => {
    const f = await nouveauFiltrage(A);
    await expect(decider(f.id, E, "zzz")).rejects.toMatchObject({
      code: "MPZ28",
      hint: "regle_inconnue",
    });
  });
});

describe("MPZ29 : version soumise cohérente", () => {
  const soumise = (version: Record<string, unknown>) =>
    nouvelleNote(A, version).then((x) => x.versionId);

  it("base absente, bloquants non vides, exclusions non levées, conditions absentes", async () => {
    await refus(soumise({ base_figee: null, soumise_le: null }), "MPZ29");
    await refus(
      soumise({ base_figee: json({ ...BASE_FIGEE_OK, bloquants: ["SANS_HYPOTHESE"] }) }),
      "MPZ29",
    );
    await refus(
      soumise({
        recommandation: "favorable",
        base_figee: json({ ...BASE_FIGEE_OK, exclusions_bloquantes: 2 }),
      }),
      "MPZ29",
    );
    await refus(soumise({ recommandation: "favorable_sous_conditions", conditions: [] }), "MPZ29");
    await refus(soumise({ base_figee: json({ version_base: 1, bloquants: [] }) }), "MPZ29");
  });

  it("une recommandation défavorable admet des exclusions ; sous conditions avec une condition", async () => {
    await soumise({
      recommandation: "defavorable",
      base_figee: json({ ...BASE_FIGEE_OK, exclusions_bloquantes: 2 }),
    });
    await soumise({
      recommandation: "favorable_sous_conditions",
      conditions: ["Obtenir la licence."],
    });
  });

  it("un brouillon ne porte pas de base (CHECK) et la base est bornée à 1 Mo", async () => {
    await refus(soumise({ etat: "brouillon" }), "23514");
    await expect(
      soumise({
        base_figee: json({ ...BASE_FIGEE_OK, remplissage: "a".repeat(1_000_100) }),
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "dd_note_versions_base_taille_check" });
  });
});

describe("MPZ30 : action du plan des 100 jours", () => {
  async function action() {
    return nouvelElement("action_100j", {}, { responsable_id: A });
  }
  const version = (id: string, extra: Record<string, unknown>) =>
    inserer("dd_element_versions", {
      cabinet_id: cab(),
      element_id: id,
      type: "action_100j",
      version: 2,
      auteur_id: A,
      motif: "Rattachement.",
      ...colonnesVersion("action_100j"),
      ...extra,
    });

  it("responsable hors équipe, initiative ou KPI d'un autre client, élément qui n'est pas une initiative", async () => {
    await refus(
      version(await action(), { responsable_id: s.consultantHors.utilisateurId }),
      "MPZ30",
    );
    await refus(version(await action(), { plan_element_id: s.initiativeAutreClient }), "MPZ30");
    await refus(version(await action(), { plan_element_id: s.axeMemeClient }), "MPZ30");
    await refus(version(await action(), { kpi_id: s.kpiAutreClient }), "MPZ30");
  });

  it("responsable de l'équipe, initiative et KPI du même client acceptés", async () => {
    const v = await version(await action(), {
      responsable_id: B,
      plan_element_id: s.initiativeMemeClient,
      kpi_id: s.kpiMemeClient,
    });
    expect(v.plan_element_id).toBe(s.initiativeMemeClient);
  });
});

describe("MPZ31 : paramètre de dimensionnement sans source valide", () => {
  const version = (parametres: unknown[], numero = 2) =>
    inserer("dd_dimensionnement_versions", {
      cabinet_id: cab(),
      dimensionnement_id: d.dimId,
      version: numero,
      libelle: "Nouvelle version",
      parametres: json(parametres),
      resultat: json({}),
      motif: "Correction des sources.",
      auteur_id: A,
    });
  const param = (source: unknown) => ({
    code: "clients_cibles",
    unite: "nombre",
    bas: 1,
    base: 2,
    haut: 3,
    source,
  });

  it("preuve d'une autre mission, avis sans motif, source absente ou inconnue", async () => {
    const autre = (await creerPreuve(s.a.chef, s.mission2Id)).id;
    await refus(version([param({ type: "preuve", preuve_id: autre })]), "MPZ31");
    await refus(version([param({ type: "preuve", preuve_id: randomUUID() })]), "MPZ31");
    await refus(version([param({ type: "avis_expert", motif: "court" })]), "MPZ31");
    await refus(version([param({ type: "avis_expert" })]), "MPZ31");
    await refus(version([param(null)]), "MPZ31");
    await refus(version([{ code: "x", unite: "nombre", bas: 1, base: 2, haut: 3 }]), "MPZ31");
    await refus(version([param({ type: "autre" })]), "MPZ31");
  });

  it("preuve de la mission et avis d'expert motivé acceptés", async () => {
    const ok = await version([
      param({ type: "preuve", preuve_id: d.preuveId }),
      param({ type: "avis_expert", motif: "Estimation argumentée de l'expert." }),
    ]);
    expect(ok.version).toBe(2);
  });
});

describe("contraintes CHECK", () => {
  const cadrage = (extra: Record<string, unknown>, dossier = d.dossierId, version = 2) => ({
    cabinet_id: cab(),
    dossier_id: dossier,
    version,
    titre: "Cadrage",
    secteur_code: "cacao",
    pays_code: "ci",
    type_operation: "entree_marche",
    devise: "XOF",
    motif: "Correction.",
    cree_par: A,
    ...extra,
  });

  it("cadrage : motif dès la version 2, acquisition avec cible, devise, date et codes bornés", async () => {
    await refus(inserer("dd_cadrage_versions", cadrage({ motif: null })), "23514");
    await refus(
      inserer("dd_cadrage_versions", cadrage({ type_operation: "acquisition" })),
      "23514",
    );
    await refus(inserer("dd_cadrage_versions", cadrage({ devise: "GBP" })), "23514");
    await refus(inserer("dd_cadrage_versions", cadrage({ date_operation: "1999-01-01" })), "23514");
    await refus(
      inserer("dd_cadrage_versions", cadrage({ secteur_code: "Secteur Inconnu" })),
      "23514",
    );
    await inserer(
      "dd_cadrage_versions",
      cadrage({ type_operation: "acquisition", cible_nom: "Cible SA" }),
    );
  });

  it("matrice des colonnes par type d'élément", async () => {
    const mauvais: [string, Record<string, unknown>][] = [
      ["point_analyse", { part_cout_bp: 1000 }],
      ["point_analyse", { jour_debut: 1, jour_fin: 2, statut_action: "a_faire" }],
      ["etape_chaine", { ordre: null }],
      ["etape_chaine", { niveau: "eleve" }],
      ["risque", { niveau: null }],
      ["risque", { ordre: 1 }],
      ["hypothese", { niveau: "faible" }],
      ["hypothese", { etape_id: d.etapeId }],
      ["action_100j", { jour_debut: 20, jour_fin: 10 }],
      ["action_100j", { statut_action: null }],
      ["action_100j", { critere: "interdit" }],
    ];
    for (const [type, extra] of mauvais) {
      const assertion = ["point_analyse", "risque"].includes(type)
        ? {
            assertion_id: (await creerAssertion(s.a.chef, s.missionId)).id,
            ...(type === "point_analyse" ? { analyse: "pestel" } : {}),
          }
        : {};
      const el = await inserer("dd_elements", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        type,
        cree_par: A,
        ...assertion,
      });
      await refus(
        inserer("dd_element_versions", {
          cabinet_id: cab(),
          element_id: el.id,
          type,
          version: 1,
          auteur_id: A,
          ...colonnesVersion(type),
          ...extra,
        }),
        "23514",
      );
    }
  });

  it("identité d'élément : analyse seulement pour un point, assertion pour point et risque, parent d'hypothèse", async () => {
    const a = (await creerAssertion(s.a.chef, s.missionId)).id;
    const base = { cabinet_id: cab(), dossier_id: d.dossierId, cree_par: A };
    await refus(
      inserer("dd_elements", { ...base, type: "point_analyse", assertion_id: a }),
      "23514",
    );
    await refus(
      inserer("dd_elements", { ...base, type: "etape_chaine", analyse: "swot" }),
      "23514",
    );
    await refus(inserer("dd_elements", { ...base, type: "risque" }), "23514");
    await refus(
      inserer("dd_elements", { ...base, type: "etape_chaine", parent_id: d.hypotheseId }),
      "23514",
    );
  });

  it("bornes des parts, des jours, de la version et des acteurs", async () => {
    const el = await nouvelElement("etape_chaine");
    const v = (extra: Record<string, unknown>) =>
      inserer("dd_element_versions", {
        cabinet_id: cab(),
        element_id: el,
        type: "etape_chaine",
        version: 2,
        auteur_id: A,
        motif: "Correction.",
        ...colonnesVersion("etape_chaine"),
        ...extra,
      });
    await refus(v({ part_cout_bp: 10_001 }), "23514");
    await refus(v({ part_marge_bp: -1 }), "23514");
    await refus(v({ ordre: 201 }), "23514");
    await refus(v({ acteurs: Array.from({ length: 13 }, (_, i) => `acteur ${i}`) }), "23514");
    await refus(v({ motif: null }), "23514");
    await v({ acteurs: ["Producteurs", "Exportateurs"] });
  });

  it("signal, dimensionnement, liste, filtrage : énumérations et formes jsonb", async () => {
    await refus(
      inserer("dd_signaux", { cabinet_id: cab(), code: "Code Invalide", cree_par: E }),
      "23514",
    );
    await refus(
      inserer("dd_signal_versions", {
        cabinet_id: cab(),
        signal_id: d.signalId,
        version: await suivante("dd_signal_versions", "signal_id", d.signalId),
        libelle: "x",
        famille: "inconnue",
        gravite_indicative: "faible",
        motif: "Correction.",
        cree_par: E,
      }),
      "23514",
    );
    await refus(
      inserer("dd_dimensionnement_versions", {
        cabinet_id: cab(),
        dimensionnement_id: d.dimId,
        version: await suivante("dd_dimensionnement_versions", "dimensionnement_id", d.dimId),
        libelle: "x",
        parametres: json({ pas: "un tableau" }),
        resultat: json({}),
        motif: "Correction.",
        auteur_id: A,
      }),
      "23514",
    );
    await refus(
      inserer("dd_exclusion_liste_versions", {
        cabinet_id: cab(),
        liste_id: d.listeId,
        version: await suivante("dd_exclusion_liste_versions", "liste_id", d.listeId),
        regles: json([]),
        motif: "Correction.",
        cree_par: E,
      }),
      "23514",
    );
    await refus(
      inserer("dd_filtrages", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        liste_version_id: d.listeVersionId,
        declarations: json({}),
        themes: json(Array.from({ length: 9 }, () => ({}))),
        resultat: json({}),
        auteur_id: A,
      }),
      "23514",
    );
    await refus(
      inserer("dd_ajustements", {
        cabinet_id: cab(),
        dossier_id: d.dossierId,
        cible_type: "risque",
        cible_id: d.risqueId,
        champ: "niveau",
        valeur_avant: "a",
        valeur_apres: "b",
        motif: "Court",
        auteur_id: A,
      }),
      "23514",
    );
  });

  it("note : conditions bornées (20 éléments de 300 caractères)", async () => {
    await refus(
      nouvelleNote(A, { conditions: Array.from({ length: 21 }, (_, i) => `Condition ${i}`) }),
      "23514",
    );
    await refus(nouvelleNote(A, { conditions: ["x".repeat(301)] }), "23514");
  });
});

describe("MPR01 et MPR04 : rapport de la note au comité (0508)", () => {
  async function fichier(): Promise<string> {
    const r = await sql(
      `INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
       VALUES ($1, $2, 'note.pdf', 'application/pdf', 100, $3, $4) RETURNING id`,
      [cab(), randomUUID().replaceAll("-", ""), "a".repeat(64), A],
    );
    return r[0].id;
  }
  async function rapport(
    noteId: string,
    version: number,
    extra: Record<string, unknown> = {},
    mission = s.missionId,
  ) {
    return inserer("rapports_mission", {
      cabinet_id: cab(),
      mission_id: mission,
      fichier_id: await fichier(),
      modele: "note_comite",
      format: "pdf",
      statut: "valide",
      niveau: "dd",
      genere_par: A,
      dd_note_id: noteId,
      version_source: version,
      variante: "executive",
      ...extra,
    });
  }

  it("seule une version validée de la note se rend en rapport (MPR04)", async () => {
    await refus(rapport(d.noteId, 1), "MPR04");
    // Version soumise mais non validée.
    const x = await nouvelleNote(A);
    await refus(rapport(x.noteId, 1), "MPR04");
    // Version rejetée.
    const y = await nouvelleNote(A);
    await inserer("dd_note_validations", {
      cabinet_id: cab(),
      note_version_id: y.versionId,
      decision: "rejete",
      motif: "Recommandation à revoir.",
      valide_par: E,
    });
    await refus(rapport(y.noteId, 1), "MPR04");
    const ok = await rapport(d.noteId, 2, { variante: "detaillee" });
    expect(ok.variante).toBe("detaillee");
  });

  it("la note appartient à la mission du rapport (MPR01)", async () => {
    await refus(rapport(d.noteId, 2, {}, s.mission2Id), "MPR01");
  });

  it("les contraintes de source : variante, niveau et colonnes de chaque modèle", async () => {
    await refus(rapport(d.noteId, 2, { variante: null }), "23514");
    await refus(rapport(d.noteId, 2, { variante: "complete" }), "23514");
    await refus(rapport(d.noteId, 2, { niveau: "plan" }), "23514");
    // Un état d'avancement ne porte ni note ni variante.
    await refus(
      rapport(d.noteId, 2, { modele: "etat_avancement", niveau: "base", version_source: null }),
      "23514",
    );
    const ordinaire = await inserer("rapports_mission", {
      cabinet_id: cab(),
      mission_id: s.missionId,
      fichier_id: await fichier(),
      modele: "etat_avancement",
      format: "pdf",
      statut: "valide",
      niveau: "base",
      genere_par: A,
    });
    expect(ordinaire.dd_note_id).toBeNull();
  });
});

describe("fonctions du lot", () => {
  it("aucune fonction SECURITY DEFINER dans le lot", async () => {
    const r = await sql(
      `SELECT proname FROM pg_proc WHERE prosecdef AND (proname LIKE 'dd\\_%' OR proname LIKE '%\\_dd' OR proname LIKE '%\\_dd\\_%')`,
    );
    expect(r).toEqual([]);
  });

  it("est_associe_dd distingue un associé actif", async () => {
    const r = await sql("SELECT est_associe_dd($1) AS oui, est_associe_dd($2) AS non", [
      associe,
      A,
    ]);
    expect(r[0]).toEqual({ oui: true, non: false });
  });

  it("dd_categorie_valide reflète le vocabulaire fermé", async () => {
    const r = await sql(
      `SELECT dd_categorie_valide('pestel', 'juridique') AS a, dd_categorie_valide('pestel', 'forces') AS b,
              dd_categorie_valide('swot', 'menaces') AS c, dd_categorie_valide('inconnue', 'x') AS dd,
              dd_categorie_valide('operationnelle', 'goulots') AS e,
              dd_categorie_valide('cinq_forces', 'substituts') AS f`,
    );
    expect(r[0]).toEqual({ a: true, b: false, c: true, dd: false, e: true, f: true });
  });
});
