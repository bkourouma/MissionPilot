/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chiffresDuRapport, recommandationsDuRapport } from "../src/qualite/branchements.js";
import { rapportEnHtml } from "../src/rapports/html.js";
import type { Rapport } from "../src/rapports/modele.js";
import { rapportNotation } from "../src/rapports/notation.js";
import { assertionCitee } from "../src/rapports/sources.js";
import type { Api } from "./api.js";
import { demarrer, type Contexte } from "./helpers.js";
import { authDe } from "./ia-outils.js";
import { creerAssertion, creerPreuve, lier, PREUVE_DOCUMENT } from "./preuves-outils.js";
import {
  envoyer,
  preparerQuestionnaires,
  repondre,
  reponsesAuNiveau,
  versionValidee,
  type ScenarioQuestionnaires,
} from "./questionnaires-outils.js";
import { dezipper, toutLeXml } from "./rapports-outils.js";

/*
 * Branchements de la qualité (QUA-01 à QUA-04) sur la notation et les rapports, et annexe des
 * sources des rapports (PRV-06) :
 * - soumission et publication d'une notation : suivi qualité `notation` (R3) avec les éléments de
 *   revue guidée (assertions fragiles, scores et leur source, recommandations de la méthode) ;
 * - génération d'un rapport : suivi `rapport` (R2) avec les chiffres du rapport et leur source ;
 * - mission liée à une méthode : publication possible seulement par le circuit MPN04 ET avec le
 *   suivi qualité de la version signé ; sans méthode, comportement V2 inchangé ;
 * - annexe « Sources » (PDF et Word) : preuves des assertions citées, numérotées, avec leur
 *   fiabilité, verbatim nominatif sans accord masqué.
 */

let ctx: Contexte;
let s: ScenarioQuestionnaires;
let envoiId: string;
let notationId: string;
const ids: Record<string, string> = {};

const VERBATIM = "Je ne regarde jamais les tableaux de bord, dit Mme Koné.";

function attendre<R extends { statusCode: number; body: string }>(
  statut: number,
  r: R,
  quoi: string,
): R {
  if (r.statusCode !== statut) throw new Error(`${quoi} : ${r.statusCode} ${r.body}`);
  return r;
}

async function suivis(type: string): Promise<any[]> {
  const r = await s.a.chef.get(
    `/api/qualite/suivis?mission_id=${s.missionId}&type_livrable=${type}`,
  );
  return attendre(200, r, "suivis").json().elements;
}

const detail = async (par: Api, id: string) =>
  attendre(200, await par.get(`/api/qualite/suivis/${id}`), "détail").json();

async function parcourir(par: Api, suiviId: string) {
  for (const e of (await detail(par, suiviId)).elements as { id: string }[]) {
    attendre(200, await par.post(`/api/qualite/suivis/${suiviId}/elements/${e.id}/vu`), "vu");
  }
}

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQuestionnaires(ctx);
  const v = await versionValidee(s.consultant, "notation_qualite");
  envoiId = await envoyer(s.consultant, s.missionId, v.versionId, [
    { utilisateur_id: s.dirigeant.utilisateurId },
    { utilisateur_id: s.contributeur.utilisateurId },
  ]);
  await repondre(s.dirigeant, envoiId, reponsesAuNiveau(v.definition, 4));
  await repondre(s.contributeur, envoiId, reponsesAuNiveau(v.definition, 3));

  // Registre des preuves : un verbatim nominatif SANS accord, un document, une observation.
  const nominatif = await creerPreuve(s.consultant, s.missionId, {
    source_precise: "Entretien avec Mme Koné, directrice financière",
    extrait: VERBATIM,
    nominatif: true,
    accord_nominatif: false,
  });
  const document = await creerPreuve(s.consultant, s.missionId, PREUVE_DOCUMENT);
  const observation = await creerPreuve(s.consultant, s.missionId, {
    type_source: "observation",
    source_precise: "Visite de l'atelier de conditionnement",
    fiabilite: "C",
    extrait: "Aucun affichage d'indicateur dans l'atelier.",
  });
  const solide = await creerAssertion(s.consultant, s.missionId, {
    enonce: "Le pilotage de la performance repose sur des tableaux de bord peu utilisés.",
    statut: "retenue",
    livrable: "Rapport de notation",
  });
  await lier(s.consultant, solide.id, nominatif.id, "pour");
  await lier(s.consultant, solide.id, document.id, "pour");
  const fragile = await creerAssertion(s.consultant, s.missionId, {
    enonce: "Les indicateurs ne sont pas affichés sur le terrain.",
    statut: "retenue",
    livrable: "Rapport de notation",
  });
  await lier(s.consultant, fragile.id, observation.id, "pour");
  const plan = await creerAssertion(s.consultant, s.missionId, {
    enonce: "Le plan stratégique doit prioriser la trésorerie.",
    statut: "retenue",
    livrable: "Plan stratégique",
  });
  Object.assign(ids, {
    nominatif: nominatif.id,
    document: document.id,
    solide: solide.id,
    fragile: fragile.id,
    plan: plan.id,
  });

  notationId = attendre(
    201,
    await s.consultant.post(`/api/missions/${s.missionId}/notation`, {}),
    "notation",
  ).json().id;
}, 240_000);
afterAll(() => ctx.fermer());

describe("notation sans méthode : comportement V2, suivi qualité ouvert", () => {
  it("la soumission ouvre le suivi R3 avec assertions fragiles et scores sourcés", async () => {
    attendre(
      201,
      await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoiId }),
      "calcul",
    );
    attendre(200, await s.consultant.post(`/api/notations/${notationId}/soumettre`), "soumission");
    const [suivi] = await suivis("notation");
    expect(suivi).toMatchObject({
      livrable_id: notationId,
      version: 1,
      classe: "R3",
      classe_minimale: "R3",
    });
    const d = await detail(s.a.chef, suivi.id);
    const cles = d.elements.map((e: { cle: string }) => e.cle);
    expect(cles).toContain(`assertion:${ids.fragile}`);
    expect(cles).not.toContain(`assertion:${ids.solide}`);
    const chiffres = d.elements.filter((e: { kind: string }) => e.kind === "chiffre");
    expect(chiffres.length).toBeGreaterThan(1);
    expect(chiffres[0].libelle).toMatch(/^Score global : /);
    for (const c of chiffres) expect(c.source).toMatch(/Moteur de notation/);
    expect(d.elements.some((e: { kind: string }) => e.kind === "recommandation")).toBe(false);
  });

  it("publication par le circuit existant, sans suivi signé (mission sans méthode)", async () => {
    // MPN04 inchangé : l'auteur du calcul ne publie pas.
    expect((await s.consultant.post(`/api/notations/${notationId}/publier`)).statusCode).toBe(403);
    attendre(200, await s.expert.post(`/api/notations/${notationId}/publier`), "publication");
    expect(await suivis("notation")).toHaveLength(1);
  });
});

describe("rapport généré : suivi qualité et annexe des sources (PRV-06)", () => {
  it("la génération ouvre le suivi R2 du rapport avec ses chiffres et leur source", async () => {
    const r = attendre(
      201,
      await s.consultant.post(`/api/notations/${notationId}/rapports?format=docx`),
      "rapport",
    ).json();
    const [suivi] = await suivis("rapport");
    expect(suivi).toMatchObject({ livrable_id: r.rapport.id, classe: "R2" });
    expect(suivi.libelle).toMatch(/^Rapport de notation \(DOCX\) du /);
    const d = await detail(s.a.chef, suivi.id);
    const chiffres = d.elements.filter((e: { kind: string }) => e.kind === "chiffre");
    expect(chiffres.map((c: { libelle: string }) => c.libelle)).toContainEqual(
      expect.stringMatching(/^Synthèse — Score global : /),
    );
    for (const c of chiffres) expect(c.source).toMatch(/^Rapport « Rapport de notation »/);
    expect(d.elements.map((e: { cle: string }) => e.cle)).toContain(`assertion:${ids.fragile}`);
    ids.fichier = r.fichier.id;
  });

  it("export Word : annexe numérotée, fiabilité, verbatim nominatif sans accord masqué", async () => {
    const f = await s.consultant.get(`/api/fichiers/${ids.fichier}`);
    expect(f.statusCode).toBe(200);
    const xml = toutLeXml(dezipper(f.rawPayload));
    expect(xml).toContain("Annexe — Sources");
    expect(xml).toContain("Assertions citées");
    expect(xml).toContain(
      "Le pilotage de la performance repose sur des tableaux de bord peu utilisés.",
    );
    expect(xml).not.toContain("Le plan stratégique doit prioriser la trésorerie.");
    expect(xml).toContain(PREUVE_DOCUMENT.source_precise);
    expect(xml).toContain("Source nominative masquée");
    expect(xml).not.toContain("Mme Koné");
    expect(xml).not.toContain(VERBATIM);
  });

  it("export PDF (même modèle rendu en HTML) : mêmes sources, même masquage", async () => {
    const auth = await authDe(ctx, s.a.cabinetId, s.consultant.utilisateurId);
    const { rapport } = await ctx.db.withTenant(s.a.cabinetId, (db) =>
      rapportNotation(db, auth, notationId, undefined, "2026-10-08"),
    );
    const annexe = rapport.sections[rapport.sections.length - 1]!;
    expect(annexe.titre).toBe("Annexe — Sources");
    const [assertions, sources] = annexe.blocs.filter((b) => b.type === "tableau") as any[];
    expect(assertions.lignes).toEqual([
      [
        "Le pilotage de la performance repose sur des tableaux de bord peu utilisés.",
        "Solide",
        "[1], [2]",
      ],
      ["Les indicateurs ne sont pas affichés sur le terrain.", "Fragile", "[3]"],
    ]);
    expect(sources.lignes.map((l: string[]) => [l[0], l[1], l[4]])).toEqual([
      ["1", "Entretien", "B"],
      ["2", "Document", "A"],
      ["3", "Observation de terrain", "C"],
    ]);
    expect(sources.lignes[0][2]).toBe("Source nominative masquée");
    expect(sources.lignes[0][5]).toMatch(/^Verbatim nominatif non cité/);
    const html = rapportEnHtml(rapport);
    expect(html).toContain("Annexe — Sources");
    expect(html).not.toContain("Mme Koné");
  });

  it("règle de citation : assertion retenue dont le livrable désigne le rapport", () => {
    const a = (statut: string, livrable: string | null) => ({ statut, livrable });
    expect(assertionCitee(a("retenue", "Rapport de NOTATION"), "notation")).toBe(true);
    expect(assertionCitee(a("retenue", "Plan stratégique"), "plan")).toBe(true);
    expect(assertionCitee(a("retenue", "Plan stratégique"), "notation")).toBe(false);
    expect(assertionCitee(a("brouillon", "Rapport de notation"), "notation")).toBe(false);
    expect(assertionCitee(a("retenue", null), "notation")).toBe(false);
  });
});

describe("notation d'une mission liée à une méthode : R3 signé avant publication", () => {
  it("publication refusée tant que le suivi qualité de la version n'est pas signé (409)", async () => {
    const liste = attendre(
      200,
      await s.a.associe.get("/api/methodes?limite=100"),
      "méthodes",
    ).json();
    const versionId = liste.elements.find((m: { code: string }) => m.code === "notation_entreprise")
      .derniere_publiee.id;
    attendre(
      200,
      await s.a.chef.put(`/api/missions/${s.missionId}/methode`, {
        version_id: versionId,
        contexte: { effectif: 40, filieres: ["cacao"], agricole: true },
      }),
      "liaison",
    );
    attendre(
      201,
      await s.consultant.post(`/api/notations/${notationId}/calculs`, { envoi_id: envoiId }),
      "calcul v2",
    );
    attendre(200, await s.consultant.post(`/api/notations/${notationId}/soumettre`), "soumission");
    const suivi = (await suivis("notation")).find((x) => x.version === 2);
    expect(suivi).toMatchObject({ classe: "R3", statut: "brouillon" });
    ids.suivi = suivi.id;
    const d = await detail(s.a.chef, suivi.id);
    // Recommandation candidate de la règle « filière agricole » de la méthode.
    expect(
      d.elements
        .filter((e: { kind: string }) => e.kind === "recommandation")
        .map((e: { libelle: string }) => e.libelle),
    ).toEqual(["Recommandation candidate de la méthode : kpi_pertes_post_recolte"]);
    const refus = await s.expert.post(`/api/notations/${notationId}/publier`);
    expect(refus.statusCode).toBe(409);
    expect(refus.json().erreur.code).toBe("SUIVI_QUALITE_NON_SIGNE");
  });

  it("après quatre yeux et signature du directeur, l'expert publie (MPN04 toujours exigé)", async () => {
    const id = ids.suivi!;
    const v = attendre(
      200,
      await s.a.chef.post(`/api/qualite/suivis/${id}/verification`),
      "vérification",
    ).json();
    for (const i of v.definition.items as { id: string; controle: string; statut: string }[]) {
      expect(i.statut === "non_conforme").toBe(false);
      if (i.statut === "non_evaluable" || i.controle === "manuel") {
        attendre(
          200,
          await s.a.chef.post(`/api/qualite/suivis/${id}/verification/${i.id}/attestation`, {
            commentaire: "Ajustements relus.",
          }),
          "attestation",
        );
      }
    }
    for (const par of [s.consultant, s.a.chef, s.expert2, s.a.directeur]) await parcourir(par, id);
    const etapes: [Api, string][] = [
      [s.consultant, "validation_consultant"],
      [s.a.chef, "relecture_chef_mission"],
      [s.expert2, "revue_second_expert"],
    ];
    for (const [par, etape] of etapes) {
      attendre(200, await par.post(`/api/qualite/suivis/${id}/validations`, { etape }), etape);
    }
    // Validé mais non signé : toujours refusé.
    expect((await s.expert.post(`/api/notations/${notationId}/publier`)).statusCode).toBe(409);
    attendre(
      200,
      await s.a.directeur.post(`/api/qualite/suivis/${id}/signature`, {
        commentaire: "Bon pour publication",
      }),
      "signature",
    );
    // Le circuit de la notation reste exigé : l'auteur du calcul ne publie pas.
    expect((await s.consultant.post(`/api/notations/${notationId}/publier`)).statusCode).toBe(403);
    const pub = attendre(
      200,
      await s.expert.post(`/api/notations/${notationId}/publier`),
      "publication",
    ).json();
    expect(pub).toMatchObject({ numero: 2, statut: "publiee" });
    expect((await detail(s.a.chef, id)).suivi.statut).toBe("signe");
  });
});

describe("éléments de revue tirés d'un rapport (plan, état d'avancement)", () => {
  const rapport: Rapport = {
    titre: "Plan stratégique",
    emetteur: "Cabinet",
    statut: "valide",
    genere_le: "2026-10-08",
    confidentiel: false,
    sections: [
      {
        titre: "Synthèse",
        blocs: [
          { type: "paragraphe", texte: "Texte" },
          {
            type: "indicateurs",
            elements: [
              { libelle: "Budget total", valeur: "12 000 000 FCFA", detail: "3 initiatives" },
              { libelle: "VAN", valeur: "4 500 000 FCFA" },
            ],
          },
        ],
      },
      {
        titre: "Initiatives",
        blocs: [
          {
            type: "tableau",
            colonnes: ["Initiative", "Budget"],
            lignes: [
              ["Tableau de bord mensuel", "2 000 000 FCFA"],
              ["Formation des managers", "1 000 000 FCFA"],
            ],
          },
        ],
      },
    ],
  };

  it("chiffres des blocs « indicateurs » avec leur section comme source ; initiatives recommandées", () => {
    const chiffres = chiffresDuRapport(rapport, "rapport:x");
    expect(chiffres.map((c) => [c.cle, c.libelle])).toEqual([
      ["rapport:x:chiffre:0.1.0", "Synthèse — Budget total : 12 000 000 FCFA (3 initiatives)"],
      ["rapport:x:chiffre:0.1.1", "Synthèse — VAN : 4 500 000 FCFA"],
    ]);
    expect(chiffres[0]!.source).toBe(
      "Rapport « Plan stratégique », section « Synthèse » : valeur mise en forme depuis les moteurs MissionPilot",
    );
    expect(recommandationsDuRapport(rapport, "rapport:x").map((r) => r.libelle)).toEqual([
      "Initiative recommandée : Tableau de bord mensuel",
      "Initiative recommandée : Formation des managers",
    ]);
    expect(recommandationsDuRapport({ ...rapport, sections: [rapport.sections[0]!] }, "r")).toEqual(
      [],
    );
  });
});
