import { describe, expect, it } from "vitest";
import {
  decisionRepli,
  type EntreeAutorisationEnvoi,
  type EntreeRepli,
  ErreurCanaux,
  fusionnerStatutEnvoi,
  peutEnvoyer,
  STATUTS_ENVOI,
} from "./index";

/** Tout est conforme : une relance autorisée. */
const conforme: EntreeAutorisationEnvoi = {
  compteActif: true,
  destinataireActif: true,
  numeroVerifie: true,
  consentement: "accorde",
  categorie: "relance",
  coupeCircuitN4: false,
  envoisInitiesDernieres24h: 0,
  envoisInitiesMois: 0,
  reponsesService24h: 0,
  heuresDepuisDernierEntrant: null,
};
const avec = (ecart: Partial<EntreeAutorisationEnvoi>) => peutEnvoyer({ ...conforme, ...ecart });

describe("peutEnvoyer (SPEC §18.2)", () => {
  it("la relance conforme est autorisée", () => {
    expect(avec({})).toEqual({ autorise: true, refus: [] });
  });

  it("A-01 : 2 envois en 24 h, autorisé", () => {
    expect(avec({ envoisInitiesDernieres24h: 2 }).autorise).toBe(true);
  });

  it("A-02 : 3 envois en 24 h, plafond du destinataire", () => {
    expect(avec({ envoisInitiesDernieres24h: 3 })).toEqual({
      autorise: false,
      refus: ["plafond_destinataire"],
    });
  });

  it("A-03 : consentement absent et numéro non vérifié, les deux motifs", () => {
    expect(avec({ consentement: "absent", numeroVerifie: false }).refus).toEqual([
      "consentement_absent",
      "numero_non_verifie",
    ]);
  });

  it("A-04 : synthèse avec coupe-circuit actif", () => {
    expect(avec({ categorie: "synthese", coupeCircuitN4: true }).refus).toEqual(["coupe_circuit"]);
    expect(avec({ categorie: "relance", coupeCircuitN4: true }).refus).toEqual(["coupe_circuit"]);
    // Les autres catégories à l'initiative du cabinet ne sont pas de classe R0 suspendue.
    expect(avec({ categorie: "signature", coupeCircuitN4: true }).autorise).toBe(true);
  });

  it("A-05 : un code de vérification est exempté de consentement et de vérification", () => {
    expect(
      avec({ categorie: "verification", consentement: "absent", numeroVerifie: false }),
    ).toEqual({ autorise: true, refus: [] });
    // Le coupe-circuit et les plafonds du cabinet ne le concernent pas non plus.
    expect(
      avec({
        categorie: "verification",
        coupeCircuitN4: true,
        envoisInitiesDernieres24h: 9,
        envoisInitiesMois: 9999,
      }).autorise,
    ).toBe(true);
    // Mais un compte ou un destinataire inactif le bloque.
    expect(avec({ categorie: "verification", compteActif: false }).refus).toEqual([
      "canal_inactif",
    ]);
  });

  it("A-06 : réponse de service après retrait, selon la fenêtre de 24 h", () => {
    const base = { categorie: "reponse_service" as const, consentement: "retire" as const };
    expect(avec({ ...base, heuresDepuisDernierEntrant: 0.1 }).autorise).toBe(true);
    expect(avec({ ...base, heuresDepuisDernierEntrant: 24 }).autorise).toBe(true);
    expect(avec({ ...base, heuresDepuisDernierEntrant: 24.5 }).refus).toEqual(["fenetre_fermee"]);
    expect(avec({ ...base, heuresDepuisDernierEntrant: null }).refus).toEqual(["fenetre_fermee"]);
  });

  it("A-07 : 2 000 envois dans le mois, plafond du cabinet", () => {
    expect(avec({ envoisInitiesMois: 1999 }).autorise).toBe(true);
    expect(avec({ envoisInitiesMois: 2000 }).refus).toEqual(["plafond_cabinet"]);
  });

  it("A-08 : compte inactif et destinataire inactif, consentement conforme", () => {
    expect(avec({ compteActif: false, destinataireActif: false }).refus).toEqual([
      "canal_inactif",
      "destinataire_inactif",
    ]);
  });

  it("A-09 : 10 réponses de service en 24 h", () => {
    const base = { categorie: "reponse_service" as const, heuresDepuisDernierEntrant: 1 };
    expect(avec({ ...base, reponsesService24h: 9 }).autorise).toBe(true);
    expect(avec({ ...base, reponsesService24h: 10 }).refus).toEqual(["plafond_reponses"]);
    expect(
      avec({ ...base, reponsesService24h: 10, heuresDepuisDernierEntrant: null }).refus,
    ).toEqual(["fenetre_fermee", "plafond_reponses"]);
  });

  it("A-10 : consentement retiré", () => {
    expect(avec({ consentement: "retire" }).refus).toEqual(["consentement_retire"]);
  });

  it("collecte tous les refus dans l'ordre des règles", () => {
    expect(
      avec({
        compteActif: false,
        destinataireActif: false,
        consentement: "retire",
        numeroVerifie: false,
        coupeCircuitN4: true,
        envoisInitiesDernieres24h: 3,
        envoisInitiesMois: 2000,
      }).refus,
    ).toEqual([
      "canal_inactif",
      "destinataire_inactif",
      "consentement_retire",
      "numero_non_verifie",
      "coupe_circuit",
      "plafond_destinataire",
      "plafond_cabinet",
    ]);
  });

  it("refuse un compteur négatif ou non fini", () => {
    expect(() => avec({ envoisInitiesDernieres24h: -1 })).toThrowError(ErreurCanaux);
    expect(() => avec({ envoisInitiesMois: Number.NaN })).toThrowError(ErreurCanaux);
    expect(() => avec({ reponsesService24h: Infinity })).toThrowError(ErreurCanaux);
    expect(() => avec({ heuresDepuisDernierEntrant: -2 })).toThrowError(ErreurCanaux);
  });
});

describe("fusionnerStatutEnvoi", () => {
  it("cas de la spécification", () => {
    expect(fusionnerStatutEnvoi("lu", "livre")).toBe("lu");
    expect(fusionnerStatutEnvoi("accepte", "lu")).toBe("lu");
    expect(fusionnerStatutEnvoi("livre", "echec")).toBe("livre");
    expect(fusionnerStatutEnvoi("accepte", "echec")).toBe("echec");
    expect(fusionnerStatutEnvoi("incertain", "livre")).toBe("incertain");
  });

  it("monotone : un statut de rang inférieur est ignoré, « envoye » vaut accepté", () => {
    expect(fusionnerStatutEnvoi("accepte", "livre")).toBe("livre");
    expect(fusionnerStatutEnvoi("livre", "envoye")).toBe("livre");
    expect(fusionnerStatutEnvoi("livre", "livre")).toBe("livre");
    expect(fusionnerStatutEnvoi("accepte", "envoye")).toBe("accepte");
    expect(fusionnerStatutEnvoi("livre", "lu")).toBe("lu");
  });

  it("les statuts terminaux ne changent plus, un envoi non accepté non plus", () => {
    for (const terminal of ["bloque", "incertain", "echec", "lu"] as const) {
      for (const recu of ["envoye", "livre", "lu", "echec"] as const) {
        expect(fusionnerStatutEnvoi(terminal, recu)).toBe(terminal);
      }
    }
    for (const attente of ["reserve", "en_cours"] as const) {
      for (const recu of ["envoye", "livre", "lu", "echec"] as const) {
        expect(fusionnerStatutEnvoi(attente, recu)).toBe(attente);
      }
    }
    expect(STATUTS_ENVOI).toHaveLength(8);
  });
});

describe("decisionRepli", () => {
  const base: EntreeRepli = {
    codeRefus: "NUMERO_NON_JOIGNABLE",
    tentativesEpuisees: false,
    categorie: "relance",
    repliActif: true,
    consentementSms: "accorde",
    numeroSmsVerifie: true,
  };
  const avecRepli = (ecart: Partial<EntreeRepli>) => decisionRepli({ ...base, ...ecart });

  it("refus définitif : repli", () => {
    for (const codeRefus of [
      "NUMERO_NON_JOIGNABLE",
      "GABARIT_REFUSE",
      "QUOTA_ATTEINT",
      "FENETRE_FERMEE",
    ] as const) {
      expect(avecRepli({ codeRefus })).toBe(true);
    }
  });

  it("INDISPONIBLE : repli seulement après épuisement des tentatives", () => {
    expect(avecRepli({ codeRefus: "INDISPONIBLE", tentativesEpuisees: false })).toBe(false);
    expect(avecRepli({ codeRefus: "INDISPONIBLE", tentativesEpuisees: true })).toBe(true);
  });

  it("jamais pour une vérification ni une réponse de service", () => {
    expect(avecRepli({ categorie: "verification" })).toBe(false);
    expect(avecRepli({ categorie: "reponse_service" })).toBe(false);
    for (const categorie of ["relance", "synthese", "signature", "alerte"] as const) {
      expect(avecRepli({ categorie })).toBe(true);
    }
  });

  it("exige repli actif, consentement SMS accordé et numéro SMS vérifié", () => {
    expect(avecRepli({ repliActif: false })).toBe(false);
    expect(avecRepli({ consentementSms: "absent" })).toBe(false);
    expect(avecRepli({ consentementSms: "retire" })).toBe(false);
    expect(avecRepli({ numeroSmsVerifie: false })).toBe(false);
  });
});
