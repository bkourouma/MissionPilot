import { describe, expect, it } from "vitest";
import {
  hrefListe,
  lireParametresListe,
  requeteApiListe,
  SAISIE_CLIENT_VIDE,
  saisieDepuisClient,
  validerClient,
  validerContact,
  type Client,
} from "./clients";

describe("paramètres de liste", () => {
  it("lit l'URL avec des valeurs par défaut sûres", () => {
    expect(lireParametresListe({})).toEqual({ q: "", statut: "actifs", curseur: undefined });
    expect(
      lireParametresListe({ q: "  sotra ", statut: "archives", curseur: "eyJhIjoxfQ" }),
    ).toEqual({ q: "sotra", statut: "archives", curseur: "eyJhIjoxfQ" });
    expect(lireParametresListe({ statut: "n'importe", curseur: "a b" })).toMatchObject({
      statut: "actifs",
      curseur: undefined,
    });
  });

  it("traduit le statut en filtre de l'API", () => {
    expect(requeteApiListe({ q: "", statut: "actifs" })).toBe("actif=true&limite=25");
    expect(requeteApiListe({ q: "a&b", statut: "tous", curseur: "x" }, 10)).toBe(
      "q=a%26b&limite=10&curseur=x",
    );
    expect(requeteApiListe({ q: "", statut: "archives" })).toBe("actif=false&limite=25");
  });

  it("construit les liens de l'interface sans répéter le statut par défaut", () => {
    expect(hrefListe("/clients", { q: "", statut: "actifs" })).toBe("/clients");
    expect(hrefListe("/clients", { q: "bk", statut: "tous", curseur: "c" })).toBe(
      "/clients?q=bk&statut=tous&curseur=c",
    );
    expect(hrefListe("/x", { q: "", statut: "actifs" }, { type: "externe" })).toBe(
      "/x?type=externe",
    );
  });
});

describe("validerClient", () => {
  it("transforme les champs vides en null", () => {
    const r = validerClient({ ...SAISIE_CLIENT_VIDE, raison_sociale: " SOTRA SA " });
    expect(r).toEqual({
      ok: true,
      charge: {
        raison_sociale: "SOTRA SA",
        forme_juridique: null,
        rccm: null,
        compte_contribuable: null,
        secteur: null,
        pays: "CI",
        taille: null,
        adresse: null,
      },
    });
  });

  it("refait la même charge depuis une fiche existante", () => {
    const client: Client = {
      id: "1",
      raison_sociale: "Banque X",
      forme_juridique: "SA",
      rccm: "CI-ABJ-1",
      compte_contribuable: "123",
      secteur: "Banque",
      pays: "SN",
      taille: "eti",
      adresse: "Dakar",
      actif: true,
      cree_le: "",
      modifie_le: "",
    };
    const r = validerClient(saisieDepuisClient(client));
    expect(r.ok && r.charge).toMatchObject({ rccm: "CI-ABJ-1", taille: "eti", pays: "SN" });
  });

  it("signale la raison sociale manquante, une taille inconnue et un texte trop long", () => {
    const r = validerClient({ ...SAISIE_CLIENT_VIDE, taille: "geante", rccm: "x".repeat(61) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["raison_sociale", "rccm", "taille"]);
  });
});

describe("validerContact", () => {
  it("normalise l'e-mail et accepte un téléphone international", () => {
    expect(
      validerContact({
        nom: "Aya",
        fonction: "",
        email: " Aya@Client.CI ",
        telephone: "+225 07 00 00 00 00",
        principal: true,
      }),
    ).toEqual({
      ok: true,
      charge: {
        nom: "Aya",
        fonction: null,
        email: "aya@client.ci",
        telephone: "+225 07 00 00 00 00",
        principal: true,
      },
    });
  });

  it("refuse un e-mail ou un téléphone mal formé", () => {
    const r = validerContact({
      nom: "",
      fonction: "",
      email: "aya@",
      telephone: "07 abc",
      principal: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["email", "nom", "telephone"]);
  });
});
