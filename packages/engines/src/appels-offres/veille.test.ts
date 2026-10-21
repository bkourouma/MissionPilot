import { describe, expect, it } from "vitest";
import { ErreurAppelsOffres } from "./commun";
import {
  rapprocherVeille,
  veilleAnalyserImport,
  veilleCleDedoublonnage,
  veilleDedoublonner,
  veilleProfilCabinet,
  VEILLE_IMPORT_AVIS_MAX,
  VEILLE_IMPORT_OCTETS_MAX,
  type VeilleAvisBrut,
  type VeilleProfil,
} from "./veille";

const avis = (extra: Partial<VeilleAvisBrut> = {}): VeilleAvisBrut => ({
  reference: null,
  titre: "Audit du contrôle interne",
  objet: null,
  bailleur: null,
  pays: null,
  secteur: null,
  montant_estime: null,
  devise: null,
  date_publication: null,
  date_limite: null,
  url: null,
  mots_cles: [],
  ...extra,
});

describe("analyse CSV", () => {
  it("BOM, séparateur point-virgule, en-têtes français, guillemets et retours internes", () => {
    const csv =
      "﻿Référence;Intitulé;Objet;Pays;Montant estimé;Devise;Date limite;Mots-clés\r\n" +
      'AO-1;"Audit ""interne""";"ligne 1\nligne 2";ci;1 500 000;eur;31/12/2099;risques|contrôle\r\n' +
      "\r\n";
    const r = veilleAnalyserImport(csv);
    expect(r.format).toBe("csv");
    expect(r.erreurs).toEqual([]);
    expect(r.avis).toHaveLength(1);
    expect(r.avis[0]).toMatchObject({
      reference: "AO-1",
      titre: 'Audit "interne"',
      objet: "ligne 1\nligne 2",
      pays: "CI",
      montant_estime: 1_500_000,
      devise: "EUR",
      date_limite: "2099-12-31",
      mots_cles: ["risques", "contrôle"],
    });
  });

  it("séparateur virgule, en-têtes techniques, dernière ligne sans retour", () => {
    const r = veilleAnalyserImport(
      "reference,title,date_limite,url,keywords\nX1,Titre,2099-01-02,https://exemple.org/a,a;b",
    );
    expect(r.erreurs).toEqual([]);
    expect(r.avis[0]).toMatchObject({ reference: "X1", url: "https://exemple.org/a" });
    expect(r.avis[0]?.mots_cles).toEqual(["a", "b"]);
  });

  it("signale les erreurs par ligne sans bloquer les lignes valides", () => {
    const r = veilleAnalyserImport(
      [
        "titre;pays;montant;devise;date limite;url;mots cles",
        "Ok;SN;;;;;",
        ";CI;;;;;",
        "Mauvais pays;SEN;;;;;",
        "Montant;CI;12,5;;;;",
        "Devise;CI;;GBP;;;",
        "Date;CI;;;2099-02-30;;",
        "Date 2;CI;;;01/01/1999;;",
        "Url;CI;;;;javascript:alert(1);",
        `Mots;CI;;;;;${Array.from({ length: 31 }, (_, i) => `m${i}`).join("|")}`,
      ].join("\n"),
    );
    expect(r.avis.map((a) => a.titre)).toEqual(["Ok"]);
    expect(r.erreurs.map((e) => e.ligne)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.erreurs[0]?.message).toBe("Titre obligatoire.");
  });

  it("colonne titre absente, guillemet non refermé, texte vide", () => {
    expect(veilleAnalyserImport("a;b\n1;2").erreurs[0]?.message).toMatch(/titre/);
    expect(veilleAnalyserImport('titre\n"abc').erreurs[0]?.message).toMatch(/Guillemet/);
    expect(veilleAnalyserImport("").erreurs).toHaveLength(1);
  });

  it("neutralise les caractères de contrôle et n'exécute rien", () => {
    const r = veilleAnalyserImport('titre\n=HYPERLINK("x")\u0007');
    expect(r.avis[0]?.titre).toBe('=HYPERLINK("x")');
  });
});

describe("analyse JSON", () => {
  it("liste, enveloppe { avis } et clés techniques ou françaises", () => {
    const a = veilleAnalyserImport(
      JSON.stringify([{ titre: "T", "Date limite": "2099-05-05", mots_cles: ["a", "a", " b "] }]),
    );
    expect(a.format).toBe("json");
    expect(a.avis[0]).toMatchObject({ date_limite: "2099-05-05", mots_cles: ["a", "b"] });
    const b = veilleAnalyserImport('﻿{"avis":[{"titre":"U","montant_estime":1200}]}');
    expect(b.avis[0]?.montant_estime).toBe(1200);
  });

  it("erreurs : JSON invalide, forme inattendue, élément non objet, valeur non scalaire", () => {
    expect(veilleAnalyserImport("[1,").erreurs[0]?.message).toBe("JSON invalide.");
    expect(veilleAnalyserImport('{"x":1}').erreurs[0]?.message).toMatch(/liste d'avis/);
    const r = veilleAnalyserImport(
      JSON.stringify([
        1,
        { titre: { a: 1 } },
        { titre: "ok", mots_cles: 5 },
        { titre: "ok2", __proto__: { x: 1 }, inconnu: "ignoré" },
      ]),
      "json",
    );
    expect(r.erreurs.map((e) => e.ligne)).toEqual([1, 2, 3]);
    expect(r.avis.map((a) => a.titre)).toEqual(["ok2"]);
  });
});

describe("plafonds", () => {
  it("refuse plus de 200 avis (JSON et CSV) et plus de 1 Mo", () => {
    const json = JSON.stringify(
      Array.from({ length: VEILLE_IMPORT_AVIS_MAX + 1 }, () => ({ titre: "t" })),
    );
    expect(() => veilleAnalyserImport(json)).toThrow(ErreurAppelsOffres);
    const csv = ["titre", ...Array.from({ length: VEILLE_IMPORT_AVIS_MAX + 1 }, () => "t")].join(
      "\n",
    );
    expect(() => veilleAnalyserImport(csv)).toThrow(/Trop d'avis/);
    expect(() => veilleAnalyserImport("a".repeat(VEILLE_IMPORT_OCTETS_MAX + 1))).toThrow(
      /volumineux/,
    );
    const ok = ["titre", ...Array.from({ length: VEILLE_IMPORT_AVIS_MAX }, () => "t")].join("\n");
    expect(veilleAnalyserImport(ok).avis).toHaveLength(VEILLE_IMPORT_AVIS_MAX);
  });
});

describe("clé de dédoublonnage", () => {
  it("référence : casse, accents, ponctuation et espaces neutralisés", () => {
    const a = veilleCleDedoublonnage(avis({ reference: "AO/2026-é 01" }));
    expect(veilleCleDedoublonnage(avis({ reference: "ao 2026 e 01", titre: "Autre" }))).toBe(a);
    expect(a.startsWith("ref:")).toBe(true);
  });

  it("sans référence : titre + bailleur + date limite", () => {
    const a = veilleCleDedoublonnage(
      avis({
        titre: "Audit, du CONTRÔLE interne!",
        bailleur: "Banque Mondiale",
        date_limite: "2099-01-01",
      }),
    );
    expect(
      veilleCleDedoublonnage(
        avis({
          titre: "audit du controle interne",
          bailleur: "banque mondiale",
          date_limite: "2099-01-01",
        }),
      ),
    ).toBe(a);
    expect(
      veilleCleDedoublonnage(
        avis({
          titre: "audit du controle interne",
          bailleur: "banque mondiale",
          date_limite: "2099-01-02",
        }),
      ),
    ).not.toBe(a);
    expect(veilleCleDedoublonnage({ titre: "x" })).toBe("titre:x||");
  });

  it("dédoublonne contre les clés connues et dans le lot", () => {
    const connue = veilleCleDedoublonnage(avis({ reference: "K1" }));
    const entrees = veilleDedoublonner(
      [avis({ reference: "k-1" }), avis({ reference: "N1" }), avis({ reference: "n 1" })],
      new Set([connue]),
    );
    expect(entrees.map((e) => e.etat)).toEqual(["connu", "nouveau", "repete"]);
    expect(entrees.map((e) => e.rang)).toEqual([0, 1, 2]);
  });
});

const profil: VeilleProfil = {
  base: {
    competences: ["Contrôle interne"],
    secteurs: ["Santé"],
    references: [{ secteur: "Santé", pays: "CI", bailleur: "Banque mondiale" }],
  },
  competencesMatrice: ["Gestion des risques"],
  referencesBanque: [
    { secteur: "Santé", pays: "SN", bailleur: "AFD" },
    { secteur: "Éducation", pays: "CI", bailleur: null },
  ],
};

describe("rapprochement expliqué", () => {
  const bon = avis({
    titre: "Audit du contrôle interne et gestion des risques",
    secteur: "Santé",
    pays: "CI",
    bailleur: "Banque mondiale",
  });

  it("score du moteur existant + raisons françaises, matrice et banque", () => {
    const r = rapprocherVeille(bon, profil);
    expect(r.score).toBeGreaterThan(50);
    expect(r.competencesTrouvees).toEqual(["Contrôle interne", "Gestion des risques"]);
    expect(r.competencesMatriceTrouvees).toEqual(["Gestion des risques"]);
    expect(r.referencesBanque).toEqual({ secteur: 1, pays: 1, bailleur: 0 });
    const texte = r.raisons.join(" | ");
    expect(texte).toContain("Secteur « Santé » déjà couvert");
    expect(texte).toContain("2 références dans le même pays (CI)");
    expect(texte).toContain("2 compétences retrouvées : Contrôle interne, Gestion des risques");
    expect(texte).toContain("validées dans la matrice de compétences : Gestion des risques");
    expect(texte).toContain(
      "Références de la banque : 1 dans le même secteur, 1 dans le même pays",
    );
    expect(texte).toContain("Bailleur « Banque mondiale »");
  });

  it("déterministe et sans mutation", () => {
    const copie = JSON.stringify(profil);
    expect(rapprocherVeille(bon, profil)).toEqual(rapprocherVeille(bon, profil));
    expect(JSON.stringify(profil)).toBe(copie);
  });

  it("aucun point commun, secteur ou pays absents de l'avis", () => {
    const r = rapprocherVeille(avis({ titre: "Zzz", secteur: "Mines", pays: "ML" }), profil);
    expect(r.score).toBe(0);
    expect(r.raisons).toEqual([
      "Secteur « Mines » absent des secteurs et références du cabinet.",
      "Aucune référence dans le pays (ML).",
      "Aucune compétence du cabinet retrouvée dans l'avis.",
    ]);
    const vide = rapprocherVeille(avis({ titre: "Zzz" }), profil);
    expect(vide.raisons).toEqual([
      "Secteur non renseigné dans l'avis.",
      "Aucune compétence du cabinet retrouvée dans l'avis.",
    ]);
  });

  it("une seule référence ou compétence : singulier ; bailleur de la banque", () => {
    const p: VeilleProfil = {
      base: { competences: [], secteurs: [], references: [] },
      competencesMatrice: ["Audit"],
      referencesBanque: [{ secteur: null, pays: "CI", bailleur: "AFD" }],
    };
    const r = rapprocherVeille(avis({ titre: "Audit", pays: "CI", bailleur: "AFD" }), p);
    const texte = r.raisons.join(" | ");
    expect(texte).toContain("1 référence dans le même pays");
    expect(texte).toContain("1 compétence retrouvée : Audit");
    expect(texte).toContain("1 avec le même bailleur");
  });

  it("profil fusionné : compétences et références cumulées", () => {
    const p = veilleProfilCabinet(profil);
    expect(p.competences).toEqual(["Contrôle interne", "Gestion des risques"]);
    expect(p.references).toHaveLength(3);
  });
});
