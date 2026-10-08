import path from "node:path";
import type { Role } from "@missionpilot/shared";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { loadConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import {
  LONGUEUR_PARTIE_SOUS_TITRE,
  sousTitreRapport,
  tronquer,
} from "../src/rapports/etat-avancement.js";
import { echapper, rapportEnHtml } from "../src/rapports/html.js";
import { nettoyerTexte, normaliserRapport, PLAFONDS_MODELE } from "../src/rapports/modele.js";
import {
  niveauDesSections,
  niveauxLisibles,
  peutLireNiveau,
  type NiveauRapport,
} from "../src/rapports/niveaux.js";
import { cheminNavigateur } from "../src/rapports/pdf.js";
import { rendreRapport } from "../src/rapports/rendu.js";
import { detecterType } from "../src/stockage/detection.js";
import {
  dezipper,
  INJECTION,
  rapportExemple,
  toutLeXml,
  xml,
  xmlBienForme,
} from "./rapports-outils.js";

const sansNavigateur = { cheminNavigateur: null, cabinetId: null };
const avecInjection = () =>
  rapportExemple({
    titre: `Titre ${INJECTION}`,
    emetteur: `Cabinet ${INJECTION}`,
    sections: [
      {
        titre: `Section ${INJECTION}`,
        blocs: [
          { type: "paragraphe", texte: `Paragraphe ${INJECTION}` },
          { type: "liste", elements: [`Liste ${INJECTION}`] },
          { type: "indicateurs", elements: [{ libelle: `Ind ${INJECTION}`, valeur: INJECTION }] },
          { type: "tableau", colonnes: [`Col ${INJECTION}`], lignes: [[`Cellule ${INJECTION}`]] },
        ],
      },
    ],
  });

describe("modèle de contenu (SOC-07)", () => {
  it("retire caractères de contrôle et mise en forme bidirectionnelle ; garde les sauts de ligne", () => {
    expect(nettoyerTexte("a\u0000b\u0007c\u202ed\u200be\ufefff\r\ng\u2028h")).toBe("abcdef\ngh");
    expect(nettoyerTexte("é composé : e\u0301")).toBe("é composé : é");
  });

  it("structure stricte et plafonds : champ inconnu, tableau incohérent, dépassements refusés", () => {
    expect(() => normaliserRapport({ ...rapportExemple(), script: "x" })).toThrow(ZodError);
    const incoherent = rapportExemple({
      sections: [
        { titre: "S", blocs: [{ type: "tableau", colonnes: ["A", "B"], lignes: [["1"]] }] },
      ],
    });
    expect(() => normaliserRapport(incoherent)).toThrow(ZodError);
    const long = rapportExemple({
      sections: [
        {
          titre: "S",
          blocs: [{ type: "paragraphe", texte: "x".repeat(PLAFONDS_MODELE.longueurTexte + 1) }],
        },
      ],
    });
    expect(() => normaliserRapport(long)).toThrow(ZodError);
    const trop = rapportExemple({
      sections: Array.from({ length: PLAFONDS_MODELE.sections + 1 }, () => ({
        titre: "S",
        blocs: [],
      })),
    });
    expect(() => normaliserRapport(trop)).toThrow(ZodError);
    expect(() => normaliserRapport({ ...rapportExemple(), statut: "publie" })).toThrow(ZodError);
  });
});

describe("rendu HTML (base du PDF)", () => {
  it("échappe tout texte : aucune balise ni attribut issu des données", () => {
    expect(echapper(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;&#47;a&gt;",
    );
    const html = rapportEnHtml(normaliserRapport(avecInjection()));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<[^>]*onerror/i);
    expect(html).toContain("&lt;script&gt;");
    // Seules balises : celles du gabarit.
    const balises = new Set(
      [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1]?.toLowerCase()),
    );
    for (const b of balises) {
      expect([
        "html",
        "head",
        "meta",
        "title",
        "style",
        "body",
        "h1",
        "h2",
        "h3",
        "p",
        "div",
        "section",
        "ul",
        "li",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "br",
      ]).toContain(b);
    }
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'none'");
  });

  it("mention du statut : brouillon par défaut, validé, confidentiel", () => {
    expect(rapportEnHtml(normaliserRapport(rapportExemple()))).toContain("Brouillon");
    const v = rapportEnHtml(
      normaliserRapport(rapportExemple({ statut: "valide", confidentiel: true })),
    );
    expect(v).toContain("Validé");
    expect(v).toContain("Confidentiel");
  });
});

describe("rendu DOCX", () => {
  it("archive Office valide, XML bien formé, contenu présent, type détecté par le stockage", async () => {
    const { contenu } = await rendreRapport(rapportExemple(), "docx", sansNavigateur);
    const e = dezipper(contenu);
    const doc = xml(e, "word/document.xml");
    expect(xmlBienForme(doc)).toBe(true);
    expect(doc).toContain("Seconde ligne");
    expect(doc).toContain("Phase 25");
    expect(doc).toContain("Brouillon");
    expect(toutLeXml(e)).toMatch(/PAGE/); // champ numéro de page (pied)
    expect(xml(e, "word/footer1.xml")).toContain("NUMPAGES");
    expect(xml(e, "[Content_Types].xml")).toContain("wordprocessingml");
    // Format A4 (twips).
    expect(doc).toMatch(/w:w="11906"/);
    expect(doc).toMatch(/w:h="16838"/);
    // Aucune macro ni objet embarqué ; accepté par la détection du stockage.
    expect([...e.keys()].some((n) => /vbaProject|embeddings\/.+\.bin/.test(n))).toBe(false);
    expect(detecterType(contenu, "docx").type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("injection : le texte reste du texte (XML échappé, bien formé)", async () => {
    const { contenu } = await rendreRapport(avecInjection(), "docx", sansNavigateur);
    const e = dezipper(contenu);
    const doc = xml(e, "word/document.xml");
    expect(xmlBienForme(doc)).toBe(true);
    expect(xmlBienForme(xml(e, "word/header1.xml"))).toBe(true);
    expect(toutLeXml(e)).not.toContain("<script>");
    expect(doc).toContain("&lt;script&gt;");
    expect(doc).not.toContain("</w:t></a:t>");
  });
});

describe("rendu PPTX", () => {
  it("archive Office valide, une diapositive de titre puis sections, tableaux paginés", async () => {
    const { contenu } = await rendreRapport(rapportExemple(), "pptx", sansNavigateur);
    const e = dezipper(contenu);
    expect(xml(e, "[Content_Types].xml")).toContain("presentationml");
    const diapos = [...e.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    // titre + synthèse (texte) + synthèse (indicateurs) + 3 pages de 11 lignes pour 25 lignes
    expect(diapos).toHaveLength(6);
    for (const d of diapos) expect(xmlBienForme(xml(e, d))).toBe(true);
    const tout = toutLeXml(e);
    expect(tout).toContain("Phase 25");
    expect(tout).toContain("(suite)");
    expect(tout).toContain("Brouillon");
    expect(detecterType(contenu, "pptx").type).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  it("injection : texte échappé dans les diapositives et les propriétés", async () => {
    const { contenu } = await rendreRapport(avecInjection(), "pptx", sansNavigateur);
    const e = dezipper(contenu);
    const tout = toutLeXml(e);
    expect(tout).not.toContain("<script>");
    expect(tout).not.toContain("</w:t></a:t>");
    for (const [nom, c] of e) {
      if (nom.endsWith(".xml")) expect(xmlBienForme(c.toString("utf8")), nom).toBe(true);
    }
    expect(xml(e, "docProps/core.xml")).toContain("&lt;script&gt;");
  });
});

describe("garde-fous du rendu", () => {
  it("plafond de taille : 413 au-delà", async () => {
    await expect(
      rendreRapport(rapportExemple(), "docx", { ...sansNavigateur, plafondOctets: 1000 }),
    ).rejects.toMatchObject({ statut: 413, code: "RAPPORT_TROP_VOLUMINEUX" });
  });

  it("PDF sans navigateur configuré : 503 explicite", async () => {
    const erreur = await rendreRapport(rapportExemple(), "pdf", sansNavigateur).catch((e) => e);
    expect(erreur).toBeInstanceOf(AppError);
    expect(erreur).toMatchObject({ statut: 503, code: "RENDU_PDF_INDISPONIBLE" });
  });

  it("navigateur introuvable : 503, sans fuite du chemin", async () => {
    const erreur = await rendreRapport(rapportExemple(), "pdf", {
      cheminNavigateur: "Z:\\absent\\chrome.exe",
      cabinetId: null,
    }).catch((e) => e);
    expect(erreur).toMatchObject({ statut: 503, code: "RENDU_PDF_INDISPONIBLE" });
    expect(String(erreur.message)).not.toContain("absent");
  });
});

describe("CHROMIUM_PATH (configuration, non-régression : plus de lecture directe de l'environnement)", () => {
  it("chemin du navigateur lu dans la configuration ; rien en production sans variable", () => {
    expect(cheminNavigateur({ NODE_ENV: "test", CHROMIUM_PATH: "/opt/chromium" })).toBe(
      "/opt/chromium",
    );
    expect(cheminNavigateur({ NODE_ENV: "production" })).toBeNull();
    expect(cheminNavigateur({ NODE_ENV: "production", CHROMIUM_PATH: undefined })).toBeNull();
  });

  it("loadConfig : facultative ; absolue et existante si fournie (sans citer la valeur)", () => {
    const env = { NODE_ENV: "test" };
    expect(loadConfig({ ...env }).CHROMIUM_PATH).toBeUndefined();
    expect(loadConfig({ ...env, CHROMIUM_PATH: "" }).CHROMIUM_PATH).toBeUndefined();
    // Un exécutable qui existe à coup sûr : celui de Node.
    expect(loadConfig({ ...env, CHROMIUM_PATH: process.execPath }).CHROMIUM_PATH).toBe(
      process.execPath,
    );
    expect(() => loadConfig({ ...env, CHROMIUM_PATH: "chrome-relatif" })).toThrow(/CHROMIUM_PATH/);
    const absent = path.join(path.dirname(process.execPath), "navigateur-absent-xyz");
    const erreur = (() => {
      try {
        loadConfig({ ...env, CHROMIUM_PATH: absent });
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(erreur?.message).toMatch(/CHROMIUM_PATH/);
    expect(erreur?.message).not.toContain("navigateur-absent-xyz");
  });
});

describe("sous-titre et textes saisis (non-régression : plafond du titre jamais dépassé)", () => {
  it("intitulé et client de 200 caractères : sous-titre tronqué « … », rapport accepté", () => {
    const st = sousTitreRapport("i".repeat(200), "c".repeat(200));
    expect(st.length).toBeLessThanOrEqual(PLAFONDS_MODELE.longueurTitre);
    expect(st).toBe(`${"i".repeat(89)}… — ${"c".repeat(89)}…`);
    expect(() => normaliserRapport(rapportExemple({ sous_titre: st }))).not.toThrow();
    // Textes courts : inchangés.
    expect(sousTitreRapport("Plan", "Client")).toBe("Plan — Client");
  });

  it("coupe sans briser une paire de substitution ; NFC appliqué avant la coupe", () => {
    const emoji = "a".repeat(LONGUEUR_PARTIE_SOUS_TITRE - 2) + "😀😀";
    const t = tronquer(emoji, LONGUEUR_PARTIE_SOUS_TITRE);
    expect(t.length).toBeLessThanOrEqual(LONGUEUR_PARTIE_SOUS_TITRE);
    expect(t).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(t.endsWith("…")).toBe(true);
    // U+FB2C s'allonge en NFC (3 points de code) : la longueur finale reste bornée.
    const allonge = tronquer("\uFB2C".repeat(200), LONGUEUR_PARTIE_SOUS_TITRE);
    expect(allonge.length).toBeLessThanOrEqual(LONGUEUR_PARTIE_SOUS_TITRE);
    expect(nettoyerTexte(allonge).length).toBeLessThanOrEqual(LONGUEUR_PARTIE_SOUS_TITRE);
  });
});

describe("niveaux de rapport (lecture revérifiée par permission)", () => {
  const lit = (roles: Role[], n: NiveauRapport) => peutLireNiveau(roles, n);

  it("base pour tous ; jours avec budget.lire_jours ; finance avec finance.lire (et les jours)", () => {
    expect(lit(["expert_metier"], "base")).toBe(true);
    expect(lit(["expert_metier"], "jours")).toBe(false);
    expect(lit(["expert_metier"], "finance")).toBe(false);
    expect(lit(["chef_mission"], "jours")).toBe(true);
    expect(lit(["chef_mission"], "finance")).toBe(false);
    expect(lit(["directeur_mission"], "finance")).toBe(false);
    expect(lit(["gestionnaire"], "finance")).toBe(true);
    expect(lit(["associe"], "finance")).toBe(true);
    expect(lit(["consultant"], "inconnu" as NiveauRapport)).toBe(false);
    expect(niveauxLisibles(["chef_mission"])).toEqual(["base", "jours"]);
    expect(niveauxLisibles(["expert_metier"])).toEqual(["base"]);
  });

  it("niveau d'un rapport : le plus élevé des sections incluses", () => {
    expect(niveauDesSections(["base", "base"])).toBe("base");
    expect(niveauDesSections(["base", "jours", "base"])).toBe("jours");
    expect(niveauDesSections(["finance", "base"])).toBe("finance");
    expect(niveauDesSections([])).toBe("base");
  });
});
