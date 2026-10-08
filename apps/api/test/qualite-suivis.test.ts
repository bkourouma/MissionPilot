import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ajouterElementsRevue } from "../src/qualite/revue.js";
import { api, cabinetTest, type Api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  attendre,
  elementsDeTest,
  insererRapport,
  ouvrir,
  preparerQualite,
  preuveDeTest,
  type ScenarioQualite,
} from "./qualite-outils.js";

/*
 * Qualité (QUA-01 à QUA-04, QUA-06) : ouverture et classe de risque, définition de terminé,
 * revue guidée (validation impossible sans parcours), gardes R1/R2/R3 jugées par le moteur,
 * signature avec empreinte, historiques en ajout seul.
 */

let ctx: Contexte;
let s: ScenarioQualite;
/** Preuve de la mission qui trace les chiffres déposés par les relecteurs. */
let preuveId: string;

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerQualite(ctx, "Cabinet Qualité");
  preuveId = await preuveDeTest(s);
});
afterAll(async () => {
  await ctx.fermer();
});

const detail = (par: Api, id: string) => par.get(`/api/qualite/suivis/${id}`).then((r) => r.json());

/** Parcourt tous les éléments d'un suivi pour l'utilisateur donné. */
async function parcourir(par: Api, suiviId: string) {
  const d = await detail(par, suiviId);
  for (const e of d.elements as { id: string }[]) {
    attendre(200, await par.post(`/api/qualite/suivis/${suiviId}/elements/${e.id}/vu`), "vu");
  }
}

describe("ouverture et classe de risque (QUA-01)", () => {
  it("exige une session et le droit qualite.relire", async () => {
    const corps = {
      mission_id: s.missionId,
      type_livrable: "autre",
      livrable_id: randomUUID(),
      libelle: "X",
    };
    expect((await api(ctx).post("/api/qualite/suivis", corps)).statusCode).toBe(401);
    expect((await s.consultant.post("/api/qualite/suivis", corps)).statusCode).toBe(403);
    expect((await api(ctx).get("/api/qualite/suivis")).statusCode).toBe(401);
  });

  it("ouvre un suivi à la classe minimale du type, jamais en dessous", async () => {
    const autre = await ouvrir(s.c.chef, s, { type_livrable: "autre" });
    expect(autre.statusCode).toBe(201);
    expect(autre.json().suivi).toMatchObject({
      classe: "R1",
      classe_minimale: "R1",
      statut: "brouillon",
    });

    const sous = await ouvrir(s.c.chef, s, { type_livrable: "etat", classe: "R2" });
    expect(sous.statusCode).toBe(409);
    expect(sous.json().erreur.code).toBe("CLASSE_SOUS_MINIMALE");

    const etat = await ouvrir(s.c.chef, s, { type_livrable: "etat" });
    expect(etat.json().suivi.classe).toBe("R3");
  });

  it("relève la classe sans jamais l'abaisser", async () => {
    const o = await ouvrir(s.c.chef, s, { type_livrable: "autre" });
    const id = o.json().suivi.id;
    const haut = await s.c.chef.post(`/api/qualite/suivis/${id}/classe`, {
      classe: "R3",
      motif: "Chiffres engageants",
    });
    expect(haut.statusCode).toBe(200);
    expect(haut.json().suivi.classe).toBe("R3");
    const bas = await s.c.chef.post(`/api/qualite/suivis/${id}/classe`, {
      classe: "R1",
      motif: "Test",
    });
    expect(bas.statusCode).toBe(409);
    expect(bas.json().erreur.code).toBe("CLASSE_ABAISSEE");
    // Même abaissée en base par un propriétaire, la classe ne descend pas (MPY02).
    await expect(
      proprietaire((db) => db.query("UPDATE qualite_suivis SET classe = 'R1' WHERE id = $1", [id])),
    ).rejects.toMatchObject({ code: "MPY02" });
  });

  it("refuse un double suivi de la même version et un livrable inconnu", async () => {
    const livrable = randomUUID();
    attendre(
      201,
      await ouvrir(s.c.chef, s, { type_livrable: "autre", livrable_id: livrable }),
      "1",
    );
    const double = await ouvrir(s.c.chef, s, { type_livrable: "autre", livrable_id: livrable });
    expect(double.statusCode).toBe(409);
    expect(double.json().erreur.code).toBe("SUIVI_EXISTANT");
    const suivante = await ouvrir(s.c.chef, s, {
      type_livrable: "autre",
      livrable_id: livrable,
      version: 2,
    });
    expect(suivante.statusCode).toBe(201);
    const inconnu = await ouvrir(s.c.chef, s, { type_livrable: "rapport" });
    expect(inconnu.statusCode).toBe(404);
  });

  it("ne sert qu'aux utilisateurs qui voient la mission (404 sinon)", async () => {
    const o = await ouvrir(s.c.chef, s, { type_livrable: "autre" });
    const id = o.json().suivi.id;
    expect((await s.etranger.get(`/api/qualite/suivis/${id}`)).statusCode).toBe(404);
    expect((await ouvrir(s.etranger, s, { type_livrable: "autre" })).statusCode).toBe(404);
    const liste = await s.etranger.get(`/api/qualite/suivis?mission_id=${s.missionId}`);
    expect(liste.json().elements).toHaveLength(0);
    const autreCabinet = await cabinetTest(ctx, "Autre cabinet");
    expect((await autreCabinet.associe.get(`/api/qualite/suivis/${id}`)).statusCode).toBe(404);
    const miens = await s.c.chef.get(`/api/qualite/suivis?mission_id=${s.missionId}`);
    expect(miens.json().elements.length).toBeGreaterThan(0);
  });
});

describe("rapport R2 : définition de terminé, revue guidée, garde, signature (QUA-02, 03, 06)", () => {
  let rapport: { id: string; sha256: string };
  let suiviId: string;

  beforeAll(async () => {
    rapport = await insererRapport(s, { auteurId: s.consultant.utilisateurId });
    const o = await ouvrir(s.c.chef, s, {
      type_livrable: "rapport",
      livrable_id: rapport.id,
      libelle: "Rapport de mission",
    });
    attendre(201, o, "ouverture");
    suiviId = o.json().suivi.id;
  });

  it("déduit l'auteur du module et applique la définition par défaut du type", async () => {
    const d = await detail(s.c.chef, suiviId);
    expect(d.suivi).toMatchObject({ classe: "R2", auteur_id: s.consultant.utilisateurId });
    expect(d.definition.items.map((i: { code: string }) => i.code)).toEqual([
      "rapport_enregistre",
      "rapport_valide",
      "chiffres_traces",
      "mention_ia",
    ]);
    expect(d.garde.etapes_requises).toEqual(["validation_consultant", "relecture_chef_mission"]);
  });

  it("refuse toute validation avant la vérification de la définition", async () => {
    const r = await s.consultant.post(`/api/qualite/suivis/${suiviId}/validations`, {
      etape: "validation_consultant",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("SUIVI_NON_EN_REVUE");
  });

  it("vérifie par du code, passe en revue, et demande l'attestation de ce qui ne se contrôle pas", async () => {
    const r = await s.c.chef.post(`/api/qualite/suivis/${suiviId}/verification`);
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.suivi.statut).toBe("en_revue");
    const parCode = Object.fromEntries(
      d.definition.items.map((i: { code: string; statut: string }) => [i.code, i.statut]),
    );
    expect(parCode).toMatchObject({
      rapport_enregistre: "conforme",
      rapport_valide: "conforme",
      chiffres_traces: "non_evaluable",
      mention_ia: "en_attente",
    });
    expect(d.definition.satisfaite).toBe(false);
  });

  it("refuse la validation tant que la définition n'est pas satisfaite", async () => {
    const r = await s.consultant.post(`/api/qualite/suivis/${suiviId}/validations`, {
      etape: "validation_consultant",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("DEFINITION_NON_SATISFAITE");
  });

  it("dépose les éléments de revue (chiffre sans source : non conforme) puis la source corrige", async () => {
    await s.c.chef.post(`/api/qualite/suivis/${suiviId}/elements`, {
      elements: [
        { cle: "a1", kind: "assertion_fragile", libelle: "Le marché croît de 20 % par an" },
        { cle: "c1", kind: "chiffre", libelle: "Marge 2025" },
        { cle: "r1", kind: "recommandation", libelle: "Ouvrir un second site" },
      ],
    });
    const v = await s.c.chef.post(`/api/qualite/suivis/${suiviId}/verification`);
    const chiffres = v
      .json()
      .definition.items.find((i: { code: string }) => i.code === "chiffres_traces");
    expect(chiffres.statut).toBe("non_conforme");
    // Une clé déjà déposée est ignorée ; l'ordre du parcours est : assertions, chiffres, recommandations.
    const d = await detail(s.c.chef, suiviId);
    expect(d.elements.map((e: { kind: string }) => e.kind)).toEqual([
      "assertion_fragile",
      "chiffre",
      "recommandation",
    ]);
    // Le chiffre sans source ne s'atteste pas : il se corrige dans le livrable.
    const att = await s.c.chef.post(
      `/api/qualite/suivis/${suiviId}/verification/${chiffres.id}/attestation`,
      { commentaire: "Je passe outre" },
    );
    expect(att.statusCode).toBe(409);
  });

  it("service interne ajouterElementsRevue : idempotent, source tracée", async () => {
    const r = await ctx.db.withTenant(s.c.cabinetId, (db) =>
      ajouterElementsRevue(db, s.c.cabinetId, null, { type: "rapport", livrableId: rapport.id }, [
        { cle: "c1", kind: "chiffre", libelle: "Marge 2025 (doublon)" },
        { cle: "c2", kind: "chiffre", libelle: "CA 2025", source: "Moteur finance", ordre: 2 },
      ]),
    );
    expect(r).toMatchObject({ suivi_id: suiviId, ajoutes: 1, ignores: 1 });
  });

  it("le chiffre sans source reste bloquant ; la définition ne se satisfait pas par l'IA ni par défaut", async () => {
    const v = await s.c.chef.post(`/api/qualite/suivis/${suiviId}/verification`);
    expect(v.json().definition.bloquants).toContain("chiffres_traces");
  });

  it("valide après correction, attestation, parcours complet de chaque relecteur", async () => {
    // Parcours nominal sur un second suivi propre (le premier garde un chiffre sans source).
    const rapport2 = await insererRapport(s, { auteurId: s.consultant.utilisateurId });
    const o = await ouvrir(s.c.chef, s, { type_livrable: "rapport", livrable_id: rapport2.id });
    const id = o.json().suivi.id as string;
    attendre(200, await s.c.chef.post(`/api/qualite/suivis/${id}/verification`), "verification");
    await elementsDeTest(s.c.chef, id, preuveId, 2);
    const v = await s.c.chef.post(`/api/qualite/suivis/${id}/verification`);
    const items = v.json().definition.items as { id: string; code: string; statut: string }[];
    expect(items.find((i) => i.code === "chiffres_traces")?.statut).toBe("conforme");
    const mention = items.find((i) => i.code === "mention_ia")!;
    // Attestation motivée obligatoire.
    expect(
      (
        await s.c.chef.post(`/api/qualite/suivis/${id}/verification/${mention.id}/attestation`, {
          commentaire: " ",
        })
      ).statusCode,
    ).toBe(400);
    attendre(
      200,
      await s.c.chef.post(`/api/qualite/suivis/${id}/verification/${mention.id}/attestation`, {
        commentaire: "Mention vérifiée en pied de page",
      }),
      "attestation",
    );

    // Sans parcours : 409 PARCOURS_INCOMPLET, avec le nombre d'éléments restants.
    const sans = await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_consultant",
    });
    expect(sans.statusCode).toBe(409);
    expect(sans.json().erreur.code).toBe("PARCOURS_INCOMPLET");
    // Le parcours d'un AUTRE relecteur ne dispense pas.
    await parcourir(s.c.chef, id);
    const encore = await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_consultant",
    });
    expect(encore.json().erreur.code).toBe("PARCOURS_INCOMPLET");

    await parcourir(s.consultant, id);
    const ok = await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_consultant",
      commentaire: "Relu intégralement",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().suivi.statut).toBe("en_revue");
    expect(ok.json().garde.prochaine_etape).toBe("relecture_chef_mission");

    // Étape hors ordre et double validation.
    const hors = await s.c.directeur.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "revue_second_expert",
    });
    expect(hors.statusCode).toBe(409);
    // Le consultant n'a pas qualite.relire : la relecture du chef lui est interdite.
    expect(
      (
        await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
          etape: "relecture_chef_mission",
        })
      ).statusCode,
    ).toBe(403);

    const chef = await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "relecture_chef_mission",
    });
    expect(chef.statusCode).toBe(200);
    expect(chef.json().suivi.statut).toBe("valide");
    expect(chef.json().validations.map((x: { etape: string }) => x.etape)).toEqual([
      "validation_consultant",
      "relecture_chef_mission",
    ]);

    // Signature par le directeur de la mission : empreinte du contenu (somme du fichier).
    expect((await s.c.chef.post(`/api/qualite/suivis/${id}/signature`, {})).statusCode).toBe(403);
    // Le signataire parcourt lui aussi tous les éléments obligatoires.
    const sansParcours = await s.c.directeur.post(`/api/qualite/suivis/${id}/signature`, {});
    expect(sansParcours.json().erreur.code).toBe("PARCOURS_INCOMPLET");
    await parcourir(s.c.directeur, id);
    const sig = await s.c.directeur.post(`/api/qualite/suivis/${id}/signature`, {});
    expect(sig.statusCode).toBe(200);
    const fin = sig.json();
    expect(fin.suivi.statut).toBe("signe");
    expect(fin.signature).toMatchObject({
      qualite: "directeur_mission",
      version: 1,
      portee_empreinte: "contenu",
      signataire_id: s.c.directeur.utilisateurId,
    });
    expect(fin.signature.empreinte_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Mention de contribution IA : politique du cabinet (active par défaut).
    expect(fin.signature.mention_ia).toContain("MissionPilot");

    // Plus rien ne bouge sur un livrable signé.
    expect((await s.c.directeur.post(`/api/qualite/suivis/${id}/signature`, {})).statusCode).toBe(
      409,
    );
    expect(
      (
        await s.c.chef.post(`/api/qualite/suivis/${id}/elements`, {
          elements: [{ cle: "z", kind: "chiffre", libelle: "Z" }],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await s.c.chef.post(`/api/qualite/suivis/${id}/classe`, {
          classe: "R3",
          motif: "trop tard",
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe("rapport non validé : la définition de terminé bloque (QUA-02)", () => {
  it("signale le statut du contenu source comme non conforme", async () => {
    const brouillon = await insererRapport(s, {
      statut: "brouillon",
      auteurId: s.consultant.utilisateurId,
    });
    const o = await ouvrir(s.c.chef, s, { type_livrable: "rapport", livrable_id: brouillon.id });
    const v = await s.c.chef.post(`/api/qualite/suivis/${o.json().suivi.id}/verification`);
    const item = v
      .json()
      .definition.items.find((i: { code: string }) => i.code === "rapport_valide");
    expect(item.statut).toBe("non_conforme");
    expect(item.detail).toContain("brouillon");
  });
});

describe("classe R3 : quatre yeux et signature du directeur (QUA-04)", () => {
  async function suiviR3(auteurId: string | null) {
    const o = await ouvrir(s.c.chef, s, { type_livrable: "etat", auteur_id: auteurId });
    attendre(201, o, "ouverture R3");
    const id = o.json().suivi.id as string;
    attendre(200, await s.c.chef.post(`/api/qualite/suivis/${id}/verification`), "verification");
    attendre(
      200,
      await s.c.chef.post(`/api/qualite/suivis/${id}/elements`, {
        elements: [{ cle: "c1", kind: "chiffre", libelle: "Résultat net", preuve_id: preuveId }],
      }),
      "éléments R3",
    );
    const v = await s.c.chef.post(`/api/qualite/suivis/${id}/verification`);
    for (const i of v.json().definition.items as {
      id: string;
      controle: string;
      statut: string;
    }[]) {
      if (i.statut === "non_evaluable" || i.controle === "manuel") {
        attendre(
          200,
          await s.c.chef.post(`/api/qualite/suivis/${id}/verification/${i.id}/attestation`, {
            commentaire: "Fait",
          }),
          "attestation",
        );
      }
    }
    return id;
  }

  it("refuse le cumul du relecteur et du second expert (409 GARDE_VIOLEE avec violations)", async () => {
    const id = await suiviR3(s.consultant.utilisateurId);
    for (const par of [s.c.chef, s.consultant, s.expert, s.c.directeur]) await parcourir(par, id);
    attendre(
      200,
      await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
        etape: "validation_consultant",
      }),
      "c",
    );
    attendre(
      200,
      await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
        etape: "relecture_chef_mission",
      }),
      "h",
    );
    const cumul = await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "revue_second_expert",
    });
    expect(cumul.statusCode).toBe(409);
    expect(cumul.json().erreur.code).toBe("GARDE_VIOLEE");
    expect(cumul.json().erreur.details.violations[0]).toMatchObject({ code: "CUMUL_INTERDIT" });
    // La validation refusée n'a rien enregistré.
    expect((await detail(s.c.chef, id)).validations).toHaveLength(2);
  });

  it("exige un second expert distinct, puis la signature du directeur de mission", async () => {
    const id = await suiviR3(s.consultant.utilisateurId);
    for (const par of [s.c.chef, s.consultant, s.expert, s.c.directeur]) await parcourir(par, id);
    await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_consultant",
    });
    await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "relecture_chef_mission",
    });
    const second = await s.expert.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "revue_second_expert",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().suivi.statut).toBe("valide");
    // Signature : le directeur n'a pas fait d'étape, la garde est complète.
    const sig = await s.c.directeur.post(`/api/qualite/suivis/${id}/signature`, {
      commentaire: "Bon pour envoi",
    });
    expect(sig.statusCode).toBe(200);
    const fin = sig.json();
    expect(fin.suivi.statut).toBe("signe");
    expect(fin.validations.map((v: { etape: string }) => v.etape)).toContain(
      "signature_directeur_mission",
    );
    expect(fin.signature.portee_empreinte).toBe("dossier_qualite");
  });

  it("refuse l'auteur comme second expert (quatre yeux)", async () => {
    const id = await suiviR3(s.expert.utilisateurId);
    for (const par of [s.c.chef, s.expert]) await parcourir(par, id);
    attendre(
      200,
      await s.expert.post(`/api/qualite/suivis/${id}/validations`, {
        etape: "validation_consultant",
      }),
      "auteur valide",
    );
    await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "relecture_chef_mission",
    });
    const r = await s.expert.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "revue_second_expert",
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.details.violations.map((v: { code: string }) => v.code)).toContain(
      "QUATRE_YEUX",
    );
  });

  it("n'accepte la signature que du directeur de la mission ou d'un associé", async () => {
    const id = await suiviR3(null);
    for (const par of [s.c.chef, s.consultant, s.expert, s.c.directeur, s.c.associe])
      await parcourir(par, id);
    await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_consultant",
    });
    await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "relecture_chef_mission",
    });
    await s.expert.post(`/api/qualite/suivis/${id}/validations`, { etape: "revue_second_expert" });
    const autreDirecteur = await s.c.avecRoles(["directeur_mission"]);
    expect((await autreDirecteur.post(`/api/qualite/suivis/${id}/signature`, {})).statusCode).toBe(
      403,
    );
    expect((await s.expert.post(`/api/qualite/suivis/${id}/signature`, {})).statusCode).toBe(403);
    expect((await s.c.associe.post(`/api/qualite/suivis/${id}/signature`, {})).statusCode).toBe(
      200,
    );
  });

  it("refuse de signer un livrable non validé", async () => {
    const id = await suiviR3(null);
    const r = await s.c.directeur.post(`/api/qualite/suivis/${id}/signature`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().erreur.code).toBe("SUIVI_NON_VALIDE");
  });
});

describe("classe R1 : validation de l'auteur", () => {
  it("seul l'auteur valide ; sans élément à parcourir, la validation passe", async () => {
    const o = await ouvrir(s.c.chef, s, {
      type_livrable: "autre",
      auteur_id: s.consultant.utilisateurId,
    });
    const id = o.json().suivi.id as string;
    attendre(200, await s.c.chef.post(`/api/qualite/suivis/${id}/verification`), "verification");
    const autre = await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_auteur",
    });
    expect(autre.statusCode).toBe(409);
    expect(autre.json().erreur.details.violations[0].code).toBe("AUTEUR_ATTENDU");
    const ok = await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_auteur",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().suivi.statut).toBe("valide");
    // R1 : pas de signature (livrable interne).
    expect((await s.c.directeur.post(`/api/qualite/suivis/${id}/signature`, {})).statusCode).toBe(
      409,
    );
  });

  it("rejette une étape que la classe n'exige pas", async () => {
    const o = await ouvrir(s.c.chef, s, { type_livrable: "autre" });
    const id = o.json().suivi.id as string;
    await s.c.chef.post(`/api/qualite/suivis/${id}/verification`);
    const r = await s.c.chef.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "relecture_chef_mission",
    });
    expect(r.statusCode).toBe(409);
  });
});

describe("temps de revue (QUA-03)", () => {
  it("mesure des sessions, une seule ouverte par relecteur", async () => {
    const o = await ouvrir(s.c.chef, s, { type_livrable: "autre" });
    const id = o.json().suivi.id as string;
    expect((await s.c.chef.post(`/api/qualite/suivis/${id}/sessions`)).statusCode).toBe(409);
    await s.c.chef.post(`/api/qualite/suivis/${id}/verification`);
    const a = await s.c.chef.post(`/api/qualite/suivis/${id}/sessions`);
    expect(a.statusCode).toBe(200);
    const b = await s.c.chef.post(`/api/qualite/suivis/${id}/sessions`);
    expect(b.json().session.id).toBe(a.json().session.id);
    // Le temps d'une autre personne n'est pas clôturable par un tiers.
    expect(
      (await s.consultant.post(`/api/qualite/sessions/${a.json().session.id}/terminer`)).statusCode,
    ).toBe(404);
    const t = await s.c.chef.post(`/api/qualite/sessions/${a.json().session.id}/terminer`);
    expect(t.statusCode).toBe(200);
    expect(t.json().temps_revue.synthese.sessions).toBe(1);
    expect(t.json().session.duree_secondes).toBeGreaterThanOrEqual(0);
    expect(
      (await s.c.chef.post(`/api/qualite/sessions/${a.json().session.id}/terminer`)).statusCode,
    ).toBe(409);
  });
});

describe("historiques en ajout seul", () => {
  it("refuse la modification et la suppression, même au propriétaire", async () => {
    const o = await ouvrir(s.c.chef, s, {
      type_livrable: "autre",
      auteur_id: s.consultant.utilisateurId,
    });
    const id = o.json().suivi.id as string;
    await s.c.chef.post(`/api/qualite/suivis/${id}/verification`);
    await s.consultant.post(`/api/qualite/suivis/${id}/validations`, {
      etape: "validation_auteur",
    });
    await expect(
      proprietaire((db) =>
        db.query(
          "UPDATE qualite_validations SET etape = 'revue_second_expert' WHERE suivi_id = $1",
          [id],
        ),
      ),
    ).rejects.toMatchObject({ code: "MPY01" });
    await expect(
      proprietaire((db) => db.query("DELETE FROM qualite_evenements WHERE suivi_id = $1", [id])),
    ).rejects.toMatchObject({ code: "MPY01" });
    await expect(
      proprietaire((db) => db.query("DELETE FROM qualite_suivis WHERE id = $1", [id])),
    ).rejects.toMatchObject({ code: "MPY02" });
    // Le statut ne recule pas.
    await expect(
      proprietaire((db) =>
        db.query("UPDATE qualite_suivis SET statut = 'brouillon' WHERE id = $1", [id]),
      ),
    ).rejects.toMatchObject({ code: "MPY02" });
  });

  it("l'API n'ouvre pas de route au portail (liste blanche fermée) et journalise", async () => {
    const o = await ouvrir(s.c.chef, s, { type_livrable: "autre" });
    const id = o.json().suivi.id as string;
    const n = await ctx.db.withTenant(s.c.cabinetId, async (db) => {
      const r = await db.query(
        "SELECT action FROM journal_audit WHERE entite = 'qualite_suivi' AND entite_id = $1",
        [id],
      );
      return r.rows.map((l) => l.action);
    });
    expect(n).toContain("qualite.suivi.ouvrir");
  });
});
