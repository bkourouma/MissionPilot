import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  chargeModele,
  clotureActivable,
  compterAnomalies,
  derogationPossible,
  droitsCloture,
  hrefControleCloture,
  libelleEcarts,
  messageClotureBloquee,
  modeleModifie,
  raisonClotureImpossible,
  validerAttestation,
  validerMotifDerogation,
  type ItemModeleCloture,
} from "./cloture";

const M = "0b6c2d1e-0000-4000-8000-0000000000aa";

describe("droitsCloture", () => {
  it("l'associé et le directeur de mission dérogent et clôturent une mission à clôturer", () => {
    for (const role of ["associe", "directeur_mission"] as const) {
      expect(droitsCloture([role], "a_cloturer")).toMatchObject({ deroger: true, cloturer: true });
    }
  });

  it("le chef de mission évalue sans déroger ni clôturer", () => {
    expect(droitsCloture(["chef_mission"], "a_cloturer")).toEqual({
      deroger: false,
      evaluer: true,
      cloturer: false,
      parametrer: false,
    });
  });

  it("la clôture n'est possible que depuis « à clôturer » ; plus rien sur une mission clôturée", () => {
    expect(droitsCloture(["associe"], "en_cours")).toMatchObject({
      cloturer: false,
      deroger: true,
    });
    expect(droitsCloture(["associe"], "cloturee")).toMatchObject({
      cloturer: false,
      deroger: false,
      evaluer: false,
    });
  });

  it("seul l'associé paramètre le modèle", () => {
    expect(droitsCloture(["associe"], "en_cours").parametrer).toBe(true);
    expect(droitsCloture(["directeur_mission"], "en_cours").parametrer).toBe(false);
  });
});

describe("clotureActivable et raisonClotureImpossible", () => {
  const ok = { autorisee: true, statut_mission: "a_cloturer" as const, bloquants: [] };
  it("actif seulement si tout est vert, mission à clôturer et droit de clôturer", () => {
    expect(clotureActivable(ok, { cloturer: true })).toBe(true);
    expect(clotureActivable(ok, { cloturer: false })).toBe(false);
    expect(clotureActivable({ ...ok, autorisee: false }, { cloturer: true })).toBe(false);
    expect(clotureActivable({ ...ok, statut_mission: "en_cours" }, { cloturer: true })).toBe(false);
  });

  it("explique le blocage", () => {
    expect(raisonClotureImpossible(ok)).toBeNull();
    expect(raisonClotureImpossible({ ...ok, statut_mission: "cloturee" })).toMatch(/déjà clôturée/);
    expect(raisonClotureImpossible({ ...ok, statut_mission: "en_cours" })).toMatch(/À clôturer/);
    expect(
      raisonClotureImpossible({
        ...ok,
        autorisee: false,
        bloquants: ["debours_traites", "livrables_signes"],
      }),
    ).toBe("Items bloquants à traiter ou à déroger : Débours traités, Livrables signés.");
  });
});

describe("présentation des items", () => {
  it("libellé des écarts", () => {
    const base = { controle: "debours_traites" as const };
    expect(libelleEcarts({ ...base, etat: "conforme", nombre_ecarts: 0 })).toBeNull();
    expect(libelleEcarts({ ...base, etat: "inactif", nombre_ecarts: null })).toBeNull();
    expect(libelleEcarts({ ...base, etat: "bloque", nombre_ecarts: 1 })).toBe("1 écart");
    expect(libelleEcarts({ ...base, etat: "bloque", nombre_ecarts: 3 })).toBe("3 écarts");
    expect(libelleEcarts({ ...base, etat: "bloque", nombre_ecarts: null })).toBe("Non vérifié");
    expect(
      libelleEcarts({ controle: "capitalisation_faite", etat: "bloque", nombre_ecarts: null }),
    ).toBe("Non attestée");
  });

  it("chaque contrôle renvoie vers son écran, sauf l'attestation traitée sur place", () => {
    expect(hrefControleCloture("temps_valides", M)).toBe("/temps/validation");
    expect(hrefControleCloture("debours_traites", M)).toBe(`/missions/${M}/debours`);
    expect(hrefControleCloture("factures_emises", M)).toBe(`/missions/${M}/facturation`);
    expect(hrefControleCloture("encaissements_soldes", M)).toBe(`/missions/${M}/facturation`);
    expect(hrefControleCloture("livrables_signes", M)).toContain(M);
    expect(hrefControleCloture("satisfaction_demandee", M)).toContain(M);
    expect(hrefControleCloture("capitalisation_faite", M)).toBeNull();
  });

  it("compte les anomalies et n'autorise la dérogation que sur un item bloquant", () => {
    const items = [
      { etat: "bloque" as const },
      { etat: "bloque" as const },
      { etat: "avertissement" as const },
      { etat: "deroge" as const },
      { etat: "conforme" as const },
    ];
    expect(compterAnomalies(items)).toEqual({ bloquants: 2, avertissements: 1, deroges: 1 });
    expect(derogationPossible({ etat: "bloque" })).toBe(true);
    expect(derogationPossible({ etat: "deroge" })).toBe(false);
    expect(derogationPossible({ etat: "avertissement" })).toBe(false);
  });
});

describe("validations de saisie", () => {
  it("le motif de dérogation est obligatoire, de 10 à 500 caractères", () => {
    expect(validerMotifDerogation("  ")).toEqual({
      ok: false,
      erreurs: { motif: "Indiquez le motif de la dérogation." },
    });
    expect(validerMotifDerogation("court").ok).toBe(false);
    expect(validerMotifDerogation("x".repeat(501)).ok).toBe(false);
    expect(validerMotifDerogation("  Paiement attendu fin mois  ")).toEqual({
      ok: true,
      charge: { motif: "Paiement attendu fin mois" },
    });
  });

  it("l'attestation accepte une note facultative bornée", () => {
    expect(validerAttestation("")).toEqual({
      ok: true,
      charge: { controle: "capitalisation_faite", attestee: true },
    });
    expect(validerAttestation(" Fiche déposée ")).toEqual({
      ok: true,
      charge: { controle: "capitalisation_faite", attestee: true, note: "Fiche déposée" },
    });
    expect(validerAttestation("x".repeat(501)).ok).toBe(false);
  });
});

describe("modèle du cabinet", () => {
  const initial: ItemModeleCloture[] = [
    {
      controle: "temps_valides",
      libelle: "Temps validés",
      description: "",
      actif: true,
      bloquant: true,
      par_attestation: false,
      par_defaut: true,
    },
  ];

  it("un item désactivé n'est jamais envoyé bloquant", () => {
    expect(
      chargeModele([{ controle: "temps_valides", actif: false, bloquant: true }]).items[0],
    ).toEqual({ controle: "temps_valides", actif: false, bloquant: false });
  });

  it("détecte une modification, y compris un item absent de l'état initial", () => {
    const meme = [{ controle: "temps_valides" as const, actif: true, bloquant: true }];
    expect(modeleModifie(initial, meme)).toBe(false);
    expect(modeleModifie(initial, [{ ...meme[0]!, bloquant: false }])).toBe(true);
    expect(modeleModifie(initial, [{ ...meme[0]!, actif: false }])).toBe(true);
    expect(
      modeleModifie(initial, [{ controle: "debours_traites", actif: true, bloquant: true }]),
    ).toBe(true);
  });
});

describe("messageClotureBloquee", () => {
  it("ne reconnaît que le code CLOTURE_BLOQUEE", () => {
    expect(
      messageClotureBloquee(new ErreurApi("CLOTURE_BLOQUEE", "Clôture impossible.", 409)),
    ).toBe("Clôture impossible.");
    expect(messageClotureBloquee(new ErreurApi("CONFLIT", "Autre.", 409))).toBeNull();
    expect(messageClotureBloquee(new Error("x"))).toBeNull();
  });
});
