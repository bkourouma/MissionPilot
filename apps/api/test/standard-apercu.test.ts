import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

/*
 * Aperçu de la mission générée (STD-11) : `POST /methodes/versions/:id/apercu` applique les règles
 * d'une version à un contexte et résout la méthode EFFECTIVE, comme pour une mission réelle, sans
 * rien écrire. Identité avec la mission réelle, déterminisme, lecture seule, droits, isolation.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let expert: Api & { utilisateurId: string };
let consultant: Api;
let gestionnaire: Api;
let notationV1: string;
let notationId: string;
let missionId: string;

type Reponse = Awaited<ReturnType<Api["get"]>>;
function attendu(statut: number, r: Reponse) {
  expect(r.statusCode, r.body).toBe(statut);
  return r.json();
}

const PME_CACAO = {
  effectif: 12,
  fiabilite_comptes: "non_certifies",
  part_informel: "forte",
  actionnariat: "familial",
  filieres: ["cacao"],
  agricole: true,
};
const GRANDE_FILIALE = { effectif: 800, actionnariat: "filiale_groupe" };

interface BriqueM {
  code: string;
  active: boolean;
  classe_risque: string;
  classe_risque_base: string;
  origine: string;
}
interface MethodeM {
  etapes: { code: string; briques: BriqueM[] }[];
  elements: { code: string; actif: boolean; origine: string }[];
  ajustements: unknown;
  recommandations_candidates: string[];
}

/** Ce que l'aperçu et la mission réelle doivent partager. */
function empreinte(m: MethodeM) {
  const briques = m.etapes.flatMap((e) => e.briques);
  return {
    actives: briques
      .filter((x) => x.active)
      .map((x) => x.code)
      .sort(),
    classes: Object.fromEntries(briques.map((x) => [x.code, x.classe_risque])),
    elements: m.elements
      .filter((x) => x.actif)
      .map((x) => x.code)
      .sort(),
  };
}

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Aperçu A");
  b = await preparerCabinet(ctx, "Aperçu B");
  expert = await a.avecRoles(["expert_metier"]);
  consultant = await a.avecRoles(["consultant"]);
  gestionnaire = await a.avecRoles(["gestionnaire"]);
  missionId = (await creerMission(a)).id;
  const liste = attendu(200, await a.associe.get("/api/methodes?limite=100"));
  const notation = liste.elements.find((m: { code: string }) => m.code === "notation_entreprise");
  notationId = notation.id;
  notationV1 = notation.derniere_publiee.id;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("aperçu identique à la méthode effective d'une mission réelle", () => {
  it("forme de la réponse : version, contexte, règles, conflits, journal, méthode et synthèse", async () => {
    const r = attendu(
      200,
      await consultant.post(`/api/methodes/versions/${notationV1}/apercu`, { contexte: PME_CACAO }),
    );
    expect(Object.keys(r).sort()).toEqual(
      [
        "conflits",
        "contexte",
        "journal",
        "methode",
        "regles_declenchees",
        "synthese",
        "version",
      ].sort(),
    );
    expect(r.version).toMatchObject({
      id: notationV1,
      version: 1,
      statut: "publiee",
      methode_libelle: expect.any(String),
    });
    expect(r.version.methode_id).toBe(notationId);
    expect(r.contexte).toEqual(PME_CACAO);
    expect(r.regles_declenchees).toHaveLength(4);
    expect(r.journal.length).toBeGreaterThan(0);
    expect(Array.isArray(r.conflits)).toBe(true);
    const briques: BriqueM[] = r.methode.etapes.flatMap((e: { briques: BriqueM[] }) => e.briques);
    expect(r.synthese.briques_actives).toBe(briques.filter((x) => x.active).length);
    expect(r.synthese.briques_inactives).toBe(briques.filter((x) => !x.active).length);
    expect(Object.keys(r.synthese.briques_par_classe)).toEqual(["R0", "R1", "R2", "R3"]);
    expect(r.synthese.classe_max).toBe("R3");
    expect(r.synthese.temps_type_total_jours).toBeGreaterThan(0);
  });

  it("deux contextes successifs : mêmes briques actives, classes effectives et éléments actifs que la mission", async () => {
    const motif = "Contexte du dossier : mission d'essai.";
    attendu(
      200,
      await a.chef.put(`/api/missions/${missionId}/methode`, {
        version_id: notationV1,
        contexte: PME_CACAO,
        motif,
      }),
    );
    for (const contexte of [PME_CACAO, GRANDE_FILIALE, PME_CACAO]) {
      const courant = attendu(200, await a.chef.get(`/api/missions/${missionId}/methode`));
      if (JSON.stringify(courant.liaison.contexte) !== JSON.stringify(contexte)) {
        attendu(
          200,
          await a.chef.post(`/api/missions/${missionId}/methode/contexte`, { contexte, motif }),
        );
      }
      const reelle = attendu(200, await a.chef.get(`/api/missions/${missionId}/methode`));
      const apercu = attendu(
        200,
        await consultant.post(`/api/methodes/versions/${notationV1}/apercu`, { contexte }),
      );
      expect(empreinte(apercu.methode)).toEqual(empreinte(reelle));
      expect(apercu.regles_declenchees).toEqual(reelle.modulation.regles_declenchees);
      expect(apercu.methode.etapes).toEqual(reelle.etapes);
      expect(apercu.methode.elements).toEqual(reelle.elements);
      expect(apercu.methode.ajustements).toEqual(reelle.ajustements);
      expect(apercu.methode.recommandations_candidates).toEqual(reelle.recommandations_candidates);
      expect(apercu.journal).toEqual(reelle.modulation.journal);
      expect(apercu.conflits).toEqual(reelle.modulation.conflits);
    }
    // Les deux contextes donnent bien des méthodes différentes (le test n'est pas trivial).
    const petite = attendu(
      200,
      await consultant.post(`/api/methodes/versions/${notationV1}/apercu`, { contexte: PME_CACAO }),
    );
    const grande = attendu(
      200,
      await consultant.post(`/api/methodes/versions/${notationV1}/apercu`, {
        contexte: GRANDE_FILIALE,
      }),
    );
    expect(empreinte(petite.methode).actives).not.toEqual(empreinte(grande.methode).actives);
  });

  it("déterministe : deux appels donnent la même réponse ; corps vide = contexte vide", async () => {
    const url = `/api/methodes/versions/${notationV1}/apercu`;
    const un = attendu(200, await consultant.post(url, { contexte: PME_CACAO }));
    const deux = attendu(200, await consultant.post(url, { contexte: PME_CACAO }));
    expect(deux).toEqual(un);
    const vide = attendu(200, await consultant.post(url, {}));
    expect(vide.contexte).toEqual({});
    expect(vide.regles_declenchees).toEqual([]);
  });

  it("contexte invalide : 400 CONTEXTE_INVALIDE ; corps hors schéma : 400", async () => {
    const url = `/api/methodes/versions/${notationV1}/apercu`;
    expect(
      attendu(400, await consultant.post(url, { contexte: { effectif: -3 } })).erreur.code,
    ).toBe("CONTEXTE_INVALIDE");
    expect(
      attendu(400, await consultant.post(url, { contexte: { facteur_inconnu: true } })).erreur.code,
    ).toBe("CONTEXTE_INVALIDE");
    expect((await consultant.post(url, { contexte: PME_CACAO, extra: 1 })).statusCode).toBe(400);
    expect((await consultant.post(url, { contexte: { effectif: "douze" } })).statusCode).toBe(400);
    expect(
      (await consultant.post(`/api/methodes/versions/pas-un-uuid/apercu`, {})).statusCode,
    ).toBe(400);
  });
});

describe("lecture seule, droits et isolation", () => {
  it("n'écrit rien : aucune ligne de mission_methodes, de journal ni de contenu de méthode", async () => {
    const compter = () =>
      proprietaire(async (c) => {
        const q = async (sql: string) => (await c.query(sql, [a.cabinetId])).rows[0].n as number;
        return {
          liaisons: await q(
            `SELECT count(*)::int AS n FROM mission_methodes WHERE cabinet_id = $1`,
          ),
          audit: await q(`SELECT count(*)::int AS n FROM journal_audit WHERE cabinet_id = $1`),
          versions: await q(
            `SELECT count(*)::int AS n FROM methode_versions WHERE cabinet_id = $1`,
          ),
          briques: await q(`SELECT count(*)::int AS n FROM methode_briques WHERE cabinet_id = $1`),
        };
      });
    const avant = await compter();
    for (const contexte of [PME_CACAO, GRANDE_FILIALE, {}]) {
      attendu(
        200,
        await consultant.post(`/api/methodes/versions/${notationV1}/apercu`, { contexte }),
      );
    }
    expect(await compter()).toEqual(avant);
  });

  it("sans session 401 ; sans standard.lire (gestionnaire) 403 ; version inconnue ou d'un autre cabinet 404", async () => {
    const url = `/api/methodes/versions/${notationV1}/apercu`;
    expect((await api(ctx).post(url, {})).statusCode).toBe(401);
    expect((await gestionnaire.post(url, {})).statusCode).toBe(403);
    expect(
      (
        await consultant.post(
          "/api/methodes/versions/00000000-0000-4000-8000-000000000000/apercu",
          {},
        )
      ).statusCode,
    ).toBe(404);
    // Le standard est visible de tout cabinet ; la variante d'un cabinet ne l'est pas d'un autre.
    attendu(200, await b.associe.post(url, { contexte: PME_CACAO }));
    const variante = attendu(201, await expert.post(`/api/methodes/${notationId}/variantes`, {}));
    expect(
      (await b.associe.post(`/api/methodes/versions/${variante.version_id}/apercu`, {})).statusCode,
    ).toBe(404);
  });

  it("l'aperçu d'un BROUILLON suit l'éditeur : facteur, brique et règle ajoutés sont pris en compte", async () => {
    const variante = attendu(200, await expert.get(`/api/methodes/${notationId}`));
    const brouillon = variante.variante
      ? attendu(200, await expert.get(`/api/methodes/${variante.variante.id}`)).versions[0].id
      : null;
    expect(brouillon).toBeTruthy();
    const detail = attendu(200, await expert.get(`/api/methodes/versions/${brouillon}`));
    expect(detail.version.statut).toBe("brouillon");
    const restitution = detail.etapes.find((e: { code: string }) => e.code === "restitution");
    attendu(
      201,
      await expert.post("/api/standard/facteurs", {
        code: "atelier_souhaite",
        libelle: "Atelier souhaité",
        type: "booleen",
      }),
    );
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${brouillon}/briques`, {
        code: "atelier_option",
        libelle: "Atelier optionnel",
        objet: "Atelier à la demande du client.",
        etape_id: restitution.id,
        classe_risque: "R1",
        niveau_autonomie_max: "N1",
        active_par_defaut: false,
        temps_type_jours: 1.25,
      }),
    );
    attendu(
      201,
      await expert.post(`/api/methodes/versions/${brouillon}/regles`, {
        code: "atelier_a_la_demande",
        priorite: 5,
        condition: {
          type: "comparaison",
          facteur: "atelier_souhaite",
          comparateur: "egal",
          valeur: true,
        },
        effets: [{ type: "activer_brique", brique: "atelier_option" }],
      }),
    );
    const url = `/api/methodes/versions/${brouillon}/apercu`;
    const sans = attendu(200, await expert.post(url, { contexte: { atelier_souhaite: false } }));
    const avec = attendu(200, await expert.post(url, { contexte: { atelier_souhaite: true } }));
    expect(sans.version.statut).toBe("brouillon");
    expect(empreinte(sans.methode).actives).not.toContain("atelier_option");
    expect(empreinte(avec.methode).actives).toContain("atelier_option");
    expect(avec.regles_declenchees).toContain("atelier_a_la_demande");
    expect(avec.synthese.briques_actives).toBe(sans.synthese.briques_actives + 1);
    // 1,25 jour ajouté, en centièmes entiers : aucun arrondi flottant visible.
    expect(avec.synthese.temps_type_total_jours - sans.synthese.temps_type_total_jours).toBeCloseTo(
      1.25,
      10,
    );
    const etape = avec.synthese.temps_par_etape.find(
      (e: { etape_code: string }) => e.etape_code === "restitution",
    );
    const etapeSans = sans.synthese.temps_par_etape.find(
      (e: { etape_code: string }) => e.etape_code === "restitution",
    );
    expect(etape.jours - etapeSans.jours).toBeCloseTo(1.25, 10);
  });
});
