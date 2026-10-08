import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  droitsBanqueAo,
  hrefListe,
  saisieDepuisOffreFinanciere,
  joursAffiches,
  libelleCritere,
  lireCv,
  lireDiplomes,
  lireExigences,
  lireExperiences,
  lireLangues,
  lireLignesOffre,
  lireNiveauDiplome,
  lireNiveauLangue,
  lireOffreFinanciere,
  lireReference,
  lireSectionsOffre,
  messageBanqueAo,
  moisAffiche,
  requeteReferences,
  saisieDepuisCv,
  sousPagesBanques,
  tonaliteStatutOffre,
  type SaisieCv,
} from "./banque-ao";

const CV: SaisieCv = {
  nom: " Awa Koné ",
  titre: "Expert en finances publiques",
  nationalite: "",
  resume: "Quinze ans d'appui.",
  secteurs: "Finances publiques, Gouvernance",
  competences: "Budget ; Contrôle interne",
  experiences:
    "2010-01 | 2017-12 | Conseiller | Ministère | ci | Finances publiques ; Budget | Banque mondiale\n" +
    "2018-01 | en cours | Chef de mission | Cabinet |  | Gouvernance | ",
  diplomes: "2009 | bac+5 | Master | Gestion publique | Université",
  langues: "Français : maternelle\nAnglais : courant",
};

describe("sous-pages et droits", () => {
  it("l'offre financière n'apparaît qu'avec finance.lire", () => {
    expect(sousPagesBanques(["consultant"]).map((p) => p.id)).toEqual([
      "cv",
      "references",
      "offres-techniques",
    ]);
    expect(sousPagesBanques(["gestionnaire"]).map((p) => p.id)).toContain("offres-financieres");
    expect(sousPagesBanques(["ressources"])).toEqual([]);
  });

  it("droits d'affichage", () => {
    expect(droitsBanqueAo(["consultant"])).toMatchObject({
      lire: true,
      gerer: true,
      lireFinance: false,
      ecrireFinance: false,
      redigerIa: true,
      lierMethode: true,
    });
    expect(droitsBanqueAo(["gestionnaire"])).toMatchObject({
      gerer: false,
      lireFinance: true,
      ecrireFinance: true,
    });
    expect(droitsBanqueAo(["expert_metier"])).toMatchObject({ gerer: false, redigerIa: false });
  });
});

describe("libellés", () => {
  it("mois, jours, statuts, critères", () => {
    expect(moisAffiche("2026-03")).toBe("03/2026");
    expect(moisAffiche(null)).toBe("en cours");
    expect(moisAffiche("x")).toBe("x");
    expect(joursAffiches(1250)).toBe("12,5 j");
    expect(tonaliteStatutOffre("validee")).toBe("succes");
    expect(tonaliteStatutOffre("brouillon_ia")).toBe("attention");
    expect(tonaliteStatutOffre("modifiee")).toBe("neutre");
    const c = { code: "langue", exige: "courant", constate: "notions", conforme: false };
    expect(libelleCritere({ ...c, objet: "Anglais" })).toBe("Langue : Anglais");
    expect(libelleCritere({ ...c, code: "inconnu", objet: null })).toBe("inconnu");
  });
});

describe("lecture des saisies du CV", () => {
  it("niveaux de diplôme et de langue", () => {
    expect(lireNiveauDiplome("Bac + 5")).toBe("bac_5");
    expect(lireNiveauDiplome("master")).toBe("bac_5");
    expect(lireNiveauDiplome("doctorat")).toBe("doctorat");
    expect(lireNiveauDiplome("cap")).toBeNull();
    expect(lireNiveauLangue("Langue maternelle")).toBe("maternelle");
    expect(lireNiveauLangue("Courant")).toBe("courant");
    expect(lireNiveauLangue("moyen")).toBeNull();
  });

  it("CV complet → contenu de l'API", () => {
    const r = lireCv(CV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charge.nom).toBe("Awa Koné");
    expect(r.charge.contenu.nationalite).toBeNull();
    expect(r.charge.contenu.competences).toEqual(["Budget", "Contrôle interne"]);
    expect(r.charge.contenu.experiences[0]).toMatchObject({
      pays: "CI",
      fin: "2017-12",
      secteurs: ["Finances publiques", "Budget"],
      bailleur: "Banque mondiale",
    });
    expect(r.charge.contenu.experiences[1]).toMatchObject({
      fin: null,
      pays: null,
      bailleur: null,
    });
    expect(r.charge.contenu.diplomes[0]).toMatchObject({ annee: 2009, niveau: "bac_5" });
    expect(r.charge.contenu.langues).toHaveLength(2);
  });

  it("aller-retour : contenu → saisie → contenu", () => {
    const r = lireCv(CV);
    if (!r.ok) throw new Error("CV invalide");
    const s = saisieDepuisCv(r.charge.nom, r.charge.contenu);
    const r2 = lireCv(s);
    expect(r2.ok && r2.charge).toEqual(r.charge);
  });

  it("erreurs ligne par ligne", () => {
    expect(lireExperiences("2020-13 | | a | b").ok).toBe(false);
    expect(lireExperiences("2020-05 | 2020-01 | a | b")).toMatchObject({
      ok: false,
      erreur: "Ligne 1 : la fin précède le début.",
    });
    expect(lireExperiences("2020-01 | | | b").ok).toBe(false);
    expect(lireExperiences("2020-01 | | a | b | CIV").ok).toBe(false);
    expect(lireDiplomes("09 | bac | a | b").ok).toBe(false);
    expect(lireDiplomes("2009 | cap | a | b").ok).toBe(false);
    expect(lireDiplomes("2009 | bac |  | b").ok).toBe(false);
    expect(lireLangues("Anglais").ok).toBe(false);
    const r = lireCv({ ...CV, nom: "", titre: "", experiences: "x", diplomes: "x", langues: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        "diplomes",
        "experiences",
        "langues",
        "nom",
        "titre",
      ]);
    }
  });

  it("exigences du contrôle", () => {
    const vide = {
      annees_min: "",
      niveau_diplome_min: "",
      secteur: "",
      annees_secteur: "",
      langue: "",
      niveau_langue: "",
      reference: "",
    };
    expect(lireExigences(vide)).toEqual({
      ok: true,
      charge: { annees_par_secteur: [], langues: [] },
    });
    const plein = lireExigences({
      ...vide,
      annees_min: "10",
      niveau_diplome_min: "bac_5",
      secteur: "Énergie",
      annees_secteur: "5",
      langue: "Anglais",
      niveau_langue: "courant",
      reference: "2026-10",
    });
    expect(plein).toEqual({
      ok: true,
      charge: {
        annees_min: 10,
        niveau_diplome_min: "bac_5",
        annees_par_secteur: [{ secteur: "Énergie", annees: 5 }],
        langues: [{ langue: "Anglais", niveau_min: "courant" }],
        reference: "2026-10",
      },
    });
    const ko = lireExigences({
      ...vide,
      annees_min: "2,5",
      secteur: "x",
      langue: "y",
      reference: "2026",
    });
    expect(ko.ok).toBe(false);
    if (!ko.ok) {
      expect(Object.keys(ko.erreurs).sort()).toEqual([
        "annees_min",
        "annees_secteur",
        "niveau_langue",
        "reference",
      ]);
    }
  });
});

describe("références", () => {
  const REF = {
    titre: "Réforme budgétaire",
    client_nom: "Ministère",
    pays: "ci",
    secteurs: "Finances publiques",
    bailleur: "",
    montant: "1 500 000",
    devise: "XOF" as const,
    date_debut: "2022-01-01",
    date_fin: "",
    role_cabinet: "seul",
    description: "",
  };

  it("saisie valide → corps de l'API (montant en unités mineures)", () => {
    expect(lireReference(REF)).toEqual({
      ok: true,
      charge: {
        titre: "Réforme budgétaire",
        client_nom: "Ministère",
        pays: "CI",
        secteurs: ["Finances publiques"],
        bailleur: null,
        montant: 1_500_000,
        devise: "XOF",
        date_debut: "2022-01-01",
        date_fin: null,
        role_cabinet: "seul",
        description: null,
      },
    });
    const eur = lireReference({ ...REF, devise: "EUR", montant: "1 500,50" });
    expect(eur.ok && eur.charge.montant).toBe(150_050);
  });

  it("erreurs", () => {
    const r = lireReference({
      ...REF,
      titre: "",
      client_nom: "",
      pays: "CIV",
      montant: "abc",
      date_debut: "",
      role_cabinet: "x",
    });
    expect(r.ok).toBe(false);
    expect(lireReference({ ...REF, date_fin: "2021-01-01" }).ok).toBe(false);
    expect(lireReference({ ...REF, date_fin: "2021" }).ok).toBe(false);
  });

  it("requête de recherche : montants seulement avec une devise", () => {
    expect(requeteReferences({ q: " énergie ", pays: "bf", montant_min: "10" })).toBe(
      "/api/banque-ao/references?limite=30&q=%C3%A9nergie&pays=BF",
    );
    expect(
      requeteReferences(
        { devise: "EUR", montant_min: "1 000", montant_max: "x", pays: "BFA" },
        "abc",
      ),
    ).toBe("/api/banque-ao/references?limite=30&devise=EUR&montant_min=100000&curseur=abc");
  });
});

describe("offres", () => {
  it("sections d'une offre technique : toutes obligatoires, motif obligatoire", () => {
    const s = {
      comprehension: " a ",
      methodologie: "b",
      planning: "c",
      organisation: "d",
      motif: "Relecture",
    };
    expect(lireSectionsOffre(s)).toEqual({
      ok: true,
      charge: {
        sections: { comprehension: "a", methodologie: "b", planning: "c", organisation: "d" },
        motif: "Relecture",
      },
    });
    const ko = lireSectionsOffre({
      ...s,
      planning: " ",
      motif: "",
      organisation: "x".repeat(20_001),
    });
    expect(ko.ok).toBe(false);
    if (!ko.ok)
      expect(Object.keys(ko.erreurs).sort()).toEqual(["motif", "organisation", "planning"]);
  });

  it("lignes d'honoraires, de per diem et de débours (montants usuels → mineurs)", () => {
    expect(lireLignesOffre("chef | Chef d'équipe | 12,5 | 450 000", "XOF", "honoraires")).toEqual({
      ok: true,
      valeur: [{ cle: "chef", libelle: "Chef d'équipe", jours: 12.5, taux_journalier: 450_000 }],
    });
    expect(lireLignesOffre("Billets | 2 | 650,50", "EUR", "quantites")).toEqual({
      ok: true,
      valeur: [{ libelle: "Billets", quantite: 2, prix_unitaire: 65_050 }],
    });
    expect(lireLignesOffre(" | x | 1 | 1", "XOF", "honoraires").ok).toBe(false);
    expect(lireLignesOffre("x | -1 | 1", "XOF", "quantites").ok).toBe(false);
    expect(lireLignesOffre("x | 1 | 1,5", "XOF", "quantites").ok).toBe(false);
  });

  it("offre financière complète", () => {
    const s = {
      titre: "Offre",
      devise: "XOF" as const,
      honoraires: "chef | Chef | 20 | 450000",
      per_diem: "",
      debours: "Billets | 2 | 650000",
      tva: "18",
    };
    const r = lireOffreFinanciere(s);
    expect(r.ok && r.charge.entree).toMatchObject({
      devise: "XOF",
      per_diem: [],
      taxes: [{ libelle: "TVA", taux: 18, assiette: "total_ht" }],
    });
    const sansTva = lireOffreFinanciere({ ...s, tva: "" });
    expect(sansTva.ok && sansTva.charge.entree.taxes).toEqual([]);
    const ko = lireOffreFinanciere({
      ...s,
      titre: "",
      tva: "120",
      honoraires: "x",
      per_diem: "y",
      debours: "z",
    });
    expect(ko.ok).toBe(false);
    if (!ko.ok) {
      expect(Object.keys(ko.erreurs).sort()).toEqual([
        "debours",
        "honoraires",
        "per_diem",
        "titre",
        "tva",
      ]);
    }
  });
});

describe("messages d'erreur", () => {
  it("message propre au code, sinon message générique", () => {
    expect(messageBanqueAo(new ErreurApi("CHIFFRES_A_ACQUITTER", "x", 409))).toContain(
      "acquittement",
    );
    expect(messageBanqueAo(new ErreurApi("AUTRE", "Message de l'API", 409))).toBe(
      "Message de l'API",
    );
  });
});

describe("chemins et pré-remplissage", () => {
  it("lien de liste : filtres conservés, limite retirée, curseur facultatif", () => {
    const f = new URLSearchParams({ q: "eau", limite: "30", curseur: "ancien" });
    expect(hrefListe("/x", f, null)).toBe("/x?q=eau");
    expect(hrefListe("/x", f, "abc")).toBe("/x?q=eau&curseur=abc");
    expect(hrefListe("/x", new URLSearchParams(), null)).toBe("/x");
  });

  it("offre financière enregistrée → saisie → même entrée", () => {
    const resultat = {
      devise: "EUR" as const,
      honoraires: [
        { cle: "chef", libelle: "Chef", quantite: 12.5, prix_unitaire: 45_050, montant: 0 },
      ],
      per_diem: [{ libelle: "Per diem", quantite: 3, prix_unitaire: 9_000, montant: 0 }],
      debours: [],
      jours_par_expert: [],
      total_jours_centiemes: 0,
      sous_total_honoraires: 0,
      sous_total_per_diem: 0,
      sous_total_debours: 0,
      total_ht: 0,
      taxes: [{ libelle: "TVA", taux: 18, assiette: "total_ht", base: 0, montant: 0 }],
      total_taxes: 0,
      total_ttc: 0,
      conversion: null,
    };
    const s = saisieDepuisOffreFinanciere("Offre", resultat);
    expect(s.honoraires).toBe("chef | Chef | 12,5 | 450,5");
    expect(s.tva).toBe("18");
    const r = lireOffreFinanciere(s);
    expect(r.ok && r.charge.entree).toEqual({
      devise: "EUR",
      honoraires: [{ cle: "chef", libelle: "Chef", jours: 12.5, taux_journalier: 45_050 }],
      per_diem: [{ libelle: "Per diem", quantite: 3, prix_unitaire: 9_000 }],
      debours: [],
      taxes: [{ libelle: "TVA", taux: 18, assiette: "total_ht" }],
    });
    expect(saisieDepuisOffreFinanciere("x", { ...resultat, taxes: [] }).tva).toBe("");
  });
});
