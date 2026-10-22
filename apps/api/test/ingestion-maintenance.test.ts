import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MailerJournal } from "../src/notifications/mailer.js";
import {
  creerHandlerIngestionMaintenance,
  maintenirIngestion,
  planifierIngestionMaintenance,
  TYPE_JOB_INGESTION_MAINTENANCE,
} from "../src/ingestion/maintenance.js";
import { creerRegistre, REGISTRE_JOBS } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import { StockageDisque } from "../src/stockage/disque.js";
import { stockageDe } from "../src/stockage/index.js";
import { proprietaire } from "./helpers.js";
import {
  ingererDd,
  LIGNES_RAPPORT_OK,
  pdfRapport,
  preparerIngestionDd,
  repondreLignes,
  televerserDd,
  type ScenarioIngestionDd,
} from "./ingestion-dd-outils.js";
import {
  activerIa,
  demarrerIngestion,
  etatDe,
  executerJobs,
  ingerer,
  objetsStockes,
  pdfIllisible,
  pdfLiasse,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Maintenance de l'ingestion (lot 6, décision de l'utilisateur du 2026-10-22) : le texte des pages est purgé 90 jours
 * après la validation de l'extraction (ou la décision de l'état, ou la fin du traitement s'il n'y a rien à décider) ;
 * l'état financier, le brouillon validé et le document restent. Reprise des effacements d'objets échoués.
 * Vrai PostgreSQL ; voyage dans le temps par le réglage `app.horloge_test` (base « _test » seulement), comme la
 * maintenance des canaux. Toutes les dates dérivent de `new Date()`.
 */

let ctx: ContexteIngestion;
let s: ScenarioIngestionDd;
let n = 0;
let exercice = 2000;
const exo = () => ++exercice;
const JOUR = 86_400_000;

interface Docs {
  etatAccepte: string;
  etatAccepteClient: string;
  etatEnRevue: string;
  etatId: string;
  iaIndisponible: string;
  echec: string;
  valide: string;
  ouvert: string;
  autreCabinet: string;
  t0: Date;
}
let d: Docs;

beforeAll(async () => {
  ctx = await demarrerIngestion();
  s = await preparerIngestionDd(ctx, "Ingestion maintenance");
  const a = s.a;

  // Sans IA (par défaut) : états déterministes, document « ia_indisponible », échec.
  const accepte = await ingerer(ctx, a.directeur, a.clientId, "propre.pdf", pdfLiasse(), {
    exercice: exo(),
  });
  const enRevue = await ingerer(
    ctx,
    a.directeur,
    a.clientId,
    "revue.pdf",
    pdfLiasse("desequilibree"),
    { exercice: exo() },
  );
  const sansIa = await ingererDd(ctx, a.chef, s.dossierId, "rapport", `r-${++n}.pdf`, pdfRapport());
  const rEchec = await televerserDd(a.chef, s.dossierId, "rapport", `r-${++n}.pdf`, pdfIllisible());
  attendre(202, rEchec, "téléversement illisible");
  await executerJobs(ctx);

  // Avec IA : un brouillon validé, un brouillon ouvert.
  await activerIa(a.associe);
  repondreLignes(ctx, LIGNES_RAPPORT_OK);
  const valide = await ingererDd(ctx, a.chef, s.dossierId, "rapport", `r-${++n}.pdf`, pdfRapport());
  attendre(
    200,
    await a.directeur.post(`/api/dd/extractions/${valide.document.extractions[0].id}/decision`, {
      decision: "validee",
    }),
    "validation",
  );
  const ouvert = await ingererDd(ctx, a.chef, s.dossierId, "rapport", `r-${++n}.pdf`, pdfRapport());

  // Autre cabinet : un état accepté automatiquement.
  const autre = await ingerer(ctx, s.b.directeur, s.b.clientId, "autre.pdf", pdfLiasse(), {
    exercice: exo(),
  });
  d = {
    etatAccepte: accepte.id,
    etatAccepteClient: a.clientId,
    etatEnRevue: enRevue.id,
    etatId: accepte.document.etat_financier_id,
    iaIndisponible: sansIa.id,
    echec: rEchec.json().id,
    valide: valide.id,
    ouvert: ouvert.id,
    autreCabinet: autre.id,
    t0: new Date(),
  };
}, 300_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await ctx?.fermer();
});

/** Maintenance exécutée « à l'instant » `quand` (réglage d'horloge de test, comme `maintenirA` des canaux). */
async function maintenirA(cabinetId: string, quand: Date) {
  return ctx.db.withTenant(cabinetId, async (db) => {
    await db.query("SELECT set_config('app.horloge_test', $1, true)", [quand.toISOString()]);
    return maintenirIngestion(db, ctx.config, cabinetId, quand);
  });
}

const sql = (texte: string, params: unknown[] = []) =>
  proprietaire(async (c) => (await c.query(texte, params)).rows);
const nbPages = async (id: string) =>
  (await sql("SELECT count(*)::int AS n FROM ingestion_pages WHERE document_id = $1", [id]))[0].n;
const doc = async (id: string) =>
  (
    await sql("SELECT statut, resultat, texte_purge_le FROM ingestion_documents WHERE id = $1", [
      id,
    ])
  )[0];
const apres = (jours: number) => new Date(d.t0.getTime() + jours * JOUR + 3_600_000);

describe("préparation", () => {
  it("les documents sont dans l'état attendu avant toute purge", async () => {
    expect(await doc(d.etatAccepte)).toMatchObject({ statut: "termine", resultat: "etat_cree" });
    expect(await doc(d.iaIndisponible)).toMatchObject({
      statut: "termine",
      resultat: "ia_indisponible",
    });
    expect((await doc(d.echec)).statut).toBe("echec");
    expect(await doc(d.valide)).toMatchObject({ resultat: "brouillon_cree" });
    const etat = await etatDe(s.a.directeur, d.etatAccepteClient, d.etatId);
    expect(etat.statut).toBe("accepte");
    for (const id of [d.etatAccepte, d.etatEnRevue, d.iaIndisponible, d.valide, d.ouvert]) {
      expect(await nbPages(id)).toBeGreaterThan(0);
    }
    expect(await nbPages(d.echec)).toBe(0); // PDF illisible : aucune page n'a jamais existé
  });
});

describe("purge du texte des pages", () => {
  it("89 jours : rien n'est purgé ; 91 jours : seuls les documents tranchés ou sans décision à prendre le sont", async () => {
    const pagesValide = await nbPages(d.valide);
    const avant = await maintenirA(s.a.cabinetId, apres(89));
    expect(avant.documents_purges).toBe(0);
    expect(await nbPages(d.valide)).toBe(pagesValide);
    expect((await doc(d.valide)).texte_purge_le).toBeNull();

    const bilan = await maintenirA(s.a.cabinetId, apres(91));
    // État accepté, document ia_indisponible, échec, brouillon validé : 4 documents ; ni l'état en revue ni le
    // brouillon ouvert.
    expect(bilan.documents_purges).toBe(4);
    expect(bilan.pages_purgees).toBeGreaterThan(0);
    for (const id of [d.valide, d.etatAccepte, d.iaIndisponible, d.echec]) {
      expect(await nbPages(id)).toBe(0);
      expect((await doc(id)).texte_purge_le).not.toBeNull();
    }
  });

  it("un brouillon ouvert et un état en revue ne sont jamais purgés, quelle que soit l'ancienneté", async () => {
    const bilan = await maintenirA(s.a.cabinetId, apres(5000));
    expect(bilan.documents_purges).toBe(0);
    for (const id of [d.ouvert, d.etatEnRevue]) {
      expect(await nbPages(id)).toBeGreaterThan(0);
      expect((await doc(id)).texte_purge_le).toBeNull();
    }
  });

  it("l'état financier accepté, ses lignes, le brouillon validé et son contenu restent", async () => {
    const etat = await etatDe(s.a.directeur, d.etatAccepteClient, d.etatId);
    expect(etat.statut).toBe("accepte");
    expect(etat.lignes.length).toBeGreaterThan(0);
    expect(etat.lignes[0].reference.page).toBeGreaterThanOrEqual(1);
    const detail = (await s.a.directeur.get(`/api/dd/documents/${d.valide}`)).json();
    expect(detail.texte_purge_le).not.toBeNull();
    expect(detail.extractions).toHaveLength(1);
    expect(detail.extractions[0]).toMatchObject({ statut: "valide" });
    expect(detail.extractions[0].contenu.elements.length).toBeGreaterThan(0);
    expect(await doc(d.valide)).toMatchObject({ statut: "termine", resultat: "brouillon_cree" });
  });

  it("un document purgé : la route des pages répond 404", async () => {
    expect((await s.a.directeur.get(`/api/dd/documents/${d.valide}/pages/1`)).statusCode).toBe(404);
    expect(
      (
        await s.a.directeur.get(
          `/api/dossiers/${d.etatAccepteClient}/ingestions/${d.etatAccepte}/pages/1`,
        )
      ).statusCode,
    ).toBe(404);
    // Un document non purgé reste lisible.
    attendre(200, await s.a.directeur.get(`/api/dd/documents/${d.ouvert}/pages/1`), "page ouverte");
  });

  it("idempotente et bornée au cabinet : un second passage ne purge rien, l'autre cabinet est intact", async () => {
    expect((await maintenirA(s.a.cabinetId, apres(120))).documents_purges).toBe(0);
    expect(await nbPages(d.autreCabinet)).toBeGreaterThan(0);
    expect((await doc(d.autreCabinet)).texte_purge_le).toBeNull();
    // Le cabinet B, à son tour, est purgé sans toucher au cabinet A (document ouvert intact).
    expect((await maintenirA(s.b.cabinetId, apres(91))).documents_purges).toBe(1);
    expect(await nbPages(d.autreCabinet)).toBe(0);
    expect(await nbPages(d.ouvert)).toBeGreaterThan(0);
  });

  it("une décision de rejet compte aussi ; la dernière décision fait foi", async () => {
    // Le brouillon ouvert est rejeté maintenant : 91 jours plus tard, son texte est purgé.
    const detail = (await s.a.directeur.get(`/api/dd/documents/${d.ouvert}`)).json();
    attendre(
      200,
      await s.a.directeur.post(`/api/dd/extractions/${detail.extractions[0].id}/decision`, {
        decision: "rejetee",
        motif: "Lecture à refaire.",
      }),
      "rejet",
    );
    const t = new Date();
    expect(
      (await maintenirA(s.a.cabinetId, new Date(t.getTime() + 89 * JOUR))).documents_purges,
    ).toBe(0);
    expect(
      (await maintenirA(s.a.cabinetId, new Date(t.getTime() + 91 * JOUR + 60_000)))
        .documents_purges,
    ).toBe(1);
    expect(await nbPages(d.ouvert)).toBe(0);
  });

  it("la fonction refuse l'appel sans contexte de cabinet, une date future et des paramètres hors bornes", async () => {
    await expect(sql("SELECT purger_textes_ingestion(now(), 90, 10)")).rejects.toThrow(/invalides/);
    await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      await expect(
        db.query("SELECT purger_textes_ingestion($1, 90, 10)", [new Date(Date.now() + 2 * JOUR)]),
      ).rejects.toThrow(/dans le futur/);
    });
    for (const [jours, limite] of [
      [89, 10],
      [3651, 10],
      [90, 0],
      [90, 10001],
    ]) {
      await expect(
        ctx.db.withTenant(s.a.cabinetId, (db) =>
          db.query("SELECT purger_textes_ingestion(now(), $1, $2)", [jours, limite]),
        ),
      ).rejects.toThrow(/invalides/);
    }
    const droits = (
      await sql(
        `SELECT has_function_privilege('missionpilot_app', 'purger_textes_ingestion(timestamptz, int, int)', 'EXECUTE') AS app,
                has_function_privilege('public', 'purger_textes_ingestion(timestamptz, int, int)', 'EXECUTE') AS pub,
                has_function_privilege('public', 'planifier_ingestion_maintenance(text, timestamptz, date)', 'EXECUTE') AS pub2`,
      )
    )[0];
    expect(droits).toEqual({ app: true, pub: false, pub2: false });
  });

  it("le rôle applicatif ne supprime aucune page directement", async () => {
    await ctx.db.withTenant(s.a.cabinetId, async (db) => {
      await expect(
        db.query("DELETE FROM ingestion_pages WHERE document_id = $1", [d.etatEnRevue]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("le journal d'audit de la maintenance ne contient que des compteurs", async () => {
    const lignes = await sql(
      "SELECT details FROM journal_audit WHERE cabinet_id = $1 AND action = 'ingestion.maintenance'",
      [s.a.cabinetId],
    );
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      expect(Object.keys(l.details).sort()).toEqual([
        "conservation_jours",
        "documents_purges",
        "effacements_echoues",
        "objets_effaces",
        "pages_purgees",
      ]);
      for (const v of Object.values(l.details)) expect(typeof v).toBe("number");
    }
  });
});

describe("reprise des effacements d'objets", () => {
  async function objetMarque(): Promise<string> {
    const stockage = stockageDe(ctx.config);
    const cle = await stockage.ecrire(s.a.cabinetId, Buffer.from("objet temporaire"));
    await sql(
      `WITH f AS (
         INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
         VALUES ($1, $2, 'temp.txt', 'text/plain', 16, repeat('a', 64), $3) RETURNING id)
       INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par)
       SELECT $1, id, 'retire', $3 FROM f`,
      [s.a.cabinetId, cle, s.a.directeur.utilisateurId],
    );
    return cle;
  }
  const present = async (cle: string) =>
    stockageDe(ctx.config)
      .lire(s.a.cabinetId, cle)
      .then((f) => {
        f.destroy();
        return true;
      })
      .catch(() => false);

  it("un objet marqué « retire » mais encore présent est effacé par le job", async () => {
    const cle = await objetMarque();
    expect(await present(cle)).toBe(true);
    const bilan = await maintenirA(s.a.cabinetId, new Date());
    expect(bilan.objets_effaces).toBeGreaterThanOrEqual(1);
    expect(await present(cle)).toBe(false);
    // Idempotent : plus rien à effacer.
    expect((await maintenirA(s.a.cabinetId, new Date())).objets_effaces).toBe(0);
  });

  it("un échec du stockage est compté sans faire échouer la maintenance, l'objet reste à reprendre", async () => {
    const cle = await objetMarque();
    const espion = vi
      .spyOn(StockageDisque.prototype, "supprimer")
      .mockRejectedValue(new Error("stockage indisponible"));
    const bilan = await maintenirA(s.a.cabinetId, new Date());
    expect(bilan.effacements_echoues).toBeGreaterThanOrEqual(1);
    expect(bilan.objets_effaces).toBe(0);
    expect(await present(cle)).toBe(true);
    espion.mockRestore();
    // Reprise le lendemain : l'objet est effacé.
    expect((await maintenirA(s.a.cabinetId, new Date())).objets_effaces).toBeGreaterThanOrEqual(1);
    expect(await present(cle)).toBe(false);
  });

  it("aucun objet temporaire des documents ingérés ne reste dans le stockage", async () => {
    expect(await objetsStockes(ctx, s.a.cabinetId)).toBe(0);
  });
});

describe("planification et registre", () => {
  it("le job est inscrit au registre ; planifié une fois par jour et par cabinet (clé), exécuté sans erreur", async () => {
    expect(REGISTRE_JOBS.has(TYPE_JOB_INGESTION_MAINTENANCE)).toBe(true);
    // Hier : le job est prêt à l'instant courant quelle que soit l'heure de la journée.
    const hier = new Date(Date.now() - JOUR);
    const jour = hier.toISOString().slice(0, 10);
    const cle = `ingestion_maintenance:${jour}`;
    const premier = await ctx.db.withoutTenant((db) => planifierIngestionMaintenance(db, hier));
    expect(premier).toBeGreaterThanOrEqual(1);
    expect(await ctx.db.withoutTenant((db) => planifierIngestionMaintenance(db, hier))).toBe(0);
    // Les cabinets d'autres suites ne sont pas concernés par ce test : leurs tâches sont retirées.
    await sql(
      `DELETE FROM jobs WHERE type = $1 AND statut = 'en_attente' AND NOT (cabinet_id = ANY ($2::uuid[]))`,
      [TYPE_JOB_INGESTION_MAINTENANCE, ctx.cabinets],
    );
    const jobs = await sql(
      "SELECT cabinet_id, statut, charge FROM jobs WHERE type = $1 AND cle = $2 AND cabinet_id = ANY ($3::uuid[])",
      [TYPE_JOB_INGESTION_MAINTENANCE, cle, ctx.cabinets],
    );
    expect(jobs.map((j) => j.cabinet_id)).toContain(s.a.cabinetId);
    expect(jobs.every((j) => j.charge.jour === jour)).toBe(true);

    const worker = new WorkerJobs(ctx.db, {
      mailer: ctx.app.mailer as MailerJournal,
      registre: creerRegistre({
        [TYPE_JOB_INGESTION_MAINTENANCE]: creerHandlerIngestionMaintenance(() => ctx.deps),
      }),
      horloge: () => new Date(),
      delaiReprise: () => 60_000,
    });
    while (await worker.traiterUn());
    const apresJob = await sql(
      "SELECT statut FROM jobs WHERE type = $1 AND cle = $2 AND cabinet_id = ANY ($3::uuid[])",
      [TYPE_JOB_INGESTION_MAINTENANCE, cle, ctx.cabinets],
    );
    expect(apresJob.length).toBeGreaterThanOrEqual(1);
    expect(apresJob.every((j) => j.statut === "termine")).toBe(true);
  });

  it("clé mal formée, paramètre nul, heure hors fenêtre : refus de la fonction de planification", async () => {
    const appeler = (texte: string, params: unknown[]) =>
      ctx.db.withoutTenant((db) => db.query(texte, params));
    await expect(
      appeler("SELECT planifier_ingestion_maintenance('maintenance:x', $1, $2)", [
        "2026-10-14T03:45:00Z",
        "2026-10-14",
      ]),
    ).rejects.toThrow(/invalide/);
    await expect(
      appeler("SELECT planifier_ingestion_maintenance($1, NULL, $2)", [
        "ingestion_maintenance:2026-10-14",
        "2026-10-14",
      ]),
    ).rejects.toThrow(/obligatoires/);
    await expect(
      appeler("SELECT planifier_ingestion_maintenance($1, '2026-12-01T03:45:00Z', $2)", [
        "ingestion_maintenance:2026-10-14",
        "2026-10-14",
      ]),
    ).rejects.toThrow(/hors de la journée/);
  });
});

describe("planification : la condition ne reste pas vraie indéfiniment", () => {
  const jourDans = (jours: number) =>
    new Date(Date.now() + jours * JOUR).toISOString().slice(0, 10);
  const planifierPour = async (jour: string) => {
    await ctx.db.withoutTenant((db) =>
      planifierIngestionMaintenance(db, new Date(`${jour}T12:00:00Z`)),
    );
    const jobs = await sql(
      "SELECT cabinet_id FROM jobs WHERE type = $1 AND cle = $2 AND cabinet_id = $3",
      [TYPE_JOB_INGESTION_MAINTENANCE, `ingestion_maintenance:${jour}`, s.b.cabinetId],
    );
    // Les tâches de ce jour sont retirées : aucune autre suite ne les attend.
    await sql("DELETE FROM jobs WHERE type = $1 AND cle = $2 AND statut = 'en_attente'", [
      TYPE_JOB_INGESTION_MAINTENANCE,
      `ingestion_maintenance:${jour}`,
    ]);
    return jobs.length;
  };

  it("un document terminal dont fichier_id est resté renseigné, sans objet marqué à reprendre, ne replanifie pas ; un objet marqué « retire » replanifie", async () => {
    // Document en échec dont l'effacement de l'objet a échoué : fichier_id reste renseigné (terminal, intouchable).
    const [{ id }] = await sql(
      `INSERT INTO ingestion_documents (cabinet_id, usage, client_id, nom, format, sha256, taille, fichier_id, cree_par)
       VALUES ($1, 'etat_financier', $2, 'echec-efface.pdf', 'pdf', repeat('b', 64), 10, gen_random_uuid(), $3)
       RETURNING id`,
      [s.b.cabinetId, s.b.clientId, s.b.directeur.utilisateurId],
    );
    await sql(
      "UPDATE ingestion_documents SET statut = 'echec', erreur_code = 'ECHEC_TEST', termine_le = now() WHERE id = $1",
      [id],
    );
    // Texte purgé (tout est purgeable 400 jours plus tard) : il ne reste que fichier_id renseigné.
    await maintenirA(s.b.cabinetId, apres(400));
    const reste = await sql(
      `SELECT count(*)::int AS n FROM ingestion_documents
       WHERE cabinet_id = $1 AND statut IN ('termine', 'echec') AND texte_purge_le IS NULL`,
      [s.b.cabinetId],
    );
    expect(reste[0].n).toBe(0);
    expect(
      (await sql("SELECT fichier_id FROM ingestion_documents WHERE id = $1", [id]))[0].fichier_id,
    ).not.toBeNull();

    // 40 jours plus tard : tous les marquages « retire » du cabinet sont anciens de plus de 30 jours.
    expect(await planifierPour(jourDans(40))).toBe(0);

    // Un objet marqué « retire » récemment (peut-être encore présent) replanifie.
    const cle = await stockageDe(ctx.config).ecrire(
      s.b.cabinetId,
      Buffer.from("objet à reprendre"),
    );
    await sql(
      `WITH f AS (
         INSERT INTO fichiers (cabinet_id, cle_stockage, nom_origine, type_mime, taille, sha256, envoye_par)
         VALUES ($1, $2, 'reprise.txt', 'text/plain', 17, repeat('c', 64), $3) RETURNING id)
       INSERT INTO fichiers_suppressions (cabinet_id, fichier_id, motif, supprime_par)
       SELECT $1, id, 'retire', $3 FROM f`,
      [s.b.cabinetId, cle, s.b.directeur.utilisateurId],
    );
    expect(await planifierPour(jourDans(-2))).toBe(1);
    // Hors fenêtre (le marquage a plus de 30 jours à cette date) : plus de planification.
    expect(await planifierPour(jourDans(40))).toBe(0);
    await maintenirA(s.b.cabinetId, new Date());
  });
});
