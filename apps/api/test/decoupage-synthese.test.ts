import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { sansDonneeFinanciere } from "./planification-outils.js";
import {
  attendre,
  consultantAffecte,
  lignesSemaine,
  missionTemps,
  saisirEtSoumettre,
  type MissionTemps,
} from "./temps-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let m: MissionTemps;

const SEMAINE = "2026-11-02";

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Synthèse A");
  m = await missionTemps(a, {
    "Avec temps": { senior: 8 },
    "Sans temps": { senior: 4 },
    "Reste nul": { senior: 4 },
  });
  const senior = await consultantAffecte(a, m, { "Avec temps": 8, "Reste nul": 4 });
  const feuille = await saisirEtSoumettre(
    senior,
    SEMAINE,
    lignesSemaine(SEMAINE, [
      { tache_id: m.taches["Avec temps"] as string, jours: 3 },
      { tache_id: m.taches["Reste nul"] as string, jours: 2 },
    ]),
  );
  attendre(200, await a.chef.post(`/api/feuilles-temps/${feuille}/valider`, {}), "validation");
  attendre(
    201,
    await senior.post(`/api/missions/${m.id}/reste-a-faire`, {
      semaine: SEMAINE,
      lignes: [{ tache_id: m.taches["Reste nul"], jours: 0 }],
    }),
    "reste à faire",
  );
});
afterAll(() => ctx.fermer());

type Noeud = {
  id: string;
  niveau: string;
  suivi: { budget: number; realise: number; resteAFaire: number };
  enfants: Noeud[];
};

const aplatir = (n: Noeud): Noeud[] => [n, ...n.enfants.flatMap(aplatir)];

describe("synthèse du découpage : réalisé et reste à faire (PLN-02)", () => {
  it("tâche avec temps validés, sans temps, et avec reste déclaré nul", async () => {
    const r = await a.chef.get(`/api/missions/${m.id}/synthese`);
    expect(r.statusCode, r.body).toBe(200);
    expect(sansDonneeFinanciere(r.body)).toBe(true);
    const noeuds = aplatir(r.json().arborescence as Noeud);
    const tache = (libelle: string) => noeuds.find((n) => n.id === m.taches[libelle])!.suivi;
    // Temps validés : réalisé 3, reste estimé = budget − réalisé.
    expect(tache("Avec temps")).toMatchObject({ budget: 8, realise: 3, resteAFaire: 5 });
    // Aucun temps : réalisé 0, reste = budget.
    expect(tache("Sans temps")).toMatchObject({ budget: 4, realise: 0, resteAFaire: 4 });
    // Reste déclaré à 0 : il l'emporte sur l'estimation (4 − 2).
    expect(tache("Reste nul")).toMatchObject({ budget: 4, realise: 2, resteAFaire: 0 });
    // Total mission : somme des tâches.
    expect(noeuds[0]).toMatchObject({
      niveau: "mission",
      suivi: { budget: 16, realise: 5, resteAFaire: 9 },
    });
  });

  it("donne les mêmes valeurs que le suivi, pour chaque nœud", async () => {
    const synthese = (await a.chef.get(`/api/missions/${m.id}/synthese`)).json();
    const suivi = (await a.chef.get(`/api/missions/${m.id}/suivi`)).json();
    const brut = (n: {
      id: string;
      budget: number;
      realise: number;
      reste_a_faire: number;
      enfants: unknown[];
    }): [string, number, number, number][] => [
      [n.id, n.budget, n.realise, n.reste_a_faire],
      ...(n.enfants as (typeof n)[]).flatMap(brut),
    ];
    const vueSuivi = brut(suivi.arbre).sort();
    const vueSynthese = aplatir(synthese.arborescence as Noeud)
      .map((n): [string, number, number, number] => [
        n.id,
        n.suivi.budget,
        n.suivi.realise,
        n.suivi.resteAFaire,
      ])
      .sort();
    expect(vueSynthese).toEqual(vueSuivi);
    expect(synthese.jalons).toEqual([]);
  });
});
