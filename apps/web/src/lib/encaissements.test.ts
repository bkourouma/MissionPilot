import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  actionsEncaissement,
  etatEncaissement,
  hrefEncaissements,
  libelleMoyen,
  lireFiltresEncaissements,
  lireImputations,
  messageEncaissement,
  peutDeciderContrePassation,
  requeteEncaissements,
  STATUT_PAIEMENT,
  validerEncaissement,
  validerImputationAvance,
  validerMotifContrePassation,
  type EncaissementDetaille,
  type SaisieEncaissement,
} from "./encaissements";

const CLIENT = "0b6c2d1e-0000-4000-8000-000000000001";
const F1 = "0b6c2d1e-0000-4000-8000-0000000000f1";
const F2 = "0b6c2d1e-0000-4000-8000-0000000000f2";
const creances = [
  { facture_id: F1, numero: "FA-2027-001", solde: 400_000, devise: "XOF" as const },
  { facture_id: F2, numero: "FA-2027-002", solde: 150_000, devise: "XOF" as const },
];

const saisie = (s: Partial<SaisieEncaissement> = {}): SaisieEncaissement => ({
  client_id: CLIENT,
  date: "2027-03-10",
  montant: "500 000",
  devise: "XOF",
  mode: "virement",
  operateur: "",
  reference: "",
  commentaire: "",
  imputations: { [F1]: "400 000", [F2]: "100 000" },
  avance: false,
  ...s,
});

describe("saisie d'un encaissement", () => {
  it("produit la charge de l'API avec plusieurs imputations (paiement partiel)", () => {
    const r = validerEncaissement(saisie(), creances, "2027-03-15");
    expect(r).toEqual({
      ok: true,
      charge: {
        client_id: CLIENT,
        date: "2027-03-10",
        montant: 500_000,
        devise: "XOF",
        mode: "virement",
        operateur: null,
        reference: null,
        commentaire: null,
        imputations: [
          { facture_id: F1, montant: 400_000 },
          { facture_id: F2, montant: 100_000 },
        ],
        avance: false,
      },
    });
  });

  it("refuse clairement le trop-perçu sur une facture", () => {
    const r = validerEncaissement(
      saisie({ imputations: { [F2]: "150 001" } }),
      creances,
      "2027-03-15",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.imputations).toMatch(/trop-perçu refusé/);
  });

  it("exige l'opérateur et la référence d'opération pour le Mobile Money", () => {
    const r = validerEncaissement(saisie({ mode: "mobile_money" }), creances, "2027-03-15");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.operateur).toBeDefined();
      expect(r.erreurs.reference).toMatch(/Mobile Money/);
    }
    const ok = validerEncaissement(
      saisie({ mode: "mobile_money", operateur: "wave", reference: "MP240310.1234.A1" }),
      creances,
      "2027-03-15",
    );
    expect(ok.ok && ok.charge.operateur).toBe("wave");
  });

  it("exige le numéro du chèque et ignore l'opérateur hors Mobile Money", () => {
    const r = validerEncaissement(saisie({ mode: "cheque" }), creances, "2027-03-15");
    expect(!r.ok && r.erreurs.reference).toMatch(/chèque/);
    const ok = validerEncaissement(
      saisie({ mode: "especes", operateur: "wave" }),
      creances,
      "2027-03-15",
    );
    expect(ok.ok && ok.charge.operateur).toBeNull();
  });

  it("refuse une date future, un montant nul et un client absent", () => {
    const r = validerEncaissement(
      saisie({ date: "2027-03-16", montant: "0", client_id: "" }),
      creances,
      "2027-03-15",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.date).toMatch(/futur/);
      expect(r.erreurs.montant).toBeDefined();
      expect(r.erreurs.client_id).toBeDefined();
    }
  });

  it("lit les montants dans la devise (centimes en euros)", () => {
    const eur = [{ facture_id: F1, numero: "FA-1", solde: 150_050, devise: "EUR" as const }];
    expect(lireImputations({ [F1]: "1 500,50" }, eur, "EUR")).toEqual({
      ok: true,
      imputations: [{ facture_id: F1, montant: 150_050 }],
    });
    expect(lireImputations({ [F1]: "10" }, eur, "XOF")).toMatchObject({ ok: false });
    expect(lireImputations({ [F1]: "1,505" }, eur, "EUR")).toMatchObject({ ok: false });
  });

  it("valide une imputation d'avance et un motif de contre-passation", () => {
    expect(validerImputationAvance({}, creances, "XOF").ok).toBe(false);
    expect(validerImputationAvance({ [F2]: "50000" }, creances, "XOF")).toEqual({
      ok: true,
      charge: { imputations: [{ facture_id: F2, montant: 50_000 }] },
    });
    expect(validerMotifContrePassation("  ").ok).toBe(false);
    expect(validerMotifContrePassation("x".repeat(501)).ok).toBe(false);
    expect(validerMotifContrePassation(" Doublon ")).toEqual({
      ok: true,
      charge: { motif: "Doublon" },
    });
  });
});

describe("contre-passation : séparation des tâches", () => {
  const demande = { statut: "demandee" as const, demandee_par: "moi" };
  it("ne laisse jamais le demandeur décider de sa propre demande, sauf associé", () => {
    expect(peutDeciderContrePassation(demande, "moi", ["gestionnaire"])).toBe(false);
    expect(peutDeciderContrePassation(demande, "autre", ["gestionnaire"])).toBe(true);
    expect(peutDeciderContrePassation(demande, "moi", ["associe"])).toBe(true);
    expect(
      peutDeciderContrePassation({ ...demande, statut: "validee" }, "autre", ["associe"]),
    ).toBe(false);
  });

  it("ouvre les actions d'un encaissement selon son état", () => {
    const e = {
      contre_passation_de: null,
      contre_passe_par: null,
      non_impute: 0,
    } as EncaissementDetaille;
    expect(actionsEncaissement(e, false)).toEqual({
      demanderContrePassation: true,
      imputerAvance: false,
    });
    expect(actionsEncaissement({ ...e, non_impute: 10 }, true)).toEqual({
      demanderContrePassation: false,
      imputerAvance: true,
    });
    expect(actionsEncaissement({ ...e, contre_passe_par: "x", non_impute: 10 }, false)).toEqual({
      demanderContrePassation: false,
      imputerAvance: false,
    });
  });
});

describe("affichage", () => {
  it("décrit le moyen, l'état et le statut de paiement avec un texte", () => {
    expect(libelleMoyen({ mode: "mobile_money", operateur: "orange_money" })).toBe(
      "Mobile Money (Orange Money)",
    );
    expect(libelleMoyen({ mode: "cheque", operateur: null })).toBe("Chèque");
    const base = { contre_passation_de: null, contre_passe_par: null, avance: false };
    expect(etatEncaissement(base as never).libelle).toBe("Imputé");
    expect(etatEncaissement({ ...base, avance: true } as never).libelle).toBe("Avec avance");
    expect(etatEncaissement({ ...base, contre_passe_par: "x" } as never).tonalite).toBe("danger");
    expect(STATUT_PAIEMENT.en_retard).toEqual({ libelle: "En retard", tonalite: "danger" });
    expect(STATUT_PAIEMENT.partiellement_payee.libelle).toBe("Partiellement payée");
  });

  it("relaie en français les refus métier de l'API", () => {
    expect(messageEncaissement(new ErreurApi("TROP_PERCU", "Trop-perçu refusé.", 409))).toBe(
      "Trop-perçu refusé.",
    );
    expect(messageEncaissement(new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400))).toBe(
      null,
    );
    expect(messageEncaissement(new Error("x"))).toBeNull();
    expect(messageEncaissement(new ErreurApi("CONFLIT_CONCURRENT", "réessayer.", 409))).toMatch(
      /Réessayez/,
    );
  });
});

describe("filtres de la liste", () => {
  it("lit et réécrit les filtres sans valeur invalide", () => {
    const f = lireFiltresEncaissements({
      client_id: CLIENT,
      du: "2027-01-01",
      au: "2027-02-01",
      curseur: "abc_D-1",
    });
    expect(requeteEncaissements(f)).toBe(
      `client_id=${CLIENT}&du=2027-01-01&au=2027-02-01&curseur=abc_D-1&limite=30`,
    );
    expect(hrefEncaissements(f, null)).toBe(
      `/facturation/encaissements?client_id=${CLIENT}&du=2027-01-01&au=2027-02-01`,
    );
    const faux = lireFiltresEncaissements({ client_id: "1", du: "2027-03-01", au: "2027-01-01" });
    expect(faux).toEqual({ client_id: "", du: "", au: "", curseur: "" });
    expect(hrefEncaissements(faux)).toBe("/facturation/encaissements");
  });
});
