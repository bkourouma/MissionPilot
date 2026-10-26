import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyserMissions, chargerMissions } from "../src/finance/donnees.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { attendre, preparerFacturation, type CabinetFacturation } from "./facturation-outils.js";
import { acteur, factureDatee, feuilleValidee } from "./finance-outils.js";
import { creerMission } from "./missions-outils.js";

/*
 * Coûts internes d'une autre devise que la mission (limite « M2 ») : les coûts journaliers
 * des collaborateurs sont en FCFA (XOF : senior 90 000, manager 150 000) ; une mission en
 * euros, en dollars ou en XAF les ramène dans sa devise au taux figé à sa signature (moteur
 * `convertirVersDevise`), au lieu de les écarter (« coûts internes 0 », marge 100 %).
 *
 * Mission EUR en régie signée le 2026-09-01 (1 EUR = 655,957 FCFA), tâche « Diagnostic »
 * budgétée senior 10 j + manager 5 j, taux de vente 300 € et 450 € :
 *   honoraires budget = 10 × 30 000 + 5 × 45 000 c   = 525 000 c (5 250,00 €)
 *   coût journalier   = 90 000 / 655,957 = 137,2041… € → 13 720 c ;
 *                       150 000 / 655,957 = 228,6735… € → 22 867 c
 *   coûts budget      = 10 × 13 720 + 5 × 22 867     = 251 535 c → marge 273 465 c (0,5209)
 * Temps validés : senior 4 j, manager 2 j (septembre) :
 *   coûts réalisés    = (4 × 90 000 + 2 × 150 000) FCFA = 660 000 FCFA, convertis UNE fois :
 *                       660 000 / 655,957 = 1 006,1635… € → 100 616 c
 *   valeur produite   = 4 × 30 000 + 2 × 45 000      = 210 000 c
 * Facture émise le 2026-09-30 : 150 000 c HT → marge réalisée 150 000 − 100 616 = 49 384 c.
 */

let ctx: Contexte;
let c: CabinetFacturation;
let missionEur: string;
const TAUX_VENTE_EUR = { associe: 90_000, manager: 45_000, senior: 30_000, junior: 15_000 };

async function missionDevise(
  devise: "EUR" | "USD" | "XAF",
  intitule: string,
): Promise<{ id: string; tache: string }> {
  const m = await creerMission(c, {
    type_mission_id: null,
    mode_facturation: "regie",
    devise,
    intitule,
    date_debut: "2026-09-07",
    date_fin: "2026-11-27",
  });
  const phase = await c.chef.post(`/api/missions/${m.id}/phases`, { libelle: "Diagnostic" });
  attendre(201, phase, "phase");
  const tache = await c.chef.post(`/api/missions/${m.id}/taches`, {
    parent_id: phase.json().id,
    libelle: "Diagnostic",
    duree_jours_ouvres: 60,
  });
  attendre(201, tache, "tâche");
  attendre(
    200,
    await c.chef.put(`/api/missions/${m.id}/taches/${tache.json().id}/budget`, {
      lignes: [
        { grade_id: c.grades.senior, jours: 10 },
        { grade_id: c.grades.manager, jours: 5 },
      ],
    }),
    "budget",
  );
  return { id: m.id, tache: tache.json().id };
}

const syntheseInitiale = async (missionId: string) =>
  (await c.associe.get(`/api/missions/${missionId}/budget`)).json().versions[0].synthese;

beforeAll(async () => {
  ctx = await demarrer();
  c = await preparerFacturation(ctx, "Cabinet Devises Coûts");
  const S = c.collaborateurs.senior as string;
  const M = c.collaborateurs.manager as string;
  await proprietaire((cl) =>
    cl.query("UPDATE collaborateurs SET cree_le = '2026-01-01' WHERE cabinet_id = $1", [
      c.cabinetId,
    ]),
  );
  const m = await missionDevise("EUR", "Diagnostic en euros");
  missionEur = m.id;
  attendre(
    200,
    await c.directeur.post(`/api/missions/${m.id}/signer`, {
      date_signature: "2026-09-01",
      taux_vente: TAUX_VENTE_EUR,
    }),
    "signature",
  );
  await proprietaire((cl) =>
    cl.query(
      `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, jours_alloues,
         date_debut, date_fin)
       VALUES ($1, $2, $3, $4, 10, '2026-09-07', '2026-09-18'),
              ($1, $2, $3, $5, 5, '2026-09-07', '2026-09-11')`,
      [c.cabinetId, m.id, m.tache, S, M],
    ),
  );
  for (const [collaborateurId, dates] of [
    [S, ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]],
    [M, ["2026-09-07", "2026-09-08"]],
  ] as const) {
    await feuilleValidee({
      cabinetId: c.cabinetId,
      collaborateurId,
      semaine: "2026-09-07",
      importePar: c.associeId,
      lignes: dates.map((date) => ({ date, missionId: m.id, tacheId: m.tache, jours: 1 })),
    });
  }
  await factureDatee(ctx, c, m.id, 150_000, "2026-09-30");
});
afterAll(() => ctx.fermer());

describe("coûts FCFA d'une mission en euros (taux figé à la signature)", () => {
  it("budget initial : coûts internes convertis au taux figé, marge réaliste", async () => {
    expect(await syntheseInitiale(missionEur)).toEqual({
      devise: "EUR",
      jours_vendus: 15,
      honoraires: 525_000,
      debours_refacturables: 0,
      debours_non_refacturables: 0,
      couts_internes: 251_535,
      sous_traitance: 0,
      marge: 273_465,
      taux_marge: 0.5209,
      jours_production: 15,
    });
    const lignes = (await c.associe.get(`/api/missions/${missionEur}/budget`)).json().versions[0]
      .lignes as { cle: string; prix_journalier: number }[];
    const prix = Object.fromEntries(lignes.map((l) => [l.cle, l.prix_journalier]));
    expect(prix["cout_interne:grade:senior"]).toBe(13_720);
    expect(prix["cout_interne:grade:manager"]).toBe(22_867);
  });

  it("FIN-02 : le directeur ne voit ni coûts ni marge du budget en euros", async () => {
    const vue = (await c.directeur.get(`/api/missions/${missionEur}/budget`)).json().versions[0];
    expect(vue.synthese).not.toHaveProperty("couts_internes");
    expect(vue.synthese).not.toHaveProperty("marge");
  });

  it("révision depuis le découpage : même conversion au taux déjà figé sur la mission", async () => {
    const r = await c.associe.post(`/api/missions/${missionEur}/budget/revisions`, {
      motif: "Recalcul depuis le découpage",
      depuis_decoupage: true,
    });
    attendre(201, r, "révision");
    const versions = (await c.associe.get(`/api/missions/${missionEur}/budget`)).json().versions;
    const revision = versions.find((v: { id: string }) => v.id === r.json().id);
    expect(revision.synthese).toMatchObject({ couts_internes: 251_535, marge: 273_465 });
  });

  it("analyse (bilan, rentabilité, indicateurs) : coûts réalisés valorisés puis convertis une fois", async () => {
    const auth = acteur(c.cabinetId, c.associeId, "associe");
    const analyse = await ctx.db.withTenant(c.cabinetId, async (db) => {
      const missions = await chargerMissions(db, auth, [missionEur]);
      const [a] = await analyserMissions(db, missions, null, null);
      // Sans taux figé (donnée incomplète) : coûts écartés et signalés, jamais additionnés tels quels.
      const [sansTaux] = await analyserMissions(
        db,
        missions.map((m) => ({ ...m, taux_change: null })),
        null,
        null,
      );
      return { a, sansTaux };
    });
    expect(analyse.a).toMatchObject({
      jours_valides: 6,
      jours_sans_cout: 0,
      valeur_produite: { valeur: 210_000, devise: "EUR" },
      honoraires_factures: { valeur: 150_000, devise: "EUR" },
      couts_internes: { valeur: 100_616, devise: "EUR" },
      sous_traitance: { valeur: 0, devise: "EUR" },
    });
    expect(analyse.sansTaux).toMatchObject({
      jours_sans_cout: 6,
      couts_internes: { valeur: 0, devise: "EUR" },
    });
  });

  it("rentabilité du cabinet (FCFA) : coûts internes non nuls, marge ni 100 % ni négative", async () => {
    const r = await c.gestionnaire.get(
      "/api/finance/rentabilite?du=2026-09-01&au=2026-12-31&niveau=mission",
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().devise).toBe("XOF");
    const ligne = r.json().elements.find((e: { cle: string }) => e.cle === missionEur);
    // 150 000 c × 6,55957 = 983 935,5 → 983 936 FCFA ; 100 616 c → 659 998 FCFA.
    expect(ligne).toMatchObject({
      honoraires: 983_936,
      couts_internes: 659_998,
      marge: 323_938,
      taux_marge: 0.3292,
    });
    expect(r.json().missions_exclues).toEqual([]);
  });

  it("indicateurs (niveau mission) : marge sur coûts convertis", async () => {
    const r = await c.gestionnaire.get(
      "/api/indicateurs/cabinet?du=2026-09-07&au=2026-10-04&niveau=mission",
    );
    expect(r.statusCode).toBe(200);
    const ligne = r
      .json()
      .elements.find((e: { mission_id: string }) => e.mission_id === missionEur);
    expect(ligne.marge).toMatchObject({ couts_internes: 659_998, marge: 323_938 });
  });
});

describe("coûts FCFA d'une mission en dollars ou en XAF", () => {
  it("USD : taux flottant saisi à la signature (1 USD = 600 FCFA)", async () => {
    const m = await missionDevise("USD", "Diagnostic en dollars");
    attendre(
      200,
      await c.associe.post(`/api/missions/${m.id}/signer`, {
        date_signature: "2026-09-01",
        taux_change: 600,
        taux_vente: { associe: 100_000, manager: 50_000, senior: 35_000, junior: 20_000 },
      }),
      "signature USD",
    );
    // 90 000 / 600 = 150 $ ; 150 000 / 600 = 250 $ → 10 × 15 000 + 5 × 25 000 = 275 000 c.
    expect(await syntheseInitiale(m.id)).toMatchObject({
      devise: "USD",
      honoraires: 600_000,
      couts_internes: 275_000,
      marge: 325_000,
    });
  });

  it("XAF : parité fixe 1 pour 1 avec le XOF, coûts repris sans conversion", async () => {
    const m = await missionDevise("XAF", "Diagnostic en XAF");
    attendre(
      200,
      await c.directeur.post(`/api/missions/${m.id}/signer`, {
        date_signature: "2026-09-01",
        taux_vente: { associe: 500_000, manager: 300_000, senior: 200_000, junior: 100_000 },
      }),
      "signature XAF",
    );
    expect(await syntheseInitiale(m.id)).toMatchObject({
      devise: "XAF",
      honoraires: 3_500_000,
      couts_internes: 1_650_000,
      marge: 1_850_000,
    });
  });
});
