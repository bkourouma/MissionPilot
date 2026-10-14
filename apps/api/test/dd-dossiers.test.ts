/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  attendu,
  CADRAGE,
  cloturerMission,
  creerDossierDd,
  INCONNU,
  preparerDd,
  type ScenarioDd,
} from "./dd-outils.js";
import { creerMission, creerMissionSignee } from "./missions-outils.js";

/*
 * Dossiers et cadrage (DD-01, R01 à R06) : taxonomie du référentiel, acquisition sans cible,
 * plafond de 10 par mission, versions et `version_courante`, dimensions `dd.*` du registre des
 * preuves créées une fois (idempotent), droits, autre cabinet, mission invisible ou clôturée.
 */

let ctx: Contexte;
let s: ScenarioDd;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerDd(ctx, "DD dossiers");
}, 240_000);
afterAll(() => ctx.fermer());

const url = (m = s.missionId) => `/api/missions/${m}/dd/dossiers`;

async function missionEquipee(signee = false): Promise<string> {
  const m = signee ? (await creerMissionSignee(s.a)).id : (await creerMission(s.a)).id;
  await s.a.chef.post(`/api/missions/${m}/equipe`, {
    utilisateur_id: s.consultantEquipe.utilisateurId,
  });
  return m;
}

describe("droits et cloisonnement", () => {
  it("401 sans session", async () => {
    expect((await api(ctx).get(url())).statusCode).toBe(401);
    expect((await api(ctx).post(url(), CADRAGE)).statusCode).toBe(401);
    expect((await api(ctx).get(`/api/dd/dossiers/${INCONNU}`)).statusCode).toBe(401);
  });

  it("403 sans dd.lire (gestionnaire, ressources, expert externe) et sans dd.ecrire (expert métier)", async () => {
    for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
      expect((await u.get(url())).statusCode).toBe(403);
      expect((await u.post(url(), CADRAGE)).statusCode).toBe(403);
    }
    expect((await s.expertMetier.get(url())).statusCode).toBe(200);
    expect((await s.expertMetier.post(url(), CADRAGE)).statusCode).toBe(403);
  });

  it("404 pour une mission invisible (hors équipe) ou d'un autre cabinet", async () => {
    expect((await s.consultantHors.get(url())).statusCode).toBe(404);
    expect((await s.consultantHors.post(url(), CADRAGE)).statusCode).toBe(404);
    expect((await s.b.associe.get(url())).statusCode).toBe(404);
    expect((await s.b.associe.post(url(), CADRAGE)).statusCode).toBe(404);
  });
});

describe("création et lecture", () => {
  it("crée un dossier (201), le liste (R01), le lit (R03) avec les libellés de taxonomie", async () => {
    const d = await creerDossierDd(s.consultantEquipe, s.missionId);
    expect(d.version).toBe(1);
    const liste = attendu(200, await s.consultantEquipe.get(url()));
    expect(liste.elements.map((e: any) => e.id)).toContain(d.id);
    const ligne = liste.elements.find((e: any) => e.id === d.id);
    expect(ligne).toMatchObject({
      titre: CADRAGE.titre,
      secteur_code: "citi_a",
      pays_code: "ci",
      type_operation: "entree_marche",
      devise: "XOF",
      date_operation: "2026-03-01",
      version_cadrage: 1,
    });
    const fiche = attendu(200, await s.expertMetier.get(`/api/dd/dossiers/${d.id}`));
    expect(fiche.secteur_libelle).toMatch(/Agriculture/);
    expect(fiche.filiere_libelle).toBe("Cacao");
    expect(fiche.pays_libelle).toMatch(/Ivoire/);
    expect(fiche.mission).toMatchObject({ id: s.missionId });
    expect(JSON.stringify(fiche)).not.toMatch(/cout_jour|taux_horaire|honoraire/);
  });

  it("un autre cabinet ou une mission invisible reçoit 404 sur le dossier, ses versions et sa synthèse", async () => {
    const d = await creerDossierDd(s.consultantEquipe, s.missionId);
    for (const chemin of ["", "/synthese", "/cadrage/versions"]) {
      expect((await s.b.associe.get(`/api/dd/dossiers/${d.id}${chemin}`)).statusCode).toBe(404);
      expect((await s.consultantHors.get(`/api/dd/dossiers/${d.id}${chemin}`)).statusCode).toBe(
        404,
      );
    }
    expect((await s.consultantEquipe.get(`/api/dd/dossiers/${INCONNU}`)).statusCode).toBe(404);
  });

  it("les 22 dimensions dd.* du registre sont créées une fois (idempotent)", async () => {
    const m = await missionEquipee();
    await creerDossierDd(s.consultantEquipe, m);
    await creerDossierDd(s.consultantEquipe, m);
    const lignes = await proprietaire((c) =>
      c.query("SELECT code FROM preuve_dimensions WHERE mission_id = $1 ORDER BY code", [m]),
    );
    const codes = lignes.rows.map((l) => l.code as string);
    expect(codes).toHaveLength(22);
    expect(new Set(codes).size).toBe(22);
    expect(codes).toContain("dd.pestel.politique");
    expect(codes).toContain("dd.risque.reglementaire");
    // La carte de triangulation du registre les couvre gratuitement.
    const carte = attendu(
      200,
      await s.consultantEquipe.get(`/api/missions/${m}/preuves/triangulation`),
    );
    expect(carte.dimensions.map((x: any) => x.code)).toContain("dd.swot.menaces");
  });
});

describe("validation du cadrage", () => {
  it("400 TAXONOMIE_INCONNUE : secteur, pays ou filière inconnus, filière d'un autre secteur", async () => {
    for (const extra of [
      { secteur_code: "citi_zz", filiere_code: null },
      { pays_code: "zz" },
      { filiere_code: "mines" },
      { filiere_code: "inconnue" },
    ]) {
      const r = await s.consultantEquipe.post(url(), { ...CADRAGE, ...extra });
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
      expect(r.json().erreur.code).toBe("TAXONOMIE_INCONNUE");
    }
  });

  it("400 : acquisition sans cible, devise, date hors bornes, champ inconnu", async () => {
    const mauvais = [
      { type_operation: "acquisition", cible_nom: null },
      { devise: "GBP" },
      { date_operation: "1999-12-31" },
      { type_operation: "fusion" },
      { titre: "" },
      { inconnu: "x" },
    ];
    for (const extra of mauvais) {
      const r = await s.consultantEquipe.post(url(), { ...CADRAGE, ...extra });
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
    }
    const ok = await s.consultantEquipe.post(url(), {
      ...CADRAGE,
      type_operation: "acquisition",
      cible_nom: "Cacao Export SA",
    });
    expect(ok.statusCode).toBe(201);
  });

  it("409 PLAFOND_ATTEINT au onzième dossier d'une mission", async () => {
    const m = await missionEquipee();
    for (let i = 0; i < 10; i += 1) await creerDossierDd(s.consultantEquipe, m);
    const r = await s.consultantEquipe.post(url(m), CADRAGE);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("PLAFOND_ATTEINT");
    expect(attendu(200, await s.consultantEquipe.get(url(m))).elements).toHaveLength(10);
  });
});

describe("versions du cadrage (R05, R06)", () => {
  it("une correction motivée crée la version 2 ; la version lue est exigée", async () => {
    const d = await creerDossierDd(s.consultantEquipe, s.missionId);
    const corps = {
      ...CADRAGE,
      titre: "Entrée corrigée",
      version_courante: 1,
      motif: "Précision du titre.",
    };
    const r = attendu(201, await s.a.chef.post(`/api/dd/dossiers/${d.id}/cadrage`, corps));
    expect(r.version).toBe(2);
    const perimee = await s.consultantEquipe.post(`/api/dd/dossiers/${d.id}/cadrage`, corps);
    expect(perimee.statusCode).toBe(409);
    expect(perimee.json().erreur.code).toBe("VERSION_PERIMEE");
    const versions = attendu(
      200,
      await s.expertMetier.get(`/api/dd/dossiers/${d.id}/cadrage/versions`),
    );
    expect(versions.elements.map((v: any) => v.version)).toEqual([2, 1]);
    expect(versions.elements[0]).toMatchObject({
      titre: "Entrée corrigée",
      motif: "Précision du titre.",
    });
    const fiche = attendu(200, await s.consultantEquipe.get(`/api/dd/dossiers/${d.id}`));
    expect(fiche.cadrage.titre).toBe("Entrée corrigée");
    expect(fiche.version_cadrage).toBe(2);
  });

  it("400 : motif absent, version_courante hors bornes, taxonomie inconnue", async () => {
    const d = await creerDossierDd(s.consultantEquipe, s.missionId);
    const chemin = `/api/dd/dossiers/${d.id}/cadrage`;
    expect(
      (await s.consultantEquipe.post(chemin, { ...CADRAGE, version_courante: 1 })).statusCode,
    ).toBe(400);
    expect(
      (await s.consultantEquipe.post(chemin, { ...CADRAGE, version_courante: 0, motif: "Motif." }))
        .statusCode,
    ).toBe(400);
    const r = await s.consultantEquipe.post(chemin, {
      ...CADRAGE,
      pays_code: "zz",
      version_courante: 1,
      motif: "Pays inconnu.",
    });
    expect(r.json().erreur.code).toBe("TAXONOMIE_INCONNUE");
  });

  it("l'expert métier (sans dd.ecrire) et un autre cabinet ne corrigent pas", async () => {
    const d = await creerDossierDd(s.consultantEquipe, s.missionId);
    const corps = { ...CADRAGE, version_courante: 1, motif: "Correction." };
    expect((await s.expertMetier.post(`/api/dd/dossiers/${d.id}/cadrage`, corps)).statusCode).toBe(
      403,
    );
    expect((await s.b.associe.post(`/api/dd/dossiers/${d.id}/cadrage`, corps)).statusCode).toBe(
      404,
    );
  });
});

describe("mission clôturée", () => {
  it("les écritures sont refusées (409 MISSION_CLOTUREE), la lecture reste ouverte", async () => {
    const m = await missionEquipee(true);
    const d = await creerDossierDd(s.consultantEquipe, m);
    await cloturerMission(s, m);
    const r = await s.consultantEquipe.post(url(m), CADRAGE);
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("MISSION_CLOTUREE");
    const c = await s.consultantEquipe.post(`/api/dd/dossiers/${d.id}/cadrage`, {
      ...CADRAGE,
      version_courante: 1,
      motif: "Correction.",
    });
    expect(c.statusCode).toBe(409);
    expect(c.json().erreur.code).toBe("MISSION_CLOTUREE");
    expect((await s.consultantEquipe.get(`/api/dd/dossiers/${d.id}`)).statusCode).toBe(200);
    expect((await s.consultantEquipe.get(url(m))).statusCode).toBe(200);
  });
});
