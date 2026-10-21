import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CAUSE_DESCRIPTION_MAX,
  CAUSE_LIBELLE_MAX,
  CAUSES_MAX,
  DOMAINES_URGENCE,
  NIVEAUX_CONFIANCE_CAUSE,
} from "@missionpilot/engines";
import {
  RED_CAUSE_DESCRIPTION_MAX,
  RED_CAUSE_LIBELLE_MAX,
  RED_CAUSES_MAX,
  RED_DOMAINES,
  RED_NIVEAUX_CONFIANCE_CAUSE,
  RED_STATUTS_CONTENU_CAUSES,
} from "@missionpilot/shared";
import { causesDepuisSortie } from "../src/ia/prompts/gabarits/redressement-causes.js";
import { causesValidees } from "../src/redressement/causes.js";
import { api, type Api } from "./api.js";
import { proprietaire } from "./helpers.js";
import { inviterClient } from "./portail-outils.js";
import { attendre } from "./portail-outils.js";
import {
  activerIa,
  auditDe,
  modele,
  nouveauDossier,
  preparerCauses,
  refusSql,
  REPONSE_MODELE,
  type ScenarioCauses,
} from "./redressement-causes-outils.js";
import { erreur, INCONNU } from "./redressement-outils.js";

/*
 * Causes racines proposées par l'IA (RED-04) : brouillon IA relu, modifié puis validé par un
 * consultant avant tout usage dans un livrable. Modèle simulé local (aucun appel réseau externe) :
 * génération, repli déterministe, modification, validation (séparation des tâches, acquittement
 * des nombres), garde de la base (MPZ03, MPZ07, MPZ10, MPZ13, MPZ14), droits, isolation entre
 * cabinets, garde-chiffres et journal d'audit sans contenu.
 */

let sc: ScenarioCauses;
let dossierId: string;
let dossierVide: string;
let chef2: Api & { utilisateurId: string };

const s = () => sc.s;
const urlD = (suffixe = "", id = dossierId) => `/api/redressement/dossiers/${id}/causes${suffixe}`;
const urlC = (id: string, suffixe = "") => `/api/redressement/causes/${id}${suffixe}`;

type Cause = { domaine: string; libelle: string; description: string; confiance?: string };
const cause = (extra: Partial<Cause> = {}): Cause => ({
  domaine: "tresorerie",
  libelle: "Encaissements tardifs",
  description: "Hypothèse à confirmer avec le client.",
  ...extra,
});

async function generer(par: Api, corps: Record<string, unknown> = {}, id = dossierId) {
  const r = await par.post(urlD("/generation", id), corps);
  attendre(201, r, "génération");
  return r.json();
}

beforeAll(async () => {
  sc = await preparerCauses();
  dossierId = sc.dossierId;
  dossierVide = await nouveauDossier(s(), false);
  // Second chef de mission de l'équipe : répartit les propositions (débit par utilisateur).
  chef2 = await s().a.avecRoles(["chef_mission"]);
  attendre(
    201,
    await s().a.chef.post(`/api/missions/${s().missionId}/equipe`, {
      utilisateur_id: chef2.utilisateurId,
    }),
    "équipe",
  );
}, 180_000);

afterAll(async () => {
  await sc.ctx.fermer();
  await sc.serveur.fermer();
});

describe("repli déterministe (IA désactivée par le cabinet)", () => {
  it("produit un brouillon IA, version 1, rang 1, sans appel au modèle", async () => {
    const avant = sc.serveur.requetes.length;
    const v = await generer(s().consultantEquipe);
    expect(sc.serveur.requetes.length).toBe(avant);
    expect(v).toMatchObject({
      version: 1,
      statut: "brouillon",
      statut_contenu: "brouillon_ia",
      exploitable_livrable: false,
      gabarit: true,
      chiffres_non_verifies: false,
      nombres_non_verifies: [],
      valide_par: null,
    });
    expect(v.historique).toHaveLength(1);
    expect(v.historique[0]).toMatchObject({ rang: 1, statut_contenu: "brouillon_ia" });
    expect(v.historique[0].auteur.id).toBe(s().consultantEquipe.utilisateurId);
    expect(v.causes[0]).toMatchObject({ id: "c01", domaine: "tresorerie", confiance: "moyen" });
    expect(v.causes[0].description).toContain("Hypothèse à confirmer par le consultant");
    // Jamais de nombre fabriqué hors des moteurs dans un repli.
    expect(JSON.stringify(v.causes).replace(/"id":"c\d\d"/g, "")).not.toMatch(/\d/);
  });

  it("est déterministe : même diagnostic, mêmes causes ; versions consécutives", async () => {
    const [a] = (await s().a.chef.get(urlD())).json().elements.slice(-1);
    const b = await generer(s().a.chef);
    expect(b.version).toBe(2);
    expect(b.causes).toEqual(a.causes);
  });

  it("sans aucune donnée de diagnostic : 409 avant tout appel", async () => {
    const r = await s().a.chef.post(urlD("/generation", dossierVide), {});
    expect(r.statusCode).toBe(409);
    expect(erreur(r)).toBe("RED_CAUSES_SANS_DIAGNOSTIC");
  });

  it("débit par utilisateur : 429 à la onzième proposition en dix minutes", async () => {
    const dossier = await nouveauDossier(s(), true);
    const associe = await s().a.avecRoles(["associe"]);
    for (let i = 0; i < 10; i += 1) await generer(associe, {}, dossier);
    const r = await associe.post(urlD("/generation", dossier), {});
    expect(r.statusCode).toBe(429);
    expect(erreur(r)).toBe("RED_TROP_DE_PROPOSITIONS_CAUSES");
  }, 120_000);

  it("plafond de volume : 30 cartographies par dossier (409 API, MPZ10 en base)", async () => {
    const dossier = await nouveauDossier(s(), true);
    await generer(s().a.chef, {}, dossier);
    const inserer = (q: (sql: string, p?: unknown[]) => Promise<unknown>) =>
      q(
        `INSERT INTO red_causes_versions (cabinet_id, dossier_id, version, contenu, gabarit, demande_id, cree_par)
         SELECT v.cabinet_id, v.dossier_id, (SELECT max(version) + 1 FROM red_causes_versions WHERE dossier_id = v.dossier_id),
                v.contenu, v.gabarit, v.demande_id, v.cree_par
         FROM red_causes_versions v WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT 1`,
        [dossier],
      );
    await proprietaire(async (c) => {
      for (let i = 0; i < 29; i += 1) {
        await c.query(
          `INSERT INTO red_causes_versions (cabinet_id, dossier_id, version, contenu, gabarit, demande_id, cree_par)
           SELECT v.cabinet_id, v.dossier_id, (SELECT max(version) + 1 FROM red_causes_versions WHERE dossier_id = v.dossier_id),
                  v.contenu, v.gabarit, v.demande_id, v.cree_par
           FROM red_causes_versions v WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT 1`,
          [dossier],
        );
      }
    });
    const parChef = await s().a.chef.post(urlD("/generation", dossier), {});
    expect(parChef.statusCode).toBe(409);
    expect(erreur(parChef)).toBe("RED_PLAFOND_ATTEINT");
    expect(await refusSql(async (q) => void (await inserer(q)))).toBe("MPZ10");
  }, 120_000);
});

describe("droits, isolation et portail", () => {
  let versionId: string;

  beforeAll(async () => {
    versionId = (await s().a.chef.get(urlD())).json().elements[0].id as string;
  });

  const corpsModif = () => ({ causes: [cause()] });

  it("401 sans session sur les quatre routes", async () => {
    const anonyme = api(sc.ctx);
    expect((await anonyme.get(urlD())).statusCode).toBe(401);
    expect((await anonyme.post(urlD("/generation"), {})).statusCode).toBe(401);
    expect((await anonyme.patch(urlC(versionId), corpsModif())).statusCode).toBe(401);
    expect((await anonyme.post(urlC(versionId, "/validation"), {})).statusCode).toBe(401);
  });

  it("403 pour le gestionnaire, les ressources et l'expert externe ; l'expert (lecture seule) n'écrit pas", async () => {
    for (const u of [s().gestionnaire, s().ressources, s().expertExterne]) {
      expect((await u.get(urlD())).statusCode).toBe(403);
      expect((await u.post(urlD("/generation"), {})).statusCode).toBe(403);
      expect((await u.patch(urlC(versionId), corpsModif())).statusCode).toBe(403);
      expect((await u.post(urlC(versionId, "/validation"), {})).statusCode).toBe(403);
    }
    expect((await s().a.associe.get(urlD())).statusCode).toBe(200);
    expect((await s().expert.post(urlD("/generation"), {})).statusCode).toBe(403);
    expect((await s().expert.patch(urlC(versionId), corpsModif())).statusCode).toBe(403);
    expect((await s().expert.post(urlC(versionId, "/validation"), {})).statusCode).toBe(403);
  });

  it("404 : consultant hors équipe, dossier ou cartographie inconnus, autre cabinet", async () => {
    const hors = s().consultantHors;
    expect((await hors.get(urlD())).statusCode).toBe(404);
    expect((await hors.post(urlD("/generation"), {})).statusCode).toBe(404);
    expect((await hors.patch(urlC(versionId), corpsModif())).statusCode).toBe(404);
    expect((await hors.post(urlC(versionId, "/validation"), {})).statusCode).toBe(404);
    const b = s().b.associe;
    expect((await b.get(urlD())).statusCode).toBe(404);
    expect((await b.post(urlD("/generation"), {})).statusCode).toBe(404);
    expect((await b.patch(urlC(versionId), corpsModif())).statusCode).toBe(404);
    expect((await b.post(urlC(versionId, "/validation"), {})).statusCode).toBe(404);
    expect((await s().a.chef.get(urlD("", INCONNU))).statusCode).toBe(404);
    expect((await s().a.chef.post(urlD("/generation", INCONNU), {})).statusCode).toBe(404);
    expect((await s().a.chef.patch(urlC(INCONNU), corpsModif())).statusCode).toBe(404);
    expect((await s().a.chef.post(urlC(INCONNU, "/validation"), {})).statusCode).toBe(404);
  });

  it("isolation : le cabinet B ne voit aucune cartographie du cabinet A", async () => {
    const dossierB = (
      await s().b.chef.post(`/api/missions/${s().missionB}/redressement`, { intitule: "Dossier B" })
    ).json().id as string;
    const liste = await s().b.chef.get(urlD("", dossierB));
    expect(liste.statusCode).toBe(200);
    expect(liste.json().elements).toEqual([]);
    const tout = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM red_causes_versions WHERE cabinet_id = $1",
            [s().b.cabinetId],
          )
        ).rows[0].n,
    );
    expect(tout).toBe(0);
  });

  it("le portail client n'a aucune de ces routes (403 PORTAIL_ROUTE_INTERDITE)", async () => {
    const dirigeant = await inviterClient(sc.ctx, s().a.associe, s().a.clientId, [
      "client_dirigeant",
    ]);
    for (const rep of [
      await dirigeant.get(urlD()),
      await dirigeant.post(urlD("/generation"), {}),
      await dirigeant.patch(urlC(versionId), corpsModif()),
      await dirigeant.post(urlC(versionId, "/validation"), {}),
    ]) {
      expect(rep.statusCode).toBe(403);
      expect(erreur(rep)).toBe("PORTAIL_ROUTE_INTERDITE");
    }
  });

  it("entrées invalides : 400", async () => {
    const chef = s().a.chef;
    expect((await chef.post(urlD("/generation"), { contexte: "" })).statusCode).toBe(400);
    expect((await chef.post(urlD("/generation"), { chiffres: [1] })).statusCode).toBe(400);
    for (const corps of [
      { causes: [] },
      { causes: [cause({ domaine: "juridique" })] },
      { causes: [cause({ confiance: "80" })] },
      { causes: [cause(), cause()] },
      { causes: [cause()], extra: 1 },
      { causes: [{ ...cause(), id: "x" }] },
    ]) {
      expect((await chef.patch(urlC(versionId), corps)).statusCode, JSON.stringify(corps)).toBe(
        400,
      );
    }
    expect(
      (await chef.post(urlC(versionId, "/validation"), { acquitte_chiffres: "oui" })).statusCode,
    ).toBe(400);
  });
});

describe("génération par le modèle simulé, modification et validation", () => {
  beforeAll(async () => {
    await activerIa(s());
  });

  it("construit les causes depuis les lignes du modèle ; masque les données ; chiffres de la liste blanche", async () => {
    sc.serveur.repondre(() => modele(REPONSE_MODELE));
    const avant = sc.serveur.requetes.length;
    const v = await generer(chef2, {
      contexte: "Le dirigeant Awa Koné de la société Kora Industrie a perdu un marché important.",
      termes_sensibles: ["Awa Koné", "Kora Industrie"],
    });
    expect(sc.serveur.requetes.length).toBe(avant + 1);
    const envoye = JSON.stringify(sc.serveur.requetes[avant]?.corps.messages);
    expect(envoye).not.toContain("Awa Koné");
    expect(envoye).not.toContain("Kora Industrie");
    expect(envoye).toContain("perdu un marché");
    // Les chiffres autorisés sont ceux du moteur (voyants d'urgence), jamais ceux d'une requête.
    expect(envoye).toContain("63");
    expect(v).toMatchObject({
      statut: "brouillon",
      statut_contenu: "brouillon_ia",
      gabarit: false,
      chiffres_non_verifies: false,
    });
    expect(v.causes.map((c: Cause) => c.domaine)).toEqual([
      "tresorerie",
      "activite",
      "exploitation",
    ]);
    expect(v.causes.map((c: Cause & { id: string }) => c.id)).toEqual(["c01", "c02", "c03"]);
    expect(v.causes.map((c: Cause) => c.confiance)).toEqual(["moyen", "faible", null]);
    expect(v.historique).toHaveLength(1);
  });

  it("le consultant ne peut pas exiger de chiffres : la liste blanche ne vient jamais de la requête", async () => {
    const r = await s().a.chef.post(urlD("/generation"), {
      contexte: "x",
      contexte_chiffres: [{ libelle: "Faux", valeur: 47 }],
    });
    expect(r.statusCode).toBe(400);
  });

  it("sortie inexploitable : repli déterministe signalé", async () => {
    sc.serveur.repondre(() => ({ contenu: "Voici des causes en prose, sans JSON." }));
    expect((await generer(s().a.chef)).gabarit).toBe(true);
    sc.serveur.repondre(() => modele({ causes: ["tresorerie | Une seule | Une seule cause. |"] }));
    expect((await generer(s().a.chef)).gabarit).toBe(true);
    sc.serveur.repondre(() => modele({ causes: ["juridique | X | Domaine inconnu. |", "x"] }));
    expect((await generer(s().a.chef)).gabarit).toBe(true);
  });

  it("circuit humain : brouillon IA, modifié, validé ; séparation des tâches ; historique d'ajout seul", async () => {
    sc.serveur.repondre(() => modele(REPONSE_MODELE));
    const g = await generer(chef2);
    const id = g.id as string;

    // Le demandeur ne valide pas sa propre proposition.
    expect(
      await sc.ctx.db.withTenant(s().a.cabinetId, (db) => causesValidees(db, dossierId)),
    ).toBeNull();
    const soi = await chef2.post(urlC(id, "/validation"), {});
    expect(soi.statusCode).toBe(403);
    expect(erreur(soi)).toBe("APPROBATION_REQUISE");

    // Retouche par un autre consultant : statut « modifié », rang 2.
    const m = await s().consultantEquipe.patch(urlC(id), {
      causes: [
        { id: "c01", ...cause({ libelle: "Encaissements clients tardifs", confiance: "eleve" }) },
        {
          domaine: "social",
          libelle: "Départ d'un cadre clé",
          description: "À confirmer en entretien.",
        },
      ],
    });
    attendre(200, m, "modification");
    expect(m.json()).toMatchObject({ statut: "brouillon", statut_contenu: "modifie" });
    expect(m.json().causes.map((c: { id: string }) => c.id)).toEqual(["c01", "c02"]);
    expect(m.json().historique.map((x: { statut_contenu: string }) => x.statut_contenu)).toEqual([
      "brouillon_ia",
      "modifie",
    ]);
    expect(m.json().historique[1].auteur.id).toBe(s().consultantEquipe.utilisateurId);

    // Ni le demandeur ni l'auteur d'une retouche ne valident ; l'expert (lecture seule) non plus.
    expect((await s().consultantEquipe.post(urlC(id, "/validation"), {})).statusCode).toBe(403);
    expect((await chef2.post(urlC(id, "/validation"), {})).statusCode).toBe(403);
    expect((await s().expert.post(urlC(id, "/validation"), {})).statusCode).toBe(403);

    // Rien n'est exploitable avant la validation.
    const avantValidation = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM red_causes_versions WHERE id = $1 AND statut = 'valide'",
            [id],
          )
        ).rows[0].n,
    );
    expect(avantValidation).toBe(0);

    // L'associé (dispensé de la règle « pas l'auteur ») valide.
    const ok = await s().a.associe.post(urlC(id, "/validation"), {});
    attendre(200, ok, "validation");
    expect(ok.json()).toMatchObject({
      statut: "valide",
      statut_contenu: "valide",
      exploitable_livrable: true,
    });
    expect(ok.json().valide_par.id).toBe(s().a.associeId);
    expect(ok.json().historique.map((x: { rang: number }) => x.rang)).toEqual([1, 2, 3]);

    // Figée : plus de modification ni de nouvelle validation.
    expect((await s().consultantEquipe.patch(urlC(id), { causes: [cause()] })).statusCode).toBe(
      409,
    );
    expect(erreur(await s().a.associe.post(urlC(id, "/validation"), {}))).toBe(
      "RED_CAUSES_VALIDEES",
    );

    // La liste rend le statut et l'historique ; la dernière cartographie validée est exposée.
    const liste = (await s().a.associe.get(urlD())).json().elements as {
      id: string;
      version: number;
    }[];
    expect(liste.map((x) => x.version)).toEqual(
      [...liste.map((x) => x.version)].sort((a, b) => b - a),
    );
    expect(liste.find((x) => x.id === id)).toBeTruthy();
    const validee = await sc.ctx.db.withTenant(s().a.cabinetId, (db) =>
      causesValidees(db, dossierId),
    );
    expect(validee?.id).toBe(id);
    expect(validee?.causes).toHaveLength(2);
    expect(
      await sc.ctx.db.withTenant(s().a.cabinetId, (db) => causesValidees(db, dossierVide)),
    ).toBeNull();
  });

  it("un valideur qui n'est pas associé et n'a aucun rang peut valider", async () => {
    sc.serveur.repondre(() => modele(REPONSE_MODELE));
    const g = await generer(s().consultantEquipe);
    const ok = await s().a.chef.post(urlC(g.id, "/validation"), {});
    attendre(200, ok, "validation par le chef");
    expect(ok.json().valide_par.id).toBe(s().a.chef.utilisateurId);
  });

  it("garde-chiffres : un nombre hors liste blanche marque la cartographie, acquittement exigé", async () => {
    sc.serveur.repondre(() =>
      modele({
        causes: [
          ...REPONSE_MODELE.causes,
          "financement | Dette bancaire | Un retard de 47 jours sur les remboursements est évoqué. | faible",
        ],
      }),
    );
    const g = await generer(s().consultantEquipe);
    expect(g.chiffres_non_verifies).toBe(true);
    expect(g.nombres_non_verifies.some((n: string) => n.includes("47"))).toBe(true);
    // Le nombre de la liste blanche (63 %) n'est pas signalé.
    expect(g.nombres_non_verifies.some((n: string) => n.includes("63"))).toBe(false);

    const refus = await s().a.chef.post(urlC(g.id, "/validation"), {});
    expect(refus.statusCode).toBe(409);
    expect(erreur(refus)).toBe("CHIFFRES_NON_VERIFIES");

    // Retouche qui retire le nombre : plus rien à acquitter (le chef devient auteur d'un rang).
    const retouche = await s().a.chef.patch(urlC(g.id), {
      causes: g.causes.map((c: Cause) =>
        c.domaine === "financement"
          ? { ...c, description: "Des retards de remboursement sont évoqués." }
          : c,
      ),
    });
    attendre(200, retouche, "retouche");
    expect(retouche.json().chiffres_non_verifies).toBe(false);

    // Seconde proposition : le nombre reste, le valideur l'acquitte explicitement.
    const g2 = await generer(s().consultantEquipe);
    const ok = await s().a.chef.post(urlC(g2.id, "/validation"), { acquitte_chiffres: true });
    attendre(200, ok, "validation acquittée");
    expect(ok.json()).toMatchObject({ chiffres_non_verifies: true, chiffres_acquittes: true });
  });

  it("journal d'audit : identifiants et indicateurs seulement, jamais le contenu", async () => {
    sc.serveur.repondre(() => modele(REPONSE_MODELE));
    const g = await generer(chef2, { contexte: "Contexte confidentiel du dossier." });
    attendre(
      200,
      await s().consultantEquipe.patch(urlC(g.id), {
        causes: [
          cause({ libelle: "Libellé confidentiel", description: "Description confidentielle." }),
        ],
      }),
      "modification",
    );
    attendre(200, await s().a.associe.post(urlC(g.id, "/validation"), {}), "validation");
    const lignes = await auditDe(g.id);
    expect(lignes.map((l) => l.action)).toEqual(["generation", "modification", "validation"]);
    const brut = JSON.stringify(lignes);
    for (const interdit of ["confidentiel", "Encaissements", "Awa", "Kora", "voyant"]) {
      expect(brut).not.toContain(interdit);
    }
    expect(lignes[0]?.entite).toBe("red_causes");
  });
});

describe("garde de la base, même application contournée", () => {
  let versionId: string;
  let dossier: string;

  beforeAll(async () => {
    sc.serveur.repondre(() => modele(REPONSE_MODELE));
    dossier = await nouveauDossier(s(), true);
    versionId = (await generer(s().a.chef, {}, dossier)).id as string;
  });

  const rangSuivant = (q: (sql: string, p?: unknown[]) => Promise<unknown>) =>
    q(
      `INSERT INTO red_causes_historique (cabinet_id, dossier_id, version_id, rang, statut_contenu, auteur_id)
       SELECT v.cabinet_id, v.dossier_id, v.id,
              (SELECT max(rang) + 1 FROM red_causes_historique WHERE version_id = v.id), 'valide', v.cree_par
       FROM red_causes_versions v WHERE v.id = $1`,
      [versionId],
    );

  it("MPZ14 : pas de passage à « valide » sans rang « valide » ; MPZ07 : ni par son demandeur", async () => {
    expect(
      await refusSql(async (q) => {
        await q(
          "UPDATE red_causes_versions SET statut = 'valide', valide_par = cree_par, valide_le = now() WHERE id = $1",
          [versionId],
        );
      }),
    ).toBe("MPZ14");
    // Un rang « valide » inscrit par le demandeur (non associé) : la base refuse (MPZ07).
    expect(
      await refusSql(async (q) => {
        await rangSuivant(q);
        await q(
          "UPDATE red_causes_versions SET statut = 'valide', valide_par = cree_par, valide_le = now() WHERE id = $1",
          [versionId],
        );
      }),
    ).toBe("MPZ07");
  });

  it("MPZ14 : nombres non vérifiés non acquittés refusés en base", async () => {
    expect(
      await refusSql(async (q) => {
        await q(
          `INSERT INTO red_causes_historique (cabinet_id, dossier_id, version_id, rang, statut_contenu,
             auteur_id, chiffres_non_verifies, nombres_non_verifies)
           SELECT v.cabinet_id, v.dossier_id, v.id, 2, 'valide', $2, true, '["47"]'::jsonb
           FROM red_causes_versions v WHERE v.id = $1`,
          [versionId, s().a.associeId],
        );
        await q(
          "UPDATE red_causes_versions SET statut = 'valide', valide_par = $2, valide_le = now() WHERE id = $1",
          [versionId, s().a.associeId],
        );
      }),
    ).toBe("MPZ14");
  });

  it("MPZ13 : historique en ajout seul, rangs consécutifs, contenu modifié seulement avec un rang", async () => {
    expect(
      await refusSql(async (q) => {
        await q("UPDATE red_causes_historique SET gabarit = NOT gabarit WHERE version_id = $1", [
          versionId,
        ]);
      }),
    ).toBe("MPZ13");
    expect(
      await refusSql(async (q) => {
        await q("DELETE FROM red_causes_historique WHERE version_id = $1", [versionId]);
      }),
    ).toBe("MPZ13");
    expect(
      await refusSql(async (q) => {
        await q(
          `INSERT INTO red_causes_historique (cabinet_id, dossier_id, version_id, rang, statut_contenu, auteur_id)
           SELECT v.cabinet_id, v.dossier_id, v.id, 5, 'modifie', v.cree_par
           FROM red_causes_versions v WHERE v.id = $1`,
          [versionId],
        );
      }),
    ).toBe("MPZ13");
    expect(
      await refusSql(async (q) => {
        await q(
          `UPDATE red_causes_versions SET contenu = jsonb_set(contenu, '{version}', '2') WHERE id = $1`,
          [versionId],
        );
      }),
    ).toBe("MPZ13");
    // Avec un rang « modifie » de la même transaction, le contenu peut changer.
    expect(
      await refusSql(async (q) => {
        await q(
          `INSERT INTO red_causes_historique (cabinet_id, dossier_id, version_id, rang, statut_contenu, auteur_id)
           SELECT v.cabinet_id, v.dossier_id, v.id, 2, 'modifie', v.cree_par
           FROM red_causes_versions v WHERE v.id = $1`,
          [versionId],
        );
        await q(
          `UPDATE red_causes_versions SET contenu = jsonb_set(contenu, '{version}', '2') WHERE id = $1`,
          [versionId],
        );
      }),
    ).toBe("aucun");
  });

  it("rien ne s'ajoute à l'historique d'une cartographie validée ; elle est figée (MPZ13, MPZ04)", async () => {
    attendre(200, await s().a.associe.post(urlC(versionId, "/validation"), {}), "validation");
    expect(await refusSql(async (q) => void (await rangSuivant(q)))).toBe("MPZ13");
    expect(
      await refusSql(async (q) => {
        await q(`UPDATE red_causes_versions SET contenu = '{"causes":[]}' WHERE id = $1`, [
          versionId,
        ]);
      }),
    ).toBe("MPZ04");
    expect(
      await refusSql(async (q) => {
        await q("DELETE FROM red_causes_versions WHERE id = $1", [versionId]);
      }),
    ).toBe("MPZ01");
  });

  it("le rôle applicatif ne peut ni modifier ni supprimer l'historique", async () => {
    const code = async (sql: string) => {
      try {
        await sc.ctx.db.withTenant(s().a.cabinetId, (db) => db.query(sql, [versionId]));
        return "aucun";
      } catch (e) {
        return (e as { code?: string }).code ?? "inconnu";
      }
    };
    expect(
      await code("UPDATE red_causes_historique SET gabarit = true WHERE version_id = $1"),
    ).toBe("42501");
    expect(await code("DELETE FROM red_causes_historique WHERE version_id = $1")).toBe("42501");
    expect(await code("DELETE FROM red_causes_versions WHERE id = $1")).toBe("42501");
    expect(await code("UPDATE red_causes_versions SET gabarit = true WHERE id = $1")).toBe("42501");
  });

  it("dossier clos : API 409 RED_DOSSIER_CLOS, base MPZ03 ; la lecture reste ouverte", async () => {
    const clos = await nouveauDossier(s(), true);
    const v = await generer(s().a.chef, {}, clos);
    const fermeture = await s().a.directeur.post(`/api/redressement/dossiers/${clos}/statut`, {
      statut: "clos",
      motif: "Objectifs atteints",
    });
    attendre(200, fermeture, "clôture du dossier");
    for (const r of [
      await s().a.chef.post(urlD("/generation", clos), {}),
      await s().a.chef.patch(urlC(v.id), { causes: [cause()] }),
      await s().a.associe.post(urlC(v.id, "/validation"), {}),
    ]) {
      expect(r.statusCode).toBe(409);
      expect(erreur(r)).toBe("RED_DOSSIER_CLOS");
    }
    expect((await s().a.associe.get(urlD("", clos))).statusCode).toBe(200);
    expect(
      await refusSql(async (q) => {
        await q(
          `INSERT INTO red_causes_versions (cabinet_id, dossier_id, version, contenu, demande_id, cree_par)
           SELECT cabinet_id, dossier_id, 2, contenu, demande_id, cree_par
           FROM red_causes_versions WHERE id = $1`,
          [v.id],
        );
      }),
    ).toBe("MPZ03");
  });

  it("les deux tables sont fermées au portail et isolées par cabinet (politiques)", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT polrelid::regclass::text AS table, polname, polpermissive FROM pg_policy
             WHERE polrelid IN ('red_causes_versions'::regclass, 'red_causes_historique'::regclass)
             ORDER BY 1, 2`,
          )
        ).rows,
    );
    expect(lignes).toEqual([
      { table: "red_causes_historique", polname: "isolation", polpermissive: true },
      { table: "red_causes_historique", polname: "portail_interdit", polpermissive: false },
      { table: "red_causes_versions", polname: "isolation", polpermissive: true },
      { table: "red_causes_versions", polname: "portail_interdit", polpermissive: false },
    ]);
  });
});

describe("parité moteur et schémas partagés", () => {
  it("bornes, domaines et niveaux de confiance identiques", () => {
    expect(RED_CAUSES_MAX).toBe(CAUSES_MAX);
    expect(RED_CAUSE_LIBELLE_MAX).toBe(CAUSE_LIBELLE_MAX);
    expect(RED_CAUSE_DESCRIPTION_MAX).toBe(CAUSE_DESCRIPTION_MAX);
    expect([...RED_DOMAINES]).toEqual([...DOMAINES_URGENCE]);
    expect([...RED_NIVEAUX_CONFIANCE_CAUSE]).toEqual([...NIVEAUX_CONFIANCE_CAUSE]);
    expect([...RED_STATUTS_CONTENU_CAUSES]).toEqual(["brouillon_ia", "modifie", "valide"]);
  });
});

describe("lecture de la sortie du modèle (prompt red_causes_racines)", () => {
  const lire = (causes: unknown) => causesDepuisSortie({ causes });

  it("accepte accents, variantes de confiance et barres verticales dans la description", () => {
    const c = lire([
      "Trésorerie | Retards clients | Le client A | le client B paient tard. | Élevée",
      "activite | Perte d'un marché | Hypothèse à confirmer. | moyenne",
      "social | Climat tendu | Entretiens à prévoir. | inconnue",
    ]);
    expect(c?.causes.map((x) => x.domaine)).toEqual(["tresorerie", "activite", "social"]);
    expect(c?.causes[0]).toMatchObject({
      description: "Le client A | le client B paient tard.",
      confiance: "eleve",
    });
    expect(c?.causes[1]?.confiance).toBe("moyen");
    // Dernier champ non reconnu : il reste dans la description, aucune confiance.
    expect(c?.causes[2]).toMatchObject({ description: "Entretiens à prévoir. | inconnue" });
    expect(c?.causes[2]).not.toHaveProperty("confiance");
  });

  it("ignore les doublons, les lignes invalides et borne le nombre de causes", () => {
    const valides = DOMAINES_URGENCE.flatMap((d) =>
      [1, 2, 3].map((i) => `${d} | Cause ${i} | Description ${i}. |`),
    );
    const c = lire(["x | y | z |", 12, "tresorerie |  | vide |", ...valides, valides[0]]);
    expect(c?.causes).toHaveLength(CAUSES_MAX);
    expect(new Set(c?.causes.map((x) => x.id)).size).toBe(CAUSES_MAX);
  });

  it("sortie inexploitable : null", () => {
    expect(causesDepuisSortie(null)).toBeNull();
    expect(causesDepuisSortie({ causes: "prose" })).toBeNull();
    expect(lire([])).toBeNull();
    expect(lire(["tresorerie | Seule | Une seule cause. |"])).toBeNull();
  });
});
