import { describe, expect, it } from "vitest";
import type { Facteur } from "./methodes";
import {
  construireModificationFacteur,
  lireNouvellesValeurs,
  saisieModificationFacteur,
} from "./methodes-facteurs";

const ENUM: Facteur = {
  id: "f1",
  code: "actionnariat",
  libelle: "Propriété",
  description: "Qui détient le capital",
  type: "enumeration",
  valeurs: [
    { code: "familial", libelle: "Familiale" },
    { code: "etat", libelle: "État actionnaire" },
  ],
  min: null,
  max: null,
  porte_par: "mission",
  origine: "cabinet",
};

const NOMBRE: Facteur = {
  ...ENUM,
  id: "f2",
  code: "effectif",
  libelle: "Effectif",
  type: "nombre",
  valeurs: null,
  min: 10,
  max: 500,
};

describe("lecture des valeurs à ajouter", () => {
  it("lit « code : libellé » et reprend le code sans libellé", () => {
    expect(lireNouvellesValeurs("bio : Certifiée bio\n\n  local \nmixte: A : B")).toEqual([
      { code: "bio", libelle: "Certifiée bio" },
      { code: "local", libelle: "local" },
      { code: "mixte", libelle: "A : B" },
    ]);
  });
});

describe("modification d'un facteur du cabinet", () => {
  it("préremplit la saisie depuis le facteur", () => {
    expect(saisieModificationFacteur(NOMBRE)).toEqual({
      libelle: "Effectif",
      description: "Qui détient le capital",
      nouvelles: "",
      min: "10",
      max: "500",
    });
  });

  it("envoie la liste COMPLÈTE : valeurs existantes puis nouvelles", () => {
    const r = construireModificationFacteur(ENUM, {
      ...saisieModificationFacteur(ENUM),
      libelle: "Actionnariat",
      nouvelles: "public : Public",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge.libelle).toBe("Actionnariat");
      expect(r.charge.valeurs).toEqual([
        { code: "familial", libelle: "Familiale" },
        { code: "etat", libelle: "État actionnaire" },
        { code: "public", libelle: "Public" },
      ]);
    }
  });

  it("n'envoie pas la liste quand rien n'est ajouté", () => {
    const r = construireModificationFacteur(ENUM, saisieModificationFacteur(ENUM));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.charge).not.toHaveProperty("valeurs");
  });

  it("refuse une valeur déjà présente, en double ou mal codée", () => {
    const base = saisieModificationFacteur(ENUM);
    const existante = construireModificationFacteur(ENUM, { ...base, nouvelles: "etat : Autre" });
    expect(existante.ok).toBe(false);
    if (!existante.ok) expect(existante.erreurs.nouvelles).toContain("existe déjà");
    const doublon = construireModificationFacteur(ENUM, { ...base, nouvelles: "a\na" });
    expect(doublon.ok).toBe(false);
    const mauvais = construireModificationFacteur(ENUM, { ...base, nouvelles: "Mauvais Code" });
    expect(mauvais.ok).toBe(false);
  });

  it("exige un libellé", () => {
    const r = construireModificationFacteur(ENUM, {
      ...saisieModificationFacteur(ENUM),
      libelle: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.libelle).toBe("Libellé obligatoire.");
  });

  it("n'accepte que l'élargissement des bornes", () => {
    const base = saisieModificationFacteur(NOMBRE);
    const large = construireModificationFacteur(NOMBRE, { ...base, min: "5", max: "1 000" });
    expect(large.ok).toBe(true);
    if (large.ok) {
      expect(large.charge.min).toBe(5);
      expect(large.charge.max).toBe(1000);
    }
    const leve = construireModificationFacteur(NOMBRE, { ...base, max: "" });
    expect(leve.ok && leve.charge.max).toBeNull();

    const resserreMin = construireModificationFacteur(NOMBRE, { ...base, min: "20" });
    expect(resserreMin.ok).toBe(false);
    if (!resserreMin.ok) expect(resserreMin.erreurs.min).toContain("s'élargir");
    const resserreMax = construireModificationFacteur(NOMBRE, { ...base, max: "100" });
    expect(resserreMax.ok).toBe(false);
    if (!resserreMax.ok) expect(resserreMax.erreurs.max).toContain("s'élargir");
  });

  it("n'envoie pas une borne inchangée", () => {
    const r = construireModificationFacteur(NOMBRE, saisieModificationFacteur(NOMBRE));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).not.toHaveProperty("min");
      expect(r.charge).not.toHaveProperty("max");
    }
  });

  it("refuse de poser une borne là où il n'y en avait pas", () => {
    const sansBorne = { ...NOMBRE, min: null };
    const r = construireModificationFacteur(sansBorne, {
      ...saisieModificationFacteur(sansBorne),
      min: "0",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.min).toContain("resserrerait");
  });

  it("refuse une borne illisible", () => {
    const r = construireModificationFacteur(NOMBRE, {
      ...saisieModificationFacteur(NOMBRE),
      max: "beaucoup",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.max).toBe("Nombre attendu.");
  });
});
