import { describe, expect, it } from "vitest";
import {
  redCovenantsVersionCreationSchema,
  redFinancementVersionCreationSchema,
  type RedCovenantsVersionVue,
  type RedFinancementPropositionVue,
  type RedFinancementVersionVue,
} from "@missionpilot/shared";
import {
  appliquerProposition,
  cadreProposition,
  corpsCovenantsDepuisFormulaire,
  corpsFinancementDepuisFormulaire,
  covenantVide,
  estPremierDuMois,
  ligneFinancementVide,
  lireSeuilCovenant,
  messageProposition,
  premierDuMoisSuivant,
  saisieCovenantsDepuis,
  saisieFinancementDepuis,
  seuilVersSaisie,
  type SaisieCovenant,
  type SaisieFinancement,
} from "./redressement-financement-saisie";

const personne = { id: "u1", nom: "Awa" };

function ok<C, K extends string>(
  r: { ok: true; charge: C } | { ok: false; erreurs: Partial<Record<K, string>> },
) {
  if (!r.ok) throw new Error(`Attendu ok, erreurs : ${JSON.stringify(r.erreurs)}`);
  return r.charge;
}
function ko<C, K extends string>(
  r: { ok: true; charge: C } | { ok: false; erreurs: Partial<Record<K, string>> },
) {
  if (r.ok) throw new Error("Attendu une erreur");
  return r.erreurs;
}

describe("covenants : seuils", () => {
  it("convertit le seuil dans l'unité du ratio", () => {
    expect(lireSeuilCovenant("1,2", "liquidite_generale")).toBe(12000);
    expect(lireSeuilCovenant("25", "autonomie_financiere")).toBe(2500);
    expect(lireSeuilCovenant("-0,5", "liquidite_generale")).toBe(-5000);
    expect(lireSeuilCovenant("", "liquidite_generale")).toBeNull();
    expect(lireSeuilCovenant("abc", "liquidite_generale")).toBeNaN();
    // Trop précis : un pourcentage a deux décimales, un rapport quatre.
    expect(lireSeuilCovenant("25,123", "autonomie_financiere")).toBeNaN();
    expect(lireSeuilCovenant("1,23456", "liquidite_generale")).toBeNaN();
    // Au-delà du plafond de l'API.
    expect(lireSeuilCovenant("100000", "liquidite_generale")).toBeNaN();
  });

  it("renvoie un seuil à l'identique", () => {
    expect(seuilVersSaisie("liquidite_generale", 12000)).toBe("1,2");
    expect(seuilVersSaisie("autonomie_financiere", 2500)).toBe("25");
    expect(lireSeuilCovenant(seuilVersSaisie("endettement", 20050), "endettement")).toBe(20050);
  });
});

describe("covenants : nouvelle version", () => {
  const version: RedCovenantsVersionVue = {
    id: "v1",
    version: 2,
    motif: null,
    cree_par: personne,
    cree_le: "2026-10-20T10:00:00Z",
    covenants: [
      {
        id: "c1",
        rang: 1,
        ratio: "liquidite_generale",
        operateur: "min",
        seuil_pb: 12000,
        preteur: "Banque A",
        frequence: "trimestrielle",
        evaluation: {
          statut: "respecte",
          valeur_pb: 13000,
          marge_pb: 1000,
          raison: null,
          manquants: [],
        },
      },
    ],
  };
  const ligne = (p: Partial<SaisieCovenant>): SaisieCovenant => ({
    ...covenantVide(),
    seuil: "1",
    ...p,
  });

  it("préremplit depuis la version courante et la renvoie à l'identique", () => {
    const s = saisieCovenantsDepuis(version);
    expect(s.covenants[0]).toMatchObject({ seuil: "1,2", preteur: "Banque A" });
    const corps = ok(corpsCovenantsDepuisFormulaire(s));
    expect(corps.covenants).toEqual([
      {
        ratio: "liquidite_generale",
        operateur: "min",
        seuil_pb: 12000,
        preteur: "Banque A",
        frequence: "trimestrielle",
      },
    ]);
    expect(redCovenantsVersionCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("accepte zéro covenant et un motif", () => {
    const corps = ok(corpsCovenantsDepuisFormulaire({ covenants: [], motif: " Avenant " }));
    expect(corps).toEqual({ covenants: [], motif: "Avenant" });
    expect(saisieCovenantsDepuis(null).covenants).toEqual([]);
  });

  it("refuse un seuil vide ou illisible, avec le numéro du covenant", () => {
    expect(
      ko(corpsCovenantsDepuisFormulaire({ covenants: [ligne({ seuil: "" })], motif: "" }))
        .covenants,
    ).toContain("Covenant 1");
    expect(
      ko(corpsCovenantsDepuisFormulaire({ covenants: [ligne({ seuil: "x" })], motif: "" }))
        .covenants,
    ).toContain("seuil lisible");
  });

  it("refuse un doublon ratio et opérateur, et un plancher au-dessus du plafond", () => {
    const doublon = [ligne({}), ligne({})];
    expect(
      ko(corpsCovenantsDepuisFormulaire({ covenants: doublon, motif: "" })).covenants,
    ).toContain("deux fois le même opérateur");
    const croise = [
      ligne({ operateur: "min", seuil: "2" }),
      ligne({ operateur: "max", seuil: "1" }),
    ];
    expect(
      ko(corpsCovenantsDepuisFormulaire({ covenants: croise, motif: "" })).covenants,
    ).toContain("plancher");
    const bon = [ligne({ operateur: "min", seuil: "1" }), ligne({ operateur: "max", seuil: "2" })];
    expect(
      redCovenantsVersionCreationSchema.safeParse(
        ok(corpsCovenantsDepuisFormulaire({ covenants: bon, motif: "" })),
      ).success,
    ).toBe(true);
  });

  it("refuse plus de douze covenants, un prêteur trop long et un motif trop long", () => {
    const treize = Array.from({ length: 13 }, (_, i) =>
      ligne({ ratio: i % 2 ? "endettement" : "liquidite_generale" }),
    );
    expect(
      ko(corpsCovenantsDepuisFormulaire({ covenants: treize, motif: "" })).covenants,
    ).toContain("12 covenants");
    expect(
      ko(
        corpsCovenantsDepuisFormulaire({
          covenants: [ligne({ preteur: "x".repeat(121) })],
          motif: "",
        }),
      ).covenants,
    ).toContain("120 caractères");
    expect(
      ko(corpsCovenantsDepuisFormulaire({ covenants: [], motif: "m".repeat(501) })).motif,
    ).toContain("500");
  });
});

describe("plan de financement : saisie", () => {
  const version: RedFinancementVersionVue = {
    id: "f1",
    version: 1,
    date_debut: "2027-01-01",
    type_periode: "semestre",
    nombre_periodes: 2,
    motif: null,
    cree_par: personne,
    cree_le: "2026-10-20T10:00:00Z",
    lignes: [
      {
        id: "l1",
        rang: 1,
        periode: 1,
        sens: "emploi",
        nature: "investissements",
        libelle: null,
        montant: 150_000,
      },
      {
        id: "l2",
        rang: 2,
        periode: 2,
        sens: "ressource",
        nature: "apport_associes",
        libelle: "Apport",
        montant: 5_000_000,
      },
    ],
  };

  it("propose le premier du mois suivant pour un premier plan", () => {
    expect(premierDuMoisSuivant("2026-10-20")).toBe("2026-11-01");
    expect(premierDuMoisSuivant("2026-12-31")).toBe("2027-01-01");
    expect(estPremierDuMois("2027-01-01")).toBe(true);
    expect(estPremierDuMois("2027-01-02")).toBe(false);
    expect(estPremierDuMois("")).toBe(false);
    const s = saisieFinancementDepuis(null, "XOF", "2026-10-20");
    expect(s).toMatchObject({
      date_debut: "2026-11-01",
      type_periode: "annee",
      nombre_periodes: "3",
      lignes: [],
    });
  });

  it("préremplit depuis la version courante et la renvoie à l'identique", () => {
    const s = saisieFinancementDepuis(version, "XOF", "2026-10-20");
    const corps = ok(corpsFinancementDepuisFormulaire(s, "XOF"));
    expect(corps).toMatchObject({
      date_debut: "2027-01-01",
      type_periode: "semestre",
      nombre_periodes: 2,
    });
    expect(corps.lignes).toEqual([
      { periode: 1, sens: "emploi", nature: "investissements", montant: 150_000 },
      {
        periode: 2,
        sens: "ressource",
        nature: "apport_associes",
        libelle: "Apport",
        montant: 5_000_000,
      },
    ]);
    expect(redFinancementVersionCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("convertit les montants en unités mineures (EUR)", () => {
    const s = saisieFinancementDepuis(version, "EUR", "2026-10-20");
    expect(s.lignes[0]?.montant).toBe("1500");
    expect(ok(corpsFinancementDepuisFormulaire(s, "EUR")).lignes[0]?.montant).toBe(150_000);
  });

  const base = (): SaisieFinancement => saisieFinancementDepuis(version, "XOF", "2026-10-20");

  it("refuse un cadre invalide", () => {
    const e = ko(
      corpsFinancementDepuisFormulaire(
        { ...base(), date_debut: "2027-01-15", nombre_periodes: "9" },
        "XOF",
      ),
    );
    expect(e.date_debut).toBe("Un premier jour de mois est attendu.");
    expect(e.nombre_periodes).toContain("1 à 8");
    expect(
      ko(corpsFinancementDepuisFormulaire({ ...base(), date_debut: "n" }, "XOF")).date_debut,
    ).toContain("illisible");
  });

  it("ignore une ligne sans montant et refuse un montant nul ou illisible", () => {
    const s = base();
    const vide = { ...ligneFinancementVide(), montant: "" };
    expect(
      ok(corpsFinancementDepuisFormulaire({ ...s, lignes: [...s.lignes, vide] }, "XOF")).lignes,
    ).toHaveLength(2);
    const zero = { ...ligneFinancementVide(), montant: "0" };
    expect(ko(corpsFinancementDepuisFormulaire({ ...s, lignes: [zero] }, "XOF")).lignes).toContain(
      "supérieur à zéro",
    );
    const illisible = { ...ligneFinancementVide(), montant: "12,5" };
    expect(
      ko(corpsFinancementDepuisFormulaire({ ...s, lignes: [illisible] }, "XOF")).lignes,
    ).toContain("Ligne 1");
  });

  it("refuse une période hors plan, une nature d'un autre sens et trop de lignes", () => {
    const s = base();
    const hors = { ...ligneFinancementVide(), montant: "10", periode: "3" };
    expect(ko(corpsFinancementDepuisFormulaire({ ...s, lignes: [hors] }, "XOF")).lignes).toContain(
      "dépasse",
    );
    const croisee = { ...ligneFinancementVide("emploi"), montant: "10", nature: "apport_associes" };
    expect(
      ko(corpsFinancementDepuisFormulaire({ ...s, lignes: [croisee] }, "XOF")).lignes,
    ).toContain("nature");
    const libelle = { ...ligneFinancementVide(), montant: "10", libelle: "x".repeat(201) };
    expect(
      ko(corpsFinancementDepuisFormulaire({ ...s, lignes: [libelle] }, "XOF")).lignes,
    ).toContain("200");
    const beaucoup = Array.from({ length: 201 }, () => ({
      ...ligneFinancementVide(),
      montant: "10",
    }));
    expect(
      ko(corpsFinancementDepuisFormulaire({ ...s, lignes: beaucoup }, "XOF")).lignes,
    ).toContain("200 lignes");
  });
});

describe("plan de financement : proposition", () => {
  const proposition: RedFinancementPropositionVue = {
    devise: "XOF",
    cadre: { date_debut: "2027-01-01", type_periode: "annee", nombre_periodes: 2 },
    lignes: [
      {
        periode: 1,
        sens: "emploi",
        nature: "remboursement_dettes_accords",
        montant: 900_000,
        origine: "accords",
        nombre_echeances: 3,
      },
      {
        periode: 1,
        sens: "emploi",
        nature: "besoin_fonds_roulement",
        montant: 400_000,
        origine: "tresorerie",
        nombre_echeances: 0,
      },
    ],
    anterieures: 1,
    ulterieures: 2,
    besoin_hors_plan: true,
    besoin_tresorerie: null,
  };

  it("alimente le brouillon, garde les lignes manuelles et remplace les lignes déjà proposées", () => {
    const manuelle = { ...ligneFinancementVide("ressource"), montant: "50" };
    const vide = saisieFinancementDepuis(null, "XOF", "2026-10-20");
    const premier = appliquerProposition({ ...vide, lignes: [manuelle] }, proposition, "XOF");
    expect(premier).toMatchObject({
      date_debut: "2027-01-01",
      type_periode: "annee",
      nombre_periodes: "2",
    });
    expect(premier.lignes).toHaveLength(3);
    expect(premier.lignes[1]).toMatchObject({
      montant: "900000",
      origine: "accords",
      periode: "1",
    });
    // Un second pré-remplissage ne double rien.
    const second = appliquerProposition(premier, proposition, "XOF");
    expect(second.lignes).toHaveLength(3);
    expect(second.lignes[0]?.cle).toBe(manuelle.cle);
    // Le brouillon pré-rempli est enregistrable tel quel.
    const corps = ok(corpsFinancementDepuisFormulaire(second, "XOF"));
    expect(redFinancementVersionCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("rend compte de la proposition sans rien promettre d'enregistré", () => {
    const m = messageProposition(proposition);
    expect(m).toContain("2 ligne(s) proposée(s), non enregistrée(s)");
    expect(m).toContain("1 échéance(s) antérieure(s) et 2 postérieure(s)");
    expect(m).toContain("hors de la période du plan");
    expect(
      messageProposition({
        ...proposition,
        anterieures: 0,
        ulterieures: 0,
        besoin_hors_plan: false,
      }),
    ).not.toContain("antérieure");
  });

  it("ne transmet à la proposition que les champs lisibles du formulaire", () => {
    const s = saisieFinancementDepuis(null, "XOF", "2026-10-20");
    expect(cadreProposition(s)).toEqual({
      date_debut: "2026-11-01",
      type_periode: "annee",
      nombre_periodes: 3,
    });
    expect(cadreProposition({ ...s, date_debut: "2026-11-05", nombre_periodes: "x" })).toEqual({
      type_periode: "annee",
    });
  });
});
