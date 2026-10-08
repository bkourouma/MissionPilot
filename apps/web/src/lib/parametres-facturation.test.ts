import { describe, expect, it } from "vitest";
import {
  apercuNumero,
  autresCoordonneesMasqueesRecues,
  droitsParametresFacturation,
  ibanMasqueRecu,
  lirePourcentage,
  lireTauxAutorises,
  mentionsManquantes,
  saisieIdentite,
  saisieOperationnelle,
  validerIdentite,
  validerOperationnel,
  type ParametresFacturation,
} from "./parametres-facturation";

const depart: ParametresFacturation = {
  raison_sociale: null,
  forme_juridique: null,
  rccm: null,
  compte_contribuable: null,
  regime_fiscal: null,
  adresse: null,
  telephone: null,
  email: null,
  banque: null,
  iban: null,
  autres_coordonnees: null,
  mentions_complementaires: null,
  prefixe_facture: "FA",
  prefixe_avoir: "AV",
  chiffres_numero: 5,
  delai_paiement_jours: 30,
  taux_tva_defaut: 18,
  taux_tva_autorises: [0, 18],
  taux_tva_debours: 0,
  retenue_active: false,
  retenue_taux: 0,
  retenue_base: "HT",
  retenue_libelle: "Retenue à la source",
  valeurs_validees: false,
  personnalises: false,
  modifie_le: null,
};

describe("droits", () => {
  it("sépare l'identité (associé) des réglages opérationnels (gestionnaire)", () => {
    expect(droitsParametresFacturation(["associe"])).toEqual({
      identite: true,
      operationnel: true,
    });
    expect(droitsParametresFacturation(["gestionnaire"])).toEqual({
      identite: false,
      operationnel: true,
    });
    expect(droitsParametresFacturation(["chef_mission"])).toEqual({
      identite: false,
      operationnel: false,
    });
  });
});

describe("identité et numérotation", () => {
  it("normalise l'IBAN et les préfixes, vide → null", () => {
    const r = validerIdentite({
      ...saisieIdentite(depart),
      rccm: " CI-ABJ-2020-B-1 ",
      iban: "ci93 ci00 0101 0000 0000 0000 0001",
      prefixe_facture: "fa",
      chiffres_numero: "6",
    });
    expect(r.ok && r.charge).toMatchObject({
      rccm: "CI-ABJ-2020-B-1",
      iban: "CI93CI0001010000000000000001",
      prefixe_facture: "FA",
      chiffres_numero: 6,
      adresse: null,
    });
  });

  it("refuse préfixes identiques, IBAN et e-mail mal formés, ligne multiple", () => {
    const r = validerIdentite({
      ...saisieIdentite(depart),
      prefixe_avoir: "FA",
      iban: "12345",
      email: "pas-un-email",
      rccm: "a\nb",
      chiffres_numero: "9",
    });
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual([
      "chiffres_numero",
      "email",
      "iban",
      "prefixe_avoir",
      "rccm",
    ]);
  });

  it("liste les mentions manquantes avant émission", () => {
    expect(mentionsManquantes(depart)).toEqual(["numéro RCCM", "compte contribuable", "adresse"]);
    expect(
      mentionsManquantes({ ...depart, rccm: "r", compte_contribuable: "c", adresse: "a" }),
    ).toEqual([]);
  });

  it("montre un exemple de numéro", () => {
    expect(apercuNumero("FA", 5, 2026)).toBe("FA-2026-00001");
  });
});

describe("IBAN masqué (lecteur sans « facture.emettre »)", () => {
  const masque: ParametresFacturation = { ...depart, iban: "CI…0001", iban_masque: true };

  it("ibanMasqueRecu : valeur masquée seulement si l'API l'a signalée", () => {
    expect(ibanMasqueRecu(masque)).toBe("CI…0001");
    expect(ibanMasqueRecu({ ...depart, iban: "CI93CI0001010000000000000001" })).toBeNull();
    expect(ibanMasqueRecu({ ...depart, iban: null, iban_masque: false })).toBeNull();
  });

  it("inchangé : l'IBAN est omis de la charge, jamais renvoyé masqué ni effacé", () => {
    const s = { ...saisieIdentite(masque), rccm: "R-1" };
    expect(s.iban).toBe("CI…0001");
    const r = validerIdentite(s, ibanMasqueRecu(masque));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charge).not.toHaveProperty("iban");
      expect(r.charge.rccm).toBe("R-1");
    }
    // Espaces autour : toujours considéré inchangé.
    const r2 = validerIdentite({ ...s, iban: " CI…0001 " }, "CI…0001");
    expect(r2.ok && r2.charge).not.toHaveProperty("iban");
  });

  it("modifié : validé comme un IBAN complet ; masque retouché refusé ; vidé → null", () => {
    const s = saisieIdentite(masque);
    const nouveau = validerIdentite({ ...s, iban: "ci93 ci00 0000 0000 0000 99" }, "CI…0001");
    expect(nouveau.ok && nouveau.charge.iban).toBe("CI93CI0000000000000099");
    const retouche = validerIdentite({ ...s, iban: "CI…0002" }, "CI…0001");
    expect(retouche.ok ? [] : Object.keys(retouche.erreurs)).toEqual(["iban"]);
    const vide = validerIdentite({ ...s, iban: "" }, "CI…0001");
    expect(vide.ok && vide.charge.iban).toBeNull();
  });

  it("sans masque (IBAN en clair) : comportement inchangé, l'IBAN est toujours envoyé", () => {
    const clair = { ...depart, iban: "CI93CI0001010000000000000001", iban_masque: false };
    const r = validerIdentite(saisieIdentite(clair), ibanMasqueRecu(clair));
    expect(r.ok && r.charge.iban).toBe("CI93CI0001010000000000000001");
  });
});

describe("autres coordonnées masquées (lecteur sans « facture.emettre »)", () => {
  const masque: ParametresFacturation = {
    ...depart,
    autres_coordonnees: "…",
    autres_coordonnees_masquees: true,
  };
  const valider = (p: ParametresFacturation, autres: string) =>
    validerIdentite(
      { ...saisieIdentite(p), autres_coordonnees: autres },
      ibanMasqueRecu(p),
      autresCoordonneesMasqueesRecues(p),
    );

  it("autresCoordonneesMasqueesRecues : valeur masquée seulement si l'API l'a signalée", () => {
    expect(autresCoordonneesMasqueesRecues(masque)).toBe("…");
    expect(autresCoordonneesMasqueesRecues({ ...depart, autres_coordonnees: "OM 07" })).toBeNull();
    expect(autresCoordonneesMasqueesRecues(depart)).toBeNull();
  });

  it("inchangées : omises de la charge, jamais renvoyées masquées ni effacées", () => {
    for (const saisie of ["…", " … "]) {
      const r = valider(masque, saisie);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.charge).not.toHaveProperty("autres_coordonnees");
    }
  });

  it("modifiées : la nouvelle valeur est envoyée ; vidées → null ; en clair : toujours envoyées", () => {
    const nouveau = valider(masque, "Orange Money +225 07 00 00 00 99");
    expect(nouveau.ok && nouveau.charge.autres_coordonnees).toBe(
      "Orange Money +225 07 00 00 00 99",
    );
    const vide = valider(masque, "");
    expect(vide.ok && vide.charge.autres_coordonnees).toBeNull();
    const clair = { ...depart, autres_coordonnees: "Chèque", autres_coordonnees_masquees: false };
    const r = valider(clair, "Chèque");
    expect(r.ok && r.charge.autres_coordonnees).toBe("Chèque");
  });
});

describe("TVA, retenue et délai", () => {
  it("lit les pourcentages et la liste des taux", () => {
    expect(lirePourcentage("18", 2)).toBe(18);
    expect(lirePourcentage("7,5", 2)).toBe(7.5);
    expect(lirePourcentage("7,555", 2)).toBeNull();
    expect(lirePourcentage("101", 2)).toBeNull();
    expect(lireTauxAutorises("18 ; 0 ; 9 ; 18")).toEqual([0, 9, 18]);
    expect(lireTauxAutorises("5,5 ; 18")).toEqual([5.5, 18]);
    expect(lireTauxAutorises("")).toBeNull();
    expect(lireTauxAutorises("abc")).toBeNull();
  });

  it("produit la charge des valeurs de départ", () => {
    expect(validerOperationnel(saisieOperationnelle(depart))).toEqual({
      ok: true,
      charge: {
        delai_paiement_jours: 30,
        taux_tva_defaut: 18,
        taux_tva_autorises: [0, 18],
        taux_tva_debours: 0,
        retenue_active: false,
        retenue_taux: 0,
        retenue_base: "HT",
        retenue_libelle: "Retenue à la source",
        valeurs_validees: false,
      },
    });
  });

  it("exige que les taux par défaut figurent parmi les taux autorisés", () => {
    const r = validerOperationnel({
      ...saisieOperationnelle(depart),
      taux_tva_autorises: "18",
      retenue_libelle: "",
      delai_paiement_jours: "-1",
    });
    expect(r.ok ? [] : Object.keys(r.erreurs).sort()).toEqual([
      "delai_paiement_jours",
      "retenue_libelle",
      "taux_tva_debours",
    ]);
  });
});
