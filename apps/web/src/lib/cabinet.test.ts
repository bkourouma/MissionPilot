import { describe, expect, it } from "vitest";
import {
  anneeDemandee,
  nomPays,
  saisieDepuisCabinet,
  validerCabinet,
  validerFerie,
  type Cabinet,
} from "./cabinet";

const cabinet: Cabinet = {
  id: "c1",
  nom: "Cabinet Démo",
  pays: "CI",
  devise_base: "XOF",
  unite_saisie_temps: "demi_journee",
  heures_par_jour: 7.5,
  jours_travailles: [1, 2, 3, 4, 5],
};

describe("validerCabinet", () => {
  it("fait l'aller-retour fiche → saisie → charge utile", () => {
    const s = saisieDepuisCabinet(cabinet);
    expect(s.heures_par_jour).toBe("7,5");
    expect(validerCabinet(s)).toEqual({
      ok: true,
      charge: {
        nom: "Cabinet Démo",
        pays: "CI",
        devise_base: "XOF",
        unite_saisie_temps: "demi_journee",
        heures_par_jour: 7.5,
        jours_travailles: [1, 2, 3, 4, 5],
      },
    });
  });

  it("trie et dédoublonne les jours travaillés", () => {
    const r = validerCabinet({ ...saisieDepuisCabinet(cabinet), jours_travailles: [6, 1, 1, 3] });
    expect(r.ok && r.charge.jours_travailles).toEqual([1, 3, 6]);
  });

  it("signale chaque champ invalide en français", () => {
    const r = validerCabinet({
      nom: " ",
      pays: "",
      devise_base: "GBP",
      unite_saisie_temps: "minute",
      heures_par_jour: "25",
      jours_travailles: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erreurs).sort()).toEqual([
      "devise_base",
      "heures_par_jour",
      "jours_travailles",
      "nom",
      "pays",
      "unite_saisie_temps",
    ]);
    expect(r.erreurs.heures_par_jour).toMatch(/entre 1 et 24/);
  });

  it("refuse plus de deux décimales d'heures", () => {
    const r = validerCabinet({ ...saisieDepuisCabinet(cabinet), heures_par_jour: "7,333" });
    expect(r.ok).toBe(false);
  });
});

describe("validerFerie", () => {
  it("construit la charge utile", () => {
    expect(
      validerFerie({ date: "2026-08-07", libelle: " Fête nationale ", nationale: true }),
    ).toEqual({
      ok: true,
      charge: { date: "2026-08-07", libelle: "Fête nationale", nationale: true },
    });
  });

  it("exige une date et un libellé", () => {
    const r = validerFerie({ date: "", libelle: "", nationale: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["date", "libelle"]);
  });
});

describe("utilitaires", () => {
  it("borne l'année demandée", () => {
    expect(anneeDemandee("2027", 2026)).toBe(2027);
    expect(anneeDemandee("1990", 2026)).toBe(2026);
    expect(anneeDemandee("abc", 2026)).toBe(2026);
    expect(anneeDemandee(undefined, 2026)).toBe(2026);
  });

  it("nomme un pays connu, garde le code sinon", () => {
    expect(nomPays("SN")).toBe("Sénégal");
    expect(nomPays("ZZ")).toBe("ZZ");
    expect(nomPays(null)).toBe("—");
  });
});
