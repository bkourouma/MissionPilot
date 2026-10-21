import { describe, expect, it } from "vitest";
import { RED_SUIVI_RATIOS, type Role } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { MOTS_INTERDITS } from "./redressement";
import {
  cheminEvenementsJalon,
  cheminRelevesSuivi,
  cheminSuivi,
  etatSuivi,
  formaterRatioSuivi,
  libelleEcheanceJalon,
  libelleReports,
  MENTION_SUIVI,
  messageSuivi,
  peutEcrireSuivi,
  TEXTE_SUIVI_A_CREER,
  TEXTE_SUIVI_LECTURE_SEULE,
  TEXTE_SUIVI_NON_CLOS,
  TEXTE_SUIVI_RELEVE_INSTANTANE,
  TEXTE_SUIVI_RELEVE_SAISIE,
  tonaliteStatutJalon,
} from "./redressement-suivi";
import {
  corpsCreationSuivi,
  corpsEvenement,
  corpsReleve,
  dateSuiviValide,
  jalonsParDefaut,
  jalonVide,
  lireRatioPb,
  moisSuivant,
  releveVide,
} from "./redressement-suivi-saisie";

describe("chemins et états du suivi", () => {
  it("construit les chemins d'API", () => {
    expect(cheminSuivi("d 1")).toBe("/api/redressement/dossiers/d%201/suivi");
    expect(cheminRelevesSuivi("d")).toBe("/api/redressement/dossiers/d/suivi/releves");
    expect(cheminEvenementsJalon("d", "j")).toBe(
      "/api/redressement/dossiers/d/suivi/jalons/j/evenements",
    );
  });

  it("distingue dossier non clos, suivi à créer et suivi actif", () => {
    expect(etatSuivi({ dossier_clos: false, plan: null })).toBe("non_clos");
    expect(etatSuivi({ dossier_clos: true, plan: null })).toBe("a_creer");
    expect(etatSuivi({ dossier_clos: true, plan: {} as never })).toBe("actif");
  });

  it("décrit l'échéance d'un jalon", () => {
    const j = (
      statut: "a_venir" | "echu" | "realise",
      jours_restants: number,
      retard_jours: number,
    ) => libelleEcheanceJalon({ statut, jours_restants, retard_jours });
    expect(j("a_venir", 45, 0)).toBe("Dans 45 jours");
    expect(j("a_venir", 1, 0)).toBe("Dans 1 jour");
    expect(j("echu", 0, 12)).toBe("12 jours de retard");
    expect(j("echu", 0, 0)).toBe("Échéance atteinte");
    expect(j("realise", 0, 0)).toBe("Jalon réalisé");
    expect(libelleReports(0)).toBeNull();
    expect(libelleReports(1)).toBe("Reporté 1 fois");
    expect(libelleReports(3)).toBe("Reporté 3 fois");
    expect(tonaliteStatutJalon("echu")).toBe("attention");
    expect(tonaliteStatutJalon("realise")).toBe("succes");
    expect(tonaliteStatutJalon("a_venir")).toBe("neutre");
  });

  it("met en forme les ratios en points de base", () => {
    expect(formaterRatioSuivi("liquidite_generale", 13_636)).toBe("1,36");
    expect(formaterRatioSuivi("marge_nette", 1875)).toMatch(/^18,75\s%$/);
    expect(formaterRatioSuivi("marge_nette", null)).toBe("—");
  });

  it("affiche les refus de l'API tels quels", () => {
    expect(
      messageSuivi(new ErreurApi("RED_DOSSIER_NON_CLOS", "Le suivi suit la clôture.", 409)),
    ).toBe("Le suivi suit la clôture.");
    expect(messageSuivi(new ErreurApi("RED_SUIVI_EXISTE", "Suivi existant.", 409))).toBe(
      "Suivi existant.",
    );
  });

  it("n'emploie aucune qualification juridique dans les textes", () => {
    for (const t of [
      MENTION_SUIVI,
      TEXTE_SUIVI_A_CREER,
      TEXTE_SUIVI_LECTURE_SEULE,
      TEXTE_SUIVI_NON_CLOS,
      TEXTE_SUIVI_RELEVE_INSTANTANE,
      TEXTE_SUIVI_RELEVE_SAISIE,
    ]) {
      for (const mot of MOTS_INTERDITS) expect(t.toLowerCase()).not.toContain(mot);
    }
    expect(MENTION_SUIVI).toContain("ne qualifient pas");
  });
});

describe("droit d'écriture du suivi", () => {
  const m = {
    directeur_id: "dir",
    chef_id: "chef",
    equipe: [{ utilisateur_id: "eq" }],
  } as unknown as Parameters<typeof peutEcrireSuivi>[2];

  it("exige le droit d'écriture sur le redressement et l'appartenance à la mission", () => {
    const associe: Role[] = ["associe"];
    expect(peutEcrireSuivi(associe, "autre", m)).toBe(true);
    const consultant: Role[] = ["consultant"];
    expect(peutEcrireSuivi(consultant, "eq", m)).toBe(true);
    expect(peutEcrireSuivi(consultant, "dir", m)).toBe(true);
    expect(peutEcrireSuivi(consultant, "chef", m)).toBe(true);
    expect(peutEcrireSuivi(consultant, "inconnu", m)).toBe(false);
  });

  it("refuse les rôles sans droit d'écriture", () => {
    const sansDroit: Role[] = ["ressources"];
    expect(peutEcrireSuivi(sansDroit, "dir", m)).toBe(false);
  });
});

describe("création du suivi", () => {
  it("propose les jalons à 6 et 12 mois", () => {
    const defauts = jalonsParDefaut();
    expect(defauts.map((j) => j.mois)).toEqual(["6", "12"]);
    expect(corpsCreationSuivi(defauts)).toEqual({
      ok: true,
      charge: { jalons: [{ mois: 6 }, { mois: 12 }] },
    });
  });

  it("garde le libellé facultatif et exige des mois strictement croissants", () => {
    const a = { ...jalonVide("3"), libelle: " Point trimestriel " };
    expect(corpsCreationSuivi([a, jalonVide("9")])).toEqual({
      ok: true,
      charge: { jalons: [{ mois: 3, libelle: "Point trimestriel" }, { mois: 9 }] },
    });
    expect(corpsCreationSuivi([jalonVide("6"), jalonVide("6")]).ok).toBe(false);
  });

  it("refuse les mois illisibles, hors 1 à 60, trop de jalons ou aucun jalon", () => {
    for (const mois of ["", "0", "61", "1,5", "abc", "-3"]) {
      expect(corpsCreationSuivi([jalonVide(mois)]).ok, mois).toBe(false);
    }
    expect(corpsCreationSuivi([]).ok).toBe(false);
    const treize = Array.from({ length: 13 }, (_, i) => jalonVide(String(i + 1)));
    expect(corpsCreationSuivi(treize).ok).toBe(false);
    expect(corpsCreationSuivi([{ ...jalonVide("6"), libelle: "x".repeat(121) }]).ok).toBe(false);
  });

  it("suggère le mois du jalon ajouté", () => {
    expect(moisSuivant(jalonsParDefaut())).toBe("18");
    expect(moisSuivant([jalonVide("58")])).toBe("60");
    expect(moisSuivant([])).toBe("6");
  });
});

describe("lecture des ratios saisis", () => {
  it("convertit un rapport en points de base sans flottant", () => {
    expect(lireRatioPb("1,36", "liquidite_generale")).toBe(13_600);
    expect(lireRatioPb("0.0001", "liquidite_generale")).toBe(1);
    expect(lireRatioPb("2", "endettement")).toBe(20_000);
    expect(lireRatioPb("-0,5", "couverture_charges_financieres")).toBe(-5000);
  });

  it("convertit une part en points de base", () => {
    expect(lireRatioPb("18,75", "marge_nette")).toBe(1875);
    expect(lireRatioPb("18,75 %", "autonomie_financiere")).toBe(1875);
    expect(lireRatioPb("-3", "marge_brute")).toBe(-300);
    expect(lireRatioPb("0,01", "marge_brute")).toBe(1);
    expect(lireRatioPb("0", "marge_brute")).toBe(0);
  });

  it("signale le vide, l'illisible, le trop précis et le hors limites", () => {
    expect(lireRatioPb("  ", "marge_nette")).toBeNull();
    expect(lireRatioPb("abc", "marge_nette")).toBeNaN();
    expect(lireRatioPb("1,234", "marge_nette")).toBeNaN();
    expect(lireRatioPb("1,23456", "endettement")).toBeNaN();
    expect(lireRatioPb("100001", "endettement")).toBeNaN();
  });
});

describe("relevé", () => {
  const base = releveVide("2027-04-20", "j1");

  it("valide des indicateurs saisis", () => {
    const r = corpsReleve({
      ...base,
      ratios: { liquidite_generale: "1,5", marge_nette: "", endettement: "0,8" },
      commentaire: " Bonne reprise ",
    });
    expect(r).toEqual({
      ok: true,
      charge: {
        jalon_id: "j1",
        date_releve: "2027-04-20",
        source: "saisie",
        ratios: { liquidite_generale: 15_000, endettement: 8000 },
        commentaire: "Bonne reprise",
      },
    });
  });

  it("exige au moins un ratio pour des indicateurs saisis", () => {
    const r = corpsReleve(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.ratios).toContain("au moins un ratio");
  });

  it("désigne le ratio illisible", () => {
    const r = corpsReleve({ ...base, ratios: { marge_nette: "beaucoup" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs["ratio.marge_nette"]).toBeTruthy();
  });

  it("n'envoie aucun ratio pour un instantané", () => {
    const r = corpsReleve({ ...base, source: "instantane", ratios: { marge_nette: "12" } });
    expect(r).toEqual({
      ok: true,
      charge: { jalon_id: "j1", date_releve: "2027-04-20", source: "instantane" },
    });
  });

  it("exige le jalon et une date valide", () => {
    const r = corpsReleve({
      ...base,
      jalon_id: "",
      date_releve: "2027-02-30",
      source: "instantane",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.jalon_id).toBeTruthy();
      expect(r.erreurs.date_releve).toBeTruthy();
    }
  });

  it("couvre tous les ratios du suivi", () => {
    const ratios = Object.fromEntries(RED_SUIVI_RATIOS.map((k) => [k, "1"]));
    const r = corpsReleve({ ...base, ratios });
    expect(r.ok && Object.keys(r.charge.ratios ?? {}).length).toBe(RED_SUIVI_RATIOS.length);
  });
});

describe("événement d'un jalon", () => {
  it("marque un jalon réalisé sans motif", () => {
    expect(corpsEvenement({ type: "realise", date_effet: "2027-04-20", motif: "" })).toEqual({
      ok: true,
      charge: { type: "realise", date_effet: "2027-04-20" },
    });
  });

  it("exige un motif pour un report", () => {
    const sans = corpsEvenement({ type: "reporte", date_effet: "2027-06-01", motif: "  " });
    expect(sans.ok).toBe(false);
    if (!sans.ok) expect(sans.erreurs.motif).toBe("Un report s'accompagne d'un motif.");
    expect(
      corpsEvenement({ type: "reporte", date_effet: "2027-06-01", motif: "Comptes en retard" }),
    ).toEqual({
      ok: true,
      charge: { type: "reporte", date_effet: "2027-06-01", motif: "Comptes en retard" },
    });
  });

  it("refuse une date invalide ou un motif trop long", () => {
    expect(corpsEvenement({ type: "realise", date_effet: "demain", motif: "" }).ok).toBe(false);
    expect(
      corpsEvenement({ type: "reporte", date_effet: "2027-06-01", motif: "x".repeat(501) }).ok,
    ).toBe(false);
  });

  it("borne les dates entre 2000 et 2100", () => {
    expect(dateSuiviValide("2000-01-01")).toBe(true);
    expect(dateSuiviValide("2100-12-31")).toBe(true);
    expect(dateSuiviValide("1999-12-31")).toBe(false);
    expect(dateSuiviValide("2101-01-01")).toBe(false);
    expect(dateSuiviValide("2027-13-01")).toBe(false);
  });
});
