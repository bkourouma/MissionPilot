import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Service candidat « Diagnostic flash » : méthode du standard (version 1 publiée, migration 0560)
 * ajoutée par assemblage de briques, sans développement spécifique (PRD complémentaire §4, §11.6).
 * Contenu provisoire, à valider par un expert métier.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let flashV1: string;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

interface BriqueM {
  code: string;
  active: boolean;
  classe_risque: string;
  classe_risque_base: string;
}
interface MethodeM {
  etapes: { code: string; briques: BriqueM[] }[];
  elements: { code: string; actif: boolean }[];
  ajustements: { formulation?: string };
  recommandations_candidates: string[];
}

const briquesDe = (m: MethodeM): Record<string, BriqueM> =>
  Object.fromEntries(m.etapes.flatMap((e) => e.briques).map((x) => [x.code, x]));
const actives = (m: MethodeM): string[] =>
  m.etapes
    .flatMap((e) => e.briques)
    .filter((x) => x.active)
    .map((x) => x.code)
    .sort();

const PME_AGRICOLE_FRAGILE = {
  effectif: 8,
  fiabilite_comptes: "non_certifies",
  part_informel: "forte",
  filieres: ["cacao"],
  agricole: true,
};
const CONTEXTE_SAIN = {
  effectif: 120,
  fiabilite_comptes: "certifies",
  part_informel: "faible",
  situation: "stabilite",
  agricole: false,
};

const ACTIVES_PAR_DEFAUT = [
  "analyse_flash",
  "cadrage_express",
  "entretien_dirigeant",
  "proposition_suite",
  "questionnaire_court",
  "rapport_court",
  "restitution_flash",
  "revue_documentaire",
];

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Flash A");
  b = await preparerCabinet(ctx, "Flash B");
  const liste = attendu(200, await a.associe.get("/api/methodes?limite=100"));
  const flash = liste.elements.find((m: { code: string }) => m.code === "diagnostic_flash");
  expect(flash, "méthode diagnostic_flash du standard").toBeDefined();
  flashV1 = flash.derniere_publiee.id;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("méthode du standard « diagnostic_flash »", () => {
  it("existe en version 1 publiée, provisoire, rattachée au service diagnostic_flash", async () => {
    const v = attendu(200, await a.associe.get(`/api/methodes/versions/${flashV1}`));
    expect(v.version).toMatchObject({ version: 1, statut: "publiee" });
    expect(String(v.version.notes_version)).toMatch(
      /^PROVISOIRE — contenu à valider par un expert métier/,
    );
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT s.code AS service, m.cabinet_id, m.description
               FROM methode_versions mv
               JOIN methodes m ON m.id = mv.methode_id
               JOIN services_conseil s ON s.id = m.service_id
              WHERE mv.id = $1`,
            [flashV1],
          )
        ).rows,
    );
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ service: "diagnostic_flash", cabinet_id: null });
    expect(lignes[0].description).toMatch(/^PROVISOIRE/);
    const notes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT texte FROM notes_contexte
              WHERE cabinet_id IS NULL AND cible_type = 'methode' AND cible_code = 'diagnostic_flash'`,
          )
        ).rows,
    );
    expect(notes).toHaveLength(1);
  });

  it("validation : aucune anomalie ; cas types tous réussis", async () => {
    const validation = attendu(
      200,
      await a.associe.get(`/api/methodes/versions/${flashV1}/validation`),
    );
    expect(validation.anomalies.filter((x: { gravite: string }) => x.gravite === "erreur")).toEqual(
      [],
    );
    expect(validation.valide).toBe(true);
    expect(validation.anomalies, JSON.stringify(validation.anomalies)).toEqual([]);
    expect(validation.cas_types.reussis).toBeGreaterThanOrEqual(3);
    expect(validation.cas_types.echoues).toBe(0);
    const execution = attendu(
      200,
      await a.associe.post(`/api/methodes/versions/${flashV1}/cas-types/execution`),
    );
    expect(execution.reussi, JSON.stringify(execution)).toBe(true);
  });

  it("briques actives par défaut pour environ 5 jours ; quatre règles au moins", async () => {
    const v = attendu(200, await a.associe.get(`/api/methodes/versions/${flashV1}`));
    const briques = v.briques as {
      code: string;
      active_par_defaut: boolean;
      temps_type_jours: number | string;
    }[];
    expect(
      briques
        .filter((x) => x.active_par_defaut)
        .map((x) => x.code)
        .sort(),
    ).toEqual(ACTIVES_PAR_DEFAUT);
    const total = briques
      .filter((x) => x.active_par_defaut)
      .reduce((s, x) => s + Number(x.temps_type_jours), 0);
    expect(total).toBeGreaterThanOrEqual(4.5);
    expect(total).toBeLessThanOrEqual(5.5);
    expect(v.regles.length).toBeGreaterThanOrEqual(4);
  });
});

describe("mission liée à la méthode et aperçu", () => {
  let missionId: string;

  it("PME agricole aux comptes fragiles : briques optionnelles activées, classe relevée", async () => {
    missionId = (await creerMission(a)).id;
    const m = attendu(
      200,
      await a.chef.put(`/api/missions/${missionId}/methode`, {
        version_id: flashV1,
        contexte: PME_AGRICOLE_FRAGILE,
        motif: "PME cacao de 8 personnes, comptes non certifiés, espèces dominantes.",
      }),
    );
    expect(m.version).toMatchObject({ methode_code: "diagnostic_flash", origine: "standard" });
    const effective = attendu(200, await a.chef.get(`/api/missions/${missionId}/methode`));
    const briques = briquesDe(effective);
    expect(briques.reconstitution_ca).toMatchObject({ active: true });
    expect(briques.predia_redressement).toMatchObject({ active: false });
    expect(briques.analyse_flash).toMatchObject({ classe_risque_base: "R2", classe_risque: "R3" });
    expect(effective.ajustements.formulations).toMatchObject({ analyse_flash: "indicative" });
    expect(effective.recommandations_candidates).toEqual(["kpi_pertes_post_recolte"]);
    expect(effective.modulation.regles_declenchees.sort()).toEqual([
      "comptes_fragiles",
      "filiere_agricole",
      "tres_petite_structure",
    ]);
    expect(actives(effective)).toEqual([...ACTIVES_PAR_DEFAUT, "reconstitution_ca"].sort());
  });

  it("aperçu : synthèse cohérente avec la mission réelle", async () => {
    const apercu = attendu(
      200,
      await a.chef.post(`/api/methodes/versions/${flashV1}/apercu`, {
        contexte: PME_AGRICOLE_FRAGILE,
      }),
    );
    const reelle = attendu(200, await a.chef.get(`/api/missions/${missionId}/methode`));
    expect(actives(apercu.methode)).toEqual(actives(reelle));
    expect(apercu.synthese.briques_actives).toBe(ACTIVES_PAR_DEFAUT.length + 1);
    expect(apercu.synthese.briques_inactives).toBe(1);
    expect(apercu.synthese.classe_max).toBe("R3");
  });

  it("situation de tension : pré-diagnostic de redressement activé", async () => {
    const apercu = attendu(
      200,
      await a.chef.post(`/api/methodes/versions/${flashV1}/apercu`, {
        contexte: { ...CONTEXTE_SAIN, situation: "tension" },
      }),
    );
    const briques = briquesDe(apercu.methode);
    expect(briques.predia_redressement?.active).toBe(true);
    expect(briques.reconstitution_ca?.active).toBe(false);
  });

  it("contexte sain : briques optionnelles inactives, seules les briques par défaut", async () => {
    const apercu = attendu(
      200,
      await a.chef.post(`/api/methodes/versions/${flashV1}/apercu`, { contexte: CONTEXTE_SAIN }),
    );
    expect(actives(apercu.methode)).toEqual(ACTIVES_PAR_DEFAUT);
    expect(apercu.synthese.briques_inactives).toBe(2);
    expect(apercu.regles_declenchees).toEqual([]);
    expect(briquesDe(apercu.methode).analyse_flash?.classe_risque).toBe("R2");
  });
});

describe("standard en lecture seule pour les autres cabinets", () => {
  it("un autre cabinet voit la méthode du standard mais ne peut pas la modifier", async () => {
    const liste = attendu(200, await b.associe.get("/api/methodes?limite=100"));
    expect(liste.elements.some((m: { code: string }) => m.code === "diagnostic_flash")).toBe(true);
    const expert = await b.avecRoles(["expert_metier"]);
    const v = attendu(200, await expert.get(`/api/methodes/versions/${flashV1}`));
    const element = v.elements[0];
    const refus = await expert.patch(`/api/methodes/versions/${flashV1}/elements/${element.id}`, {
      libelle: "Intrus",
    });
    expect([403, 409]).toContain(refus.statusCode);
    // Au niveau base, une version publiée est immuable (MPM01).
    await expect(
      proprietaire((c) =>
        c.query(`UPDATE methode_briques SET libelle = 'Intrus' WHERE version_id = $1`, [flashV1]),
      ),
    ).rejects.toMatchObject({ code: "MPM01" });
  });
});
