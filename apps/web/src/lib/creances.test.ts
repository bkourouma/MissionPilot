import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  libelleDelais,
  libelleNiveau,
  lireDelais,
  lireFiltresBalance,
  messageRelance,
  requeteBalance,
  TRANCHES,
  validerParametresRelances,
  validerRelanceManuelle,
} from "./creances";

describe("balance âgée", () => {
  it("affiche les cinq tranches dans l'ordre", () => {
    expect(TRANCHES.map((t) => t.libelle)).toEqual([
      "Non échu",
      "0 à 30 jours",
      "31 à 60 jours",
      "61 à 90 jours",
      "Plus de 90 jours",
    ]);
  });

  it("lit la date et la base de calcul", () => {
    expect(lireFiltresBalance({ date: "2027-03-31", base: "emission" })).toEqual({
      date: "2027-03-31",
      base: "emission",
    });
    expect(lireFiltresBalance({ date: "faux", base: "x" })).toEqual({ date: "", base: "echeance" });
    expect(requeteBalance({ date: "", base: "echeance" })).toBe("base=echeance");
    expect(requeteBalance({ date: "2027-03-31", base: "emission" })).toBe(
      "base=emission&date=2027-03-31",
    );
  });
});

describe("relances", () => {
  it("lit des délais strictement croissants, de 1 à 3", () => {
    expect(lireDelais("7, 15, 30")).toEqual([7, 15, 30]);
    expect(lireDelais("J+10 ; J+20")).toEqual([10, 20]);
    expect(lireDelais("")).toMatch(/au moins/);
    expect(lireDelais("7, 15, 30, 45")).toMatch(/Trois/);
    expect(lireDelais("15, 7")).toMatch(/croissants/);
    expect(lireDelais("0")).toMatch(/1 à 365/);
    expect(lireDelais("7,5")).toMatch(/croissants/);
    expect(lireDelais("sept")).toMatch(/entiers/);
  });

  it("n'envoie jamais l'envoi automatique d'e-mail depuis le formulaire principal", () => {
    const r = validerParametresRelances({
      delais: "7, 15, 30",
      relances_actives: true,
      valeurs_validees: false,
    });
    expect(r).toEqual({
      ok: true,
      charge: { delais_relance: [7, 15, 30], relances_actives: true, valeurs_validees: false },
    });
    expect(r.ok && "envoi_email_client" in r.charge).toBe(false);
  });

  it("valide une relance manuelle", () => {
    expect(validerRelanceManuelle({ envoyer_email: false, message: "  " })).toEqual({
      ok: true,
      charge: { envoyer_email: false, message: null },
    });
    expect(validerRelanceManuelle({ envoyer_email: true, message: "x".repeat(1001) }).ok).toBe(
      false,
    );
  });

  it("nomme les niveaux et les délais", () => {
    expect(libelleNiveau(1)).toBe("Rappel amiable");
    expect(libelleNiveau(9)).toBe("Relance de niveau 9");
    expect(libelleDelais([7, 15, 30])).toBe("J+7, J+15, J+30");
  });

  it("relaie les refus de relance", () => {
    expect(messageRelance(new ErreurApi("CONFLIT", "La facture est soldée.", 409))).toBe(
      "La facture est soldée.",
    );
    expect(messageRelance(new ErreurApi("INTERDIT", "Non.", 403))).toBeNull();
    expect(messageRelance(new ErreurApi("RELANCE_DEJA_ENVOYEE", "Déjà envoyé.", 409))).toMatch(
      /Décochez l'envoi de l'e-mail/,
    );
  });
});
