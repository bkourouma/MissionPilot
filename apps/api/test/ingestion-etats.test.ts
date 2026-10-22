/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demanderLignesIa } from "../src/ingestion/ia-lignes.js";
import { assurerPromptEtat, NOM_PROMPT_ETAT_LIGNES } from "../src/ingestion/prompts-etat.js";
import { proprietaire } from "./helpers.js";
import { authDe } from "./ia-outils.js";
import {
  LIASSE_PAGE_1,
  LIASSE_PAGE_2,
  LIASSE_XLSX,
  LIGNES_IA_LIASSE,
  activerIa,
  demarrerIngestion,
  etatDe,
  executerJobs,
  fabriquerPdf,
  fabriquerXlsx,
  ingerer,
  objetsStockes,
  pdfIllisible,
  pdfLiasse,
  reponseLignes,
  televerserEtat,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { creerMission, preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * DOS-03 : états financiers lus dans un PDF ou un classeur Excel (ADR-009). Vrai PostgreSQL, serveur
 * OpenRouter FACTICE local (aucune clé, aucun appel externe). Chaque test utilise son propre exercice : un
 * nouvel état du même exercice remplace l'état courant.
 */

let ctx: ContexteIngestion;
let a: CabinetMissions; // IA désactivée (défaut du cabinet) : règles déterministes
let b: CabinetMissions; // IA activée
let exercice = 2000;
const exo = () => ++exercice;

beforeAll(async () => {
  ctx = await demarrerIngestion();
  a = await preparerCabinet(ctx, "Ingestion A");
  b = await preparerCabinet(ctx, "Ingestion B");
  ctx.cabinets.push(a.cabinetId, b.cabinetId);
  await creerMission(a);
  await creerMission(b);
  await activerIa(b.associe);
}, 240_000);
afterAll(async () => {
  await ctx?.fermer();
});

const lignesParCode = (etat: any) => Object.fromEntries(etat.lignes.map((l: any) => [l.code, l]));

describe("PDF à couche texte, sans IA (règles déterministes)", () => {
  it("liasse équilibrée : état d'origine pdf accepté automatiquement, chaque ligne cite sa page", async () => {
    const avant = ctx.serveur.requetes.length;
    const { document } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "liasse 2025.pdf",
      pdfLiasse(),
      {
        exercice: exo(),
      },
    );
    expect(ctx.serveur.requetes.length).toBe(avant); // IA désactivée : aucun appel
    expect(document).toMatchObject({
      usage: "etat_financier",
      nom: "liasse 2025.pdf",
      format: "pdf",
      statut: "termine",
      resultat: "etat_cree",
      methode: "texte",
      nb_pages: 2,
      erreur_code: null,
      erreur: null,
      cree_par: { id: a.directeur.utilisateurId },
      extractions: [],
    });
    expect(document.pages).toEqual([
      expect.objectContaining({ numero: 1, methode: "texte", confiance_pm: null }),
      expect.objectContaining({ numero: 2, methode: "texte", confiance_pm: null }),
    ]);
    expect(document.termine_le).toBeTruthy();
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    expect(etat).toMatchObject({
      origine: "pdf",
      statut: "accepte",
      controles_ok: true,
      source_libelle: "Extraction PDF : liasse 2025.pdf",
      fichier: { nom: "liasse 2025.pdf" },
    });
    expect(etat.decision).toMatchObject({ decision: "accepte", automatique: true });
    expect(etat.lignes).toHaveLength(15);
    for (const l of etat.lignes) {
      expect(l.reference).toEqual({ fichier: "liasse 2025.pdf", page: expect.any(Number) });
    }
    const par = lignesParCode(etat);
    expect(par.AD).toMatchObject({ section: "actif", montant: 1_200_000 });
    expect(par.AD.reference.page).toBe(1);
    expect(par.RC.reference.page).toBe(2);
    expect(par.CF.montant).toBe(-500_000);
    expect(par.BZ.role).toBe("total");
  });

  it("pages : texte, méthode, confiance ; page inconnue : 404", async () => {
    const { id } = await ingerer(ctx, a.directeur, a.clientId, "pages.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    const base = `/api/dossiers/${a.clientId}/ingestions/${id}/pages`;
    const p1 = await a.directeur.get(`${base}/1`);
    attendre(200, p1, "page 1");
    expect(p1.json()).toMatchObject({ numero: 1, methode: "texte", confiance_pm: null });
    expect(p1.json().texte.split("\n")).toEqual(LIASSE_PAGE_1);
    expect((await a.directeur.get(`${base}/2`)).json().texte.split("\n")).toEqual(LIASSE_PAGE_2);
    expect((await a.directeur.get(`${base}/3`)).statusCode).toBe(404);
    expect((await a.directeur.get(`${base}/0`)).statusCode).toBe(400);
    const liste = (await a.directeur.get(`/api/dossiers/${a.clientId}/ingestions/${id}`)).json();
    expect(liste.pages[0].nb_caracteres).toBe(LIASSE_PAGE_1.join("\n").length);
  });

  it("liasse déséquilibrée : état en revue avec écart, jamais accepté", async () => {
    const { document } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "desequilibre.pdf",
      pdfLiasse("desequilibree"),
      {
        exercice: exo(),
      },
    );
    expect(document).toMatchObject({ statut: "termine", resultat: "etat_cree" });
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    expect(etat).toMatchObject({
      origine: "pdf",
      statut: "en_revue",
      controles_ok: false,
      decision: null,
    });
    expect(etat.ecarts).toBeGreaterThan(0);
    expect(
      etat.constats.some((c: any) => c.code === "EQUILIBRE_BILAN" && c.statut === "ecart"),
    ).toBe(true);
  });

  it("une ligne ambiguë à trois montants force la revue même si l'état est équilibré", async () => {
    const { document } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "ambigu.pdf",
      pdfLiasse("ambigue"),
      {
        exercice: exo(),
      },
    );
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    expect(etat.controles_ok).toBe(true); // les contrôles passent…
    expect(etat.conforme).toBe(true);
    expect(etat).toMatchObject({ statut: "en_revue", decision: null }); // …mais une ligne est restée non lue
    expect(etat.lignes.map((l: any) => l.code)).not.toContain("AF");
  });

  it("tolérance > 0 : revue obligatoire, même équilibré", async () => {
    const { document } = await ingerer(ctx, a.directeur, a.clientId, "tolerance.pdf", pdfLiasse(), {
      exercice: exo(),
      tolerance: 100,
    });
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    expect(etat).toMatchObject({ statut: "en_revue", tolerance: 100, controles_ok: true });
  });

  it("un état accepté par un humain n'est pas remplacé automatiquement", async () => {
    const e = exo();
    const premier = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "revue.pdf",
      pdfLiasse("desequilibree"),
      {
        exercice: e,
      },
    );
    const idEtat = premier.document.etat_financier_id as string;
    attendre(
      200,
      await a.associe.post(`/api/dossiers/${a.clientId}/etats-financiers/${idEtat}/decision`, {
        decision: "accepte",
        motif: "Écart expliqué par un retraitement connu du DAF.",
      }),
      "acceptation humaine",
    );
    const second = await ingerer(ctx, a.directeur, a.clientId, "propre.pdf", pdfLiasse(), {
      exercice: e,
    });
    const etat = await etatDe(a.directeur, a.clientId, second.document.etat_financier_id);
    expect(etat).toMatchObject({ controles_ok: true, statut: "en_revue", remplace_id: idEtat });
  });

  it("le journal ne contient ni texte, ni extrait, ni montant", async () => {
    const lignes = await proprietaire(
      async (c) =>
        (
          await c.query(
            `SELECT action, entite, details::text AS details FROM journal_audit
             WHERE cabinet_id = $1 AND (entite IN ('ingestion_document', 'dossier_etat_financier')
                OR (entite = 'fichier' AND details->>'ingestion' = 'true'))`,
            [a.cabinetId],
          )
        ).rows,
    );
    expect(lignes.length).toBeGreaterThan(5);
    const tout = JSON.stringify(lignes);
    for (const interdit of [
      "ENTREPRISE",
      "Terrains",
      "Capital",
      "1200000",
      "1 200 000",
      "16550000",
    ]) {
      expect(tout).not.toContain(interdit);
    }
    expect(lignes.map((l: any) => l.action)).toEqual(
      expect.arrayContaining(["ingestion.creer", "ingestion.terminer", "import"]),
    );
  });
});

describe("PDF avec l'IA (serveur OpenRouter factice local)", () => {
  it("lignes correctes et équilibrées : acceptation automatique ; texte encadré comme donnée non fiable", async () => {
    ctx.serveur.repondre(() => reponseLignes(LIGNES_IA_LIASSE));
    const avant = ctx.serveur.requetes.length;
    const { document } = await ingerer(ctx, b.directeur, b.clientId, "liasse-ia.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    expect(ctx.serveur.requetes.length).toBe(avant + 1);
    expect(document).toMatchObject({ statut: "termine", resultat: "etat_cree" });
    const etat = await etatDe(b.directeur, b.clientId, document.etat_financier_id);
    expect(etat).toMatchObject({ origine: "pdf", statut: "accepte", controles_ok: true });
    expect(etat.decision.automatique).toBe(true);
    expect(etat.lignes).toHaveLength(LIGNES_IA_LIASSE.length);
    expect(etat.lignes.every((l: any) => typeof l.reference.page === "number")).toBe(true);
    // AGT-07 : le texte du document est dans le message utilisateur, encadré ; jamais dans les consignes.
    const demande = ctx.serveur.requetes[avant]!.corps.messages!;
    const systeme = demande
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const utilisateur = demande
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    expect(utilisateur).toContain("[[PAGE 1]]");
    expect(utilisateur).toContain("Terrains");
    expect(systeme).not.toContain("Terrains");
    expect(systeme).not.toContain("ENTREPRISE EXEMPLE");
    // Aucun coût dans les réponses (FIN-02).
    expect(JSON.stringify(document)).not.toMatch(/cout|micro_usd/i);
    expect(JSON.stringify(etat)).not.toMatch(/cout_|micro_usd/i);
  });

  it("un montant altéré par le modèle : ligne rejetée, état en revue, jamais accepté", async () => {
    const alteree = LIGNES_IA_LIASSE.map((l) =>
      l.includes("| BK |") ? l.replace("15 000 000", "15 000 001") : l,
    );
    ctx.serveur.repondre(() => reponseLignes(alteree));
    const { document } = await ingerer(ctx, b.directeur, b.clientId, "altere.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    expect(document.resultat).toBe("etat_cree");
    const etat = await etatDe(b.directeur, b.clientId, document.etat_financier_id);
    expect(etat.statut).toBe("en_revue");
    expect(etat.decision).toBeNull();
    expect(etat.lignes.map((l: any) => l.code)).not.toContain("BK");
  });

  it("un montant absent de la page citée est rejeté de même (page erronée)", async () => {
    const mauvaisePage = LIGNES_IA_LIASSE.map((l) =>
      l.includes("| TA |") ? l.replace(/^2/, "1") : l,
    );
    ctx.serveur.repondre(() => reponseLignes(mauvaisePage));
    const { document } = await ingerer(ctx, b.directeur, b.clientId, "page.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    const etat = await etatDe(b.directeur, b.clientId, document.etat_financier_id);
    expect(etat.statut).toBe("en_revue");
    expect(etat.lignes.map((l: any) => l.code)).not.toContain("TA");
  });

  it("sortie inexploitable ou sans ligne retenue : repli sur les règles déterministes", async () => {
    ctx.serveur.repondre(() => ({ contenu: "pas du JSON" }));
    const avant = ctx.serveur.requetes.length;
    const r1 = await ingerer(ctx, b.directeur, b.clientId, "repli1.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    expect(ctx.serveur.requetes.length).toBeGreaterThan(avant);
    const e1 = await etatDe(b.directeur, b.clientId, r1.document.etat_financier_id);
    expect(e1).toMatchObject({ statut: "accepte", source_libelle: "Extraction PDF : repli1.pdf" });
    expect(e1.lignes).toHaveLength(15); // lignes des règles (codes générés pour les totaux)

    ctx.serveur.repondre(() =>
      reponseLignes(["ceci n'est pas une ligne", "9 | actif | X | | | Poste | 12"]),
    );
    const r2 = await ingerer(ctx, b.directeur, b.clientId, "repli2.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    const e2 = await etatDe(b.directeur, b.clientId, r2.document.etat_financier_id);
    expect(e2.lignes).toHaveLength(15);
    expect(e2.statut).toBe("accepte");
  });

  it("échec du fournisseur (500) : repli sur les règles", async () => {
    ctx.serveur.repondre(() => ({ statut: 500, brut: "{}" }));
    const { document } = await ingerer(ctx, b.directeur, b.clientId, "panne-ia.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    expect(document).toMatchObject({ statut: "termine", resultat: "etat_cree" });
  });

  it("utilisateur sans ia.utiliser : aucun appel au fournisseur (règles déterministes)", async () => {
    const avant = ctx.serveur.requetes.length;
    const auth = await authDe(ctx, b.cabinetId, b.directeur.utilisateurId);
    const r = await demanderLignesIa({
      database: ctx.db,
      deps: ctx.deps.ia,
      auth: { ...auth, roles: ["ressources"] },
      promptNom: NOM_PROMPT_ETAT_LIGNES,
      assurerPrompt: assurerPromptEtat,
      variables: { contexte: "x", pages: "[[PAGE 1]]\ntexte" },
      variablesNonFiables: ["pages"],
      entite: { type: "ingestion_document", id: "00000000-0000-4000-8000-000000000001" },
    });
    expect(r).toEqual({ lignes: null, demandeId: null, chiffresNonVerifiesIa: false });
    expect(ctx.serveur.requetes.length).toBe(avant);
  });
});

describe("Excel (liasse à lignes libres)", () => {
  it("règles seules, jamais d'IA : références de cellule et de ligne", async () => {
    ctx.serveur.repondre(() => reponseLignes([]));
    const avant = ctx.serveur.requetes.length;
    const { document } = await ingerer(
      ctx,
      b.directeur,
      b.clientId,
      "liasse.xlsx",
      await fabriquerXlsx(LIASSE_XLSX),
      { exercice: exo() },
    );
    expect(ctx.serveur.requetes.length).toBe(avant); // même cabinet IA activé : pas d'appel pour Excel
    expect(document).toMatchObject({
      format: "xlsx",
      methode: "tableur",
      nb_pages: 1,
      statut: "termine",
      resultat: "etat_cree",
    });
    const etat = await etatDe(b.directeur, b.clientId, document.etat_financier_id);
    expect(etat).toMatchObject({
      origine: "excel",
      statut: "accepte",
      source_libelle: "Extraction Excel (liasse) : liasse.xlsx",
    });
    const par = lignesParCode(etat);
    expect(par.AD.reference).toEqual({ fichier: "liasse.xlsx", cellule: "C3", ligne: 3 });
    expect(par.BK.reference).toEqual({ fichier: "liasse.xlsx", cellule: "C4", ligne: 4 });
    expect(par.TA.reference.cellule).toBe("C15");
    expect(etat.lignes.every((l: any) => /^[A-Z]+[0-9]+$/.test(l.reference.cellule))).toBe(true);
  });

  it("classeur sans poste lisible : document terminé, rien trouvé, aucun état", async () => {
    const { document } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "vide.xlsx",
      await fabriquerXlsx([["Note de synthèse"], ["Rien de chiffré ici"]]),
      { exercice: exo() },
    );
    expect(document).toMatchObject({
      statut: "termine",
      resultat: "rien_trouve",
      etat_financier_id: null,
    });
  });
});

describe("PDF scanné : OCR simulé", () => {
  const scanne = (variante: "equilibree" | "desequilibree" = "equilibree") =>
    fabriquerPdf({
      nbPages: 2,
      ocr: {
        pages: [
          {
            numero: 1,
            texte: (variante === "equilibree"
              ? LIASSE_PAGE_1
              : LIASSE_PAGE_1.map((l) =>
                  l.startsWith("DZ ") ? "DZ TOTAL PASSIF 16 000 000 16 300 000" : l,
                )
            ).join("\n"),
            confiance_pm: 910,
          },
          { numero: 2, texte: LIASSE_PAGE_2.join("\n"), confiance_pm: 640 },
        ],
      },
    });

  it("états lus par OCR : confiance par page, jamais d'acceptation automatique", async () => {
    const { document } = await ingerer(ctx, a.directeur, a.clientId, "scan.pdf", scanne(), {
      exercice: exo(),
    });
    expect(document).toMatchObject({
      statut: "termine",
      resultat: "etat_cree",
      methode: "ocr_simule",
    });
    expect(document.pages.map((p: any) => [p.methode, p.confiance_pm])).toEqual([
      ["ocr_simule", 910],
      ["ocr_simule", 640],
    ]);
    const etat = await etatDe(a.directeur, a.clientId, document.etat_financier_id);
    expect(etat.controles_ok).toBe(true); // équilibré…
    expect(etat).toMatchObject({ origine: "pdf", statut: "en_revue", decision: null }); // …mais OCR : revue
  });

  it("sans OCR branché (production) : PDF_SANS_TEXTE, aucun état", async () => {
    const ocr = ctx.deps.ocr;
    ctx.deps.ocr = null;
    try {
      const { document } = await ingerer(ctx, a.directeur, a.clientId, "scan2.pdf", scanne(), {
        exercice: exo(),
      });
      expect(document).toMatchObject({
        statut: "echec",
        erreur_code: "PDF_SANS_TEXTE",
        etat_financier_id: null,
        resultat: null,
      });
      expect(document.erreur).toMatch(/scanné/);
    } finally {
      ctx.deps.ocr = ocr;
    }
  });

  it("OCR simulé et PDF sans conteneur de test : OCR_NON_SIMULE", async () => {
    const { document } = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "scan3.pdf",
      fabriquerPdf({ nbPages: 2 }),
      {
        exercice: exo(),
      },
    );
    expect(document).toMatchObject({ statut: "echec", erreur_code: "OCR_NON_SIMULE" });
  });
});

describe("échecs définitifs et reprises", () => {
  it("PDF illisible, plafond de pages", async () => {
    const illisible = await ingerer(ctx, a.directeur, a.clientId, "casse.pdf", pdfIllisible(), {
      exercice: exo(),
    });
    expect(illisible.document).toMatchObject({ statut: "echec", erreur_code: "PDF_ILLISIBLE" });
    expect(illisible.document.erreur).toBe("Le PDF est illisible ou protégé.");
    const gros = await ingerer(
      ctx,
      a.directeur,
      a.clientId,
      "long.pdf",
      fabriquerPdf({ nbPages: 61 }),
      {
        exercice: exo(),
      },
    );
    expect(gros.document).toMatchObject({
      statut: "echec",
      erreur_code: "PLAFOND_PAGES",
      nb_pages: null,
    });
    expect(await objetsStockes(ctx, a.cabinetId)).toBe(0); // objet effacé même en cas d'échec
  });

  it("fichier disparu du stockage : FICHIER_ABSENT", async () => {
    const { rm, readdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const r = await televerserEtat(a.directeur, a.clientId, "perdu.pdf", pdfLiasse(), {
      exercice: exo(),
    });
    attendre(202, r, "téléversement");
    const parcourir = async (d: string): Promise<string[]> => {
      const sortie: string[] = [];
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) sortie.push(...(await parcourir(p)));
        else sortie.push(p);
      }
      return sortie;
    };
    for (const f of await parcourir(path.join(ctx.dossier, a.cabinetId))) await rm(f);
    await executerJobs(ctx);
    const d = await a.directeur.get(`/api/dossiers/${a.clientId}/ingestions/${r.json().id}`);
    expect(d.json()).toMatchObject({ statut: "echec", erreur_code: "FICHIER_ABSENT" });
  });

  it("date de clôture hors exercice : 400 avant tout stockage", async () => {
    const avant = await objetsStockes(ctx, a.cabinetId);
    const r = await televerserEtat(a.directeur, a.clientId, "date.pdf", pdfLiasse(), {
      exercice: 2020,
      date_cloture: "2023-12-31",
    });
    expect(r.statusCode).toBe(400);
    expect(await objetsStockes(ctx, a.cabinetId)).toBe(avant);
  });

  it("panne passagère : le job est repris puis le document échoue ERREUR_INTERNE sans message de bibliothèque", async () => {
    const ocr = ctx.deps.ocr;
    ctx.deps.ocr = {
      fournisseur: "panne",
      mode: "simule",
      reconnaitre: async () => {
        throw new Error("SECRET interne de la bibliothèque");
      },
    };
    try {
      const r = await televerserEtat(
        a.directeur,
        a.clientId,
        "panne.pdf",
        fabriquerPdf({ nbPages: 1 }),
        { exercice: exo() },
      );
      attendre(202, r, "téléversement");
      const url = `/api/dossiers/${a.clientId}/ingestions/${r.json().id}`;
      const t0 = Date.now();
      const statuts = async (quand: number) =>
        (await executerJobs(ctx, new Date(quand)))
          .filter((x) => x.type.startsWith("ingestion"))
          .map((x) => x.statut);
      expect(await statuts(t0)).toEqual(["reessai"]);
      expect((await a.directeur.get(url)).json().statut).toBe("en_file"); // transaction annulée
      expect(await statuts(t0 + 61_000)).toEqual(["reessai"]);
      expect(await statuts(t0 + 200_000)).toEqual(["termine"]);
      const d = (await a.directeur.get(url)).json();
      expect(d).toMatchObject({ statut: "echec", erreur_code: "ERREUR_INTERNE" });
      expect(JSON.stringify(d)).not.toContain("SECRET");
    } finally {
      ctx.deps.ocr = ocr;
    }
  });

  it("auteur devenu inactif avant la structuration : UTILISATEUR_INACTIF", async () => {
    const u = await a.avecRoles(["directeur_mission"]);
    const r = await televerserEtat(u, a.clientId, "inactif.pdf", pdfLiasse(), { exercice: exo() });
    attendre(202, r, "téléversement");
    // L'extraction a lieu, puis l'auteur est désactivé avant la structuration.
    const { WorkerJobs } = await import("../src/jobs/worker.js");
    const { registreIngestion } = await import("./ingestion-outils.js");
    const worker = new WorkerJobs(ctx.db, {
      mailer: ctx.app.mailer as never,
      registre: registreIngestion(ctx),
      horloge: () => new Date(),
    });
    const jusqua = async (type: string) => {
      for (let i = 0; i < 30; i++) {
        const t = (await worker.traiterUn())?.type;
        if (t === type) return;
        if (t === undefined) break;
      }
      throw new Error(`Job ${type} non exécuté.`);
    };
    await jusqua("ingestion_extraction");
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [u.utilisateurId]),
    );
    await jusqua("ingestion_structuration");
    const d = await proprietaire(
      async (c) =>
        (
          await c.query("SELECT statut, erreur_code FROM ingestion_documents WHERE id = $1", [
            r.json().id,
          ])
        ).rows[0],
    );
    expect(d).toEqual({ statut: "echec", erreur_code: "UTILISATEUR_INACTIF" });
  });

  it("la liste est paginée, la plus récente d'abord", async () => {
    const page1 = (await a.directeur.get(`/api/dossiers/${a.clientId}/ingestions?limite=2`)).json();
    expect(page1.elements).toHaveLength(2);
    expect(page1.curseur_suivant).toEqual(expect.any(String));
    const page2 = (
      await a.directeur.get(
        `/api/dossiers/${a.clientId}/ingestions?limite=2&curseur=${page1.curseur_suivant}`,
      )
    ).json();
    expect(page2.elements.length).toBeGreaterThan(0);
    const ids = [...page1.elements, ...page2.elements].map((e: any) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(page1.elements[0].cree_le >= page1.elements[1].cree_le).toBe(true);
    expect(Object.keys(page1.elements[0]).sort()).toEqual(
      [
        "cree_le",
        "cree_par",
        "erreur",
        "erreur_code",
        "etat_financier_id",
        "format",
        "id",
        "methode",
        "nb_caracteres",
        "nb_pages",
        "nom",
        "parametres",
        "resultat",
        "statut",
        "taille",
        "termine_le",
        "texte_purge_le",
        "usage",
      ].sort(),
    );
  });
});
