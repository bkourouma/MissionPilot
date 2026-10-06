import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planificationPurgeFichiers } from "../src/jobs/planificateur.js";
import { stockageDe } from "../src/stockage/index.js";
import { creerHandlerPurgeFichiers } from "../src/stockage/purge.js";
import { api, type Api } from "./api.js";
import {
  demarrerAvecStockage,
  ECHANTILLONS,
  marquerOrphelins,
  televerser,
} from "./fichiers-outils.js";
import { proprietaire, type Contexte } from "./helpers.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";

let ctx: Contexte & { dossier: string };
let a: CabinetMissions;
let b: CabinetMissions;

beforeAll(async () => {
  ctx = await demarrerAvecStockage();
  a = await preparerCabinet(ctx, "Cabinet Fichiers A");
  b = await preparerCabinet(ctx, "Cabinet Fichiers B");
});
afterAll(async () => {
  await marquerOrphelins([a.cabinetId, b.cabinetId]);
  await ctx.fermer();
});

const deposer = (par: Api = a.chef, nom = "rapport.pdf", contenu: Buffer = ECHANTILLONS.pdf()) =>
  televerser(par, "/api/fichiers", nom, contenu);

describe("téléversement (SOC-05)", () => {
  it("nominal : type détecté par le contenu, nom assaini, empreinte, clé jamais exposée", async () => {
    const r = await deposer(a.chef, "Rapport final.pdf", ECHANTILLONS.pdf("v1"));
    expect(r.statusCode).toBe(201);
    const f = r.json();
    expect(f).toMatchObject({
      nom: "Rapport final.pdf",
      type_mime: "application/pdf",
      envoye_par: a.chef.utilisateurId,
      doublon_de: null,
    });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.taille).toBe(ECHANTILLONS.pdf("v1").length);
    expect(JSON.stringify(f)).not.toMatch(/cle_stockage/);
    // Rangé sous le dossier du cabinet, sous une clé qui ne reprend pas le nom.
    expect(await readdir(ctx.dossier)).toContain(a.cabinetId);
    const sous = await readdir(path.join(ctx.dossier, a.cabinetId));
    const objets = (
      await Promise.all(sous.map((d) => readdir(path.join(ctx.dossier, a.cabinetId, d))))
    ).flat();
    expect(objets.every((o) => /^[0-9a-f]{32}$/.test(o))).toBe(true);
    // Journal d'audit sans le contenu.
    const audit = await ctx.db.withTenant(
      a.cabinetId,
      async (db) =>
        (
          await db.query(
            "SELECT details FROM journal_audit WHERE action = 'televersement' AND entite_id = $1",
            [f.id],
          )
        ).rows,
    );
    expect(audit[0].details).toMatchObject({ nom: "Rapport final.pdf", taille: f.taille });
    expect(JSON.stringify(audit)).not.toMatch(/Catalog/);
  });

  it("chaque type de la liste blanche est accepté ; extension ajoutée si absente", async () => {
    const cas: [string, Buffer, string][] = [
      ["photo.png", ECHANTILLONS.png(), "image/png"],
      ["photo.jpg", ECHANTILLONS.jpeg(), "image/jpeg"],
      ["photo.webp", ECHANTILLONS.webp(), "image/webp"],
      [
        "note.docx",
        ECHANTILLONS.docx(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      [
        "calcul.xlsx",
        ECHANTILLONS.xlsx(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      [
        "deck.pptx",
        ECHANTILLONS.pptx(),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
      ["frais.csv", ECHANTILLONS.csv(), "text/csv"],
      ["note.txt", ECHANTILLONS.txt(), "text/plain"],
    ];
    for (const [nom, contenu, type] of cas) {
      const r = await deposer(a.chef, nom, contenu);
      expect(r.statusCode, nom).toBe(201);
      expect(r.json().type_mime).toBe(type);
    }
    expect((await deposer(a.chef, "sans-extension", ECHANTILLONS.pdf("x"))).json().nom).toBe(
      "sans-extension.pdf",
    );
    await marquerOrphelins([a.cabinetId]);
  });

  it("traversée de chemin dans le nom : seul le dernier segment, assaini, est gardé", async () => {
    const r = await deposer(a.chef, "../../../etc/passwd.txt", ECHANTILLONS.txt());
    expect(r.statusCode).toBe(201);
    expect(r.json().nom).toBe("passwd.txt");
    const w = await deposer(a.chef, "..\\..\\boot.ini.txt", ECHANTILLONS.txt());
    expect(w.json().nom).toBe("boot.ini.txt");
  });

  it("faux type : exécutable renommé en PDF, archive, macros, SVG, HTML → 415", async () => {
    const cas: [string, Buffer][] = [
      ["facture.pdf", ECHANTILLONS.exe()],
      ["photo.jpg", ECHANTILLONS.elf()],
      ["pieces.zip", ECHANTILLONS.archive()],
      ["note.docx", ECHANTILLONS.archive()],
      ["note.docx", ECHANTILLONS.docm()],
      ["logo.svg", ECHANTILLONS.svg()],
      ["page.txt", ECHANTILLONS.html()],
      ["piege.pdf", ECHANTILLONS.pdfActif()],
      ["image.png", ECHANTILLONS.pdf()],
    ];
    for (const [nom, contenu] of cas) {
      const r = await deposer(a.chef, nom, contenu);
      expect(r.statusCode, nom).toBe(415);
      expect(r.json().erreur.code).toBe("TYPE_FICHIER_REFUSE");
    }
    // L'en-tête Content-Type déclaré n'est pas cru.
    const r = await televerser(a.chef, "/api/fichiers", "x.pdf", ECHANTILLONS.exe(), {
      type: "application/pdf",
    });
    expect(r.statusCode).toBe(415);
  });

  it("corps invalide : pas multipart, mauvais champ, fichier vide", async () => {
    expect((await a.chef.post("/api/fichiers", { nom: "x" })).statusCode).toBe(415);
    const champ = await televerser(a.chef, "/api/fichiers", "a.pdf", ECHANTILLONS.pdf(), {
      champ: "document",
    });
    expect(champ.statusCode).toBe(400);
    expect((await deposer(a.chef, "vide.pdf", Buffer.alloc(0))).statusCode).toBe(400);
  });

  it("empreinte : un doublon de ses propres fichiers est signalé, jamais celui d'autrui", async () => {
    const contenu = ECHANTILLONS.pdf("doublon");
    const premier = (await deposer(a.chef, "d1.pdf", contenu)).json();
    const second = (await deposer(a.chef, "d2.pdf", contenu)).json();
    expect(second.sha256).toBe(premier.sha256);
    expect(second.doublon_de).toBe(premier.id);
    expect((await deposer(a.directeur, "d3.pdf", contenu)).json().doublon_de).toBeNull();
  });

  it("droits : 401 sans session ; « document.ecrire » requis", async () => {
    expect((await deposer(api(ctx))).statusCode).toBe(401);
    for (const roles of [["expert_externe"], ["ressources"], ["gestionnaire"]] as const) {
      expect((await deposer(await a.avecRoles([...roles]))).statusCode, roles[0]).toBe(403);
    }
    for (const roles of [["consultant"], ["expert_metier"], ["associe"]] as const) {
      expect((await deposer(await a.avecRoles([...roles]))).statusCode, roles[0]).toBe(201);
    }
  });

  it("métadonnées en ajout seul : ni UPDATE ni DELETE pour le rôle applicatif", async () => {
    const f = (await deposer()).json();
    for (const sql of [
      "UPDATE fichiers SET nom_origine = 'x' WHERE id = $1",
      "DELETE FROM fichiers WHERE id = $1",
      "UPDATE fichiers_suppressions SET motif = 'retire' WHERE fichier_id = $1",
      "DELETE FROM fichiers_suppressions WHERE fichier_id = $1",
    ]) {
      await expect(ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [f.id]))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("plafonds : taille par fichier et quota par cabinet", () => {
  it("dépassement de la taille (paramètre) → 413 ; du quota du cabinet → 409", async () => {
    const petit = await demarrerAvecStockage({
      FICHIER_TAILLE_MAX_OCTETS: 2048,
      QUOTA_STOCKAGE_CABINET_OCTETS: 1024 * 1024,
    });
    try {
      const c = await preparerCabinet(petit, "Cabinet Fichiers Quota");
      const gros = Buffer.concat([ECHANTILLONS.pdf(), Buffer.alloc(4096, 0x20)]);
      const r = await televerser(c.chef, "/api/fichiers", "gros.pdf", gros);
      expect(r.statusCode).toBe(413);
      expect(r.json().erreur.code).toBe("FICHIER_TROP_VOLUMINEUX");
      // Quota : on remplit le cabinet jusqu'au plafond par un fichier marqué en base.
      const f = (await televerser(c.chef, "/api/fichiers", "a.pdf", ECHANTILLONS.pdf())).json();
      await proprietaire((cl) =>
        cl.query("UPDATE fichiers SET taille = $2 WHERE id = $1", [f.id, 1024 * 1024 - 10]),
      );
      const q = await televerser(c.chef, "/api/fichiers", "b.pdf", ECHANTILLONS.pdf());
      expect(q.statusCode).toBe(409);
      expect(q.json().erreur.code).toBe("QUOTA_STOCKAGE_ATTEINT");
      // Un fichier supprimé ne compte plus dans le quota.
      expect((await c.chef.delete(`/api/fichiers/${f.id}`)).statusCode).toBe(204);
      expect(
        (await televerser(c.chef, "/api/fichiers", "b.pdf", ECHANTILLONS.pdf())).statusCode,
      ).toBe(201);
      await marquerOrphelins([c.cabinetId]);
    } finally {
      await petit.fermer();
    }
  });

  it("plafond par défaut : 15 Mo par fichier, 2 Go par cabinet", () => {
    expect(ctx.config.FICHIER_TAILLE_MAX_OCTETS).toBe(15 * 1024 * 1024);
    expect(ctx.config.QUOTA_STOCKAGE_CABINET_OCTETS).toBe(2 * 1024 * 1024 * 1024);
  });
});

describe("téléchargement authentifié GET /api/fichiers/:id", () => {
  it("en-têtes de sécurité ; attachment par défaut ; inline seulement pour PDF et images", async () => {
    const pdf = (await deposer(a.chef, "Compte rendu été.pdf", ECHANTILLONS.pdf("cr"))).json();
    const r = await a.chef.get(`/api/fichiers/${pdf.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(ECHANTILLONS.pdf("cr"))).toBe(true);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toMatch(/^sandbox/);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.headers["content-disposition"]).toBe(
      `attachment; filename="Compte rendu ete.pdf"; filename*=UTF-8''Compte%20rendu%20%C3%A9t%C3%A9.pdf`,
    );
    const enLigne = await a.chef.get(`/api/fichiers/${pdf.id}?affichage=inline`);
    expect(enLigne.headers["content-disposition"]).toMatch(/^inline;/);
    const txt = (await deposer(a.chef, "note.txt", ECHANTILLONS.txt())).json();
    const t = await a.chef.get(`/api/fichiers/${txt.id}?affichage=inline`);
    expect(t.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(t.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect((await a.chef.get(`/api/fichiers/${pdf.id}?affichage=autre`)).statusCode).toBe(400);
    // Chaque téléchargement servi est journalisé (2 ; la requête invalide n'est pas servie).
    const audit = await ctx.db.withTenant(
      a.cabinetId,
      async (db) =>
        (
          await db.query(
            "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'telechargement' AND entite_id = $1",
            [pdf.id],
          )
        ).rows[0].n,
    );
    expect(audit).toBe(2);
  });

  it("fichier non rattaché : son seul auteur ; un collègue reçoit 404", async () => {
    const f = (await deposer()).json();
    expect((await a.chef.get(`/api/fichiers/${f.id}`)).statusCode).toBe(200);
    expect((await a.directeur.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    expect((await a.associe.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    expect((await api(ctx).get(`/api/fichiers/${f.id}`)).statusCode).toBe(401);
  });

  it("isolation : un fichier d'un autre cabinet répond 404, par identifiant connu", async () => {
    const m = await creerMission(b);
    const f = (await deposer(b.chef, "secret.pdf", ECHANTILLONS.pdf("b"))).json();
    attendre201(
      await b.chef.post(`/api/missions/${m.id}/documents`, {
        type: "livrable",
        nom: "Secret",
        fichier_id: f.id,
      }),
    );
    expect((await b.associe.get(`/api/fichiers/${f.id}`)).statusCode).toBe(200);
    for (const intrus of [a.associe, a.chef]) {
      expect((await intrus.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
      expect((await intrus.delete(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    }
    // Rattacher le fichier d'un autre cabinet à sa propre mission : 404.
    const ma = await creerMission(a);
    expect(
      (
        await a.chef.post(`/api/missions/${ma.id}/documents`, {
          type: "livrable",
          nom: "Vol",
          fichier_id: f.id,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("fichier d'une mission invisible → 404 ; visible pour l'équipe, puis plus après retrait", async () => {
    const m = await creerMission(a);
    const f = (await deposer(a.chef, "livrable.pdf", ECHANTILLONS.pdf("liv"))).json();
    attendre201(
      await a.chef.post(`/api/missions/${m.id}/documents`, {
        type: "livrable",
        nom: "Livrable",
        fichier_id: f.id,
      }),
    );
    const consultant = await a.avecRoles(["consultant"]);
    expect((await consultant.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    await a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    expect((await consultant.get(`/api/fichiers/${f.id}`)).statusCode).toBe(200);
    const ressources = await a.avecRoles(["ressources"]);
    expect((await ressources.get(`/api/fichiers/${f.id}`)).statusCode).toBe(200);
    // L'expert externe, même membre, n'a pas « mission.lire » : pas d'accès aux documents.
    const externe = await a.avecRoles(["expert_externe"]);
    await a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: externe.utilisateurId });
    expect((await externe.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    // Un fichier rattaché ne se retire pas.
    expect((await a.chef.delete(`/api/fichiers/${f.id}`)).statusCode).toBe(409);
  });

  it("objet absent du stockage → 404 (jamais 500)", async () => {
    const f = (await deposer()).json();
    const cle = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT cle_stockage FROM fichiers WHERE id = $1", [f.id])).rows[0]
          .cle_stockage as string,
    );
    await stockageDe(ctx.config).supprimer(a.cabinetId, cle);
    expect((await a.chef.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
  });

  it("retrait d'un fichier non rattaché par son auteur : plus servi ; d'autrui : 404", async () => {
    const f = (await deposer()).json();
    expect((await a.directeur.delete(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    expect((await a.chef.delete(`/api/fichiers/${f.id}`)).statusCode).toBe(204);
    expect((await a.chef.get(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
    expect((await a.chef.delete(`/api/fichiers/${f.id}`)).statusCode).toBe(404);
  });
});

describe("purge des fichiers orphelins (job planifié, horloge injectée)", () => {
  it("un orphelin de plus de 24 h est marqué et effacé ; un fichier rattaché ou récent reste", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Fichiers Purge");
    const orphelin = (
      await televerser(c.chef, "/api/fichiers", "o.pdf", ECHANTILLONS.pdf("o"))
    ).json();
    const garde = (
      await televerser(c.chef, "/api/fichiers", "g.pdf", ECHANTILLONS.pdf("g"))
    ).json();
    const m = await creerMission(c);
    attendre201(
      await c.chef.post(`/api/missions/${m.id}/documents`, {
        type: "livrable",
        nom: "Gardé",
        fichier_id: garde.id,
      }),
    );
    const handler = creerHandlerPurgeFichiers(() => stockageDe(ctx.config));
    const purger = (maintenant: Date) =>
      ctx.db.withTenant(c.cabinetId, (db) =>
        handler({ db, cabinetId: c.cabinetId, jobId: "test", charge: {}, maintenant }),
      );
    // 23 h plus tard : rien.
    await purger(new Date(Date.now() + 23 * 3600_000));
    expect((await c.chef.get(`/api/fichiers/${orphelin.id}`)).statusCode).toBe(200);
    // 25 h plus tard : l'orphelin est purgé, le fichier rattaché reste.
    await purger(new Date(Date.now() + 25 * 3600_000));
    expect((await c.chef.get(`/api/fichiers/${orphelin.id}`)).statusCode).toBe(404);
    expect((await c.chef.get(`/api/fichiers/${garde.id}`)).statusCode).toBe(200);
    const etat = await proprietaire(
      async (cl) =>
        (
          await cl.query(
            `SELECT f.cle_stockage, s.motif FROM fichiers f
             JOIN fichiers_suppressions s ON s.fichier_id = f.id WHERE f.id = $1`,
            [orphelin.id],
          )
        ).rows[0],
    );
    expect(etat.motif).toBe("orphelin");
    await expect(stockageDe(ctx.config).lire(c.cabinetId, etat.cle_stockage)).rejects.toThrow();
    // Un rattachement tardif (expiré) est refusé.
    const vieux = (
      await televerser(c.chef, "/api/fichiers", "v.pdf", ECHANTILLONS.pdf("v"))
    ).json();
    await proprietaire((cl) =>
      cl.query(
        "UPDATE fichiers SET cree_le = now() - interval '23 hours 30 minutes' WHERE id = $1",
        [vieux.id],
      ),
    );
    const tard = await c.chef.post(`/api/missions/${m.id}/documents`, {
      type: "livrable",
      nom: "Tardif",
      fichier_id: vieux.id,
    });
    expect(tard.statusCode).toBe(409);
    await marquerOrphelins([c.cabinetId]);
  });

  it("planification : une clé par heure et par cabinet, seulement s'il y a des orphelins anciens", async () => {
    const c = await preparerCabinet(ctx, "Cabinet Fichiers Planif");
    await televerser(c.chef, "/api/fichiers", "o.pdf", ECHANTILLONS.pdf("p"));
    const maintenant = new Date(Date.now() + 25 * 3600_000);
    const p = planificationPurgeFichiers(maintenant);
    expect(p.cle).toBe(`purge_fichiers:${maintenant.toISOString().slice(0, 13)}`);
    const planifier = () =>
      ctx.db.withoutTenant((db) =>
        db.query("SELECT planifier_purge_fichiers($1, $2, $3) AS n", [p.cle, p.executeA, p.seuil]),
      );
    await planifier();
    await planifier();
    const jobs = await proprietaire(
      async (cl) =>
        (await cl.query("SELECT cabinet_id, cle FROM jobs WHERE cle = $1", [p.cle])).rows as {
          cabinet_id: string;
        }[],
    );
    expect(jobs.filter((j) => j.cabinet_id === c.cabinetId)).toHaveLength(1);
    expect(jobs.some((j) => j.cabinet_id === b.cabinetId)).toBe(false);
    await expect(
      ctx.db.withoutTenant((db) =>
        db.query("SELECT planifier_purge_fichiers('autre', now(), now())"),
      ),
    ).rejects.toThrow(/Clé de purge invalide/);
    await proprietaire((cl) => cl.query("DELETE FROM jobs WHERE cle = $1", [p.cle]));
    await marquerOrphelins([c.cabinetId]);
  });
});

function attendre201(r: { statusCode: number; body: string }) {
  if (r.statusCode !== 201) throw new Error(`${r.statusCode} ${r.body}`);
}
