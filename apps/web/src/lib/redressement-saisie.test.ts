import { describe, expect, it } from "vitest";
import {
  RED_CRITERES_ALERTE,
  redActionCreationSchema,
  redActionModificationSchema,
  redCorrespondanceCreationSchema,
  redCreanceCreationSchema,
  redCreancierCreationSchema,
  redEvenementNegociationSchema,
  redPointMortSchema,
  redRealiseCreationSchema,
  redScoreCreationSchema,
  redSeuilsCreationSchema,
  redTresorerieVersionCreationSchema,
  redUrgenceCreationSchema,
  type RedDefinitionLevierVue,
  type RedSeuils,
} from "@missionpilot/shared";
import {
  compterReponses,
  corpsActionDepuisFormulaire,
  corpsAnnulationPaiement,
  corpsCloture,
  corpsCorrespondanceDepuisFormulaire,
  corpsCreanceDepuisFormulaire,
  corpsCreancierDepuisFormulaire,
  corpsDossierDepuisFormulaire,
  corpsEvenementDepuisFormulaire,
  corpsPointMortDepuisFormulaire,
  corpsRealiseDepuisFormulaire,
  corpsScoreDepuisFormulaire,
  corpsSeuilsDepuisFormulaire,
  corpsSimulationDepuisFormulaire,
  corpsUrgenceDepuisFormulaire,
  corpsVersionDepuisFormulaire,
  estLundi,
  evenementVide,
  grouperQuestions,
  ligneVide,
  libelleCompteur,
  lireEntier,
  lireMontantRed,
  lireSolde,
  parametresDepuisSaisie,
  parserCodes,
  prochainLundi,
  saisieCorrespondanceDepuis,
  saisieIncidentsDepuis,
  saisieRealiseVide,
  saisieSeuilsDepuis,
  saisieVersionDepuis,
  sommeDesPoids,
  type SaisieAction,
  type SaisieCorrespondance,
  type SaisieEvenement,
  type SaisieVersionTresorerie,
} from "./redressement-saisie";

const ok = <C, K extends string>(
  r: { ok: true; charge: C } | { ok: false; erreurs: Partial<Record<K, string>> },
) => {
  if (!r.ok) throw new Error(`Validation refusée : ${JSON.stringify(r.erreurs)}`);
  return r.charge;
};
const ko = <C, K extends string>(
  r: { ok: true; charge: C } | { ok: false; erreurs: Partial<Record<K, string>> },
) => {
  if (r.ok) throw new Error("Validation acceptée à tort");
  return r.erreurs;
};

describe("lecture des montants et des entiers", () => {
  it("lit un montant avec espaces, refuse décimale (XOF), négatif et dépassement", () => {
    expect(lireMontantRed("1 200 000", "XOF")).toBe(1_200_000);
    expect(lireMontantRed("1\u202f200\u00a0000", "XOF")).toBe(1_200_000);
    expect(lireMontantRed("", "XOF")).toBeNull();
    expect(lireMontantRed("1200,5", "XOF")).toBeNaN();
    expect(lireMontantRed("-5", "XOF")).toBeNaN();
    expect(lireMontantRed("abc", "XOF")).toBeNaN();
    expect(lireMontantRed("1500,5", "EUR")).toBe(150050);
    expect(lireMontantRed("100000000000000", "XOF")).toBeNaN();
  });

  it("lit un solde signé", () => {
    expect(lireSolde("-250 000", "XOF")).toBe(-250_000);
    expect(lireSolde("−250 000", "XOF")).toBe(-250_000);
    expect(lireSolde("250 000", "XOF")).toBe(250_000);
    expect(lireSolde("-0", "XOF")).toBe(0);
    expect(lireSolde("", "XOF")).toBeNull();
    expect(lireSolde("-", "XOF")).toBeNaN();
  });

  it("lit un entier borné", () => {
    expect(lireEntier("12", 1, 13)).toBe(12);
    expect(lireEntier("14", 1, 13)).toBeNaN();
    expect(lireEntier("1,5", 1, 13)).toBeNaN();
    expect(lireEntier(" ", 1, 13)).toBeNull();
  });

  it("repère les lundis et propose le lundi suivant", () => {
    expect(estLundi("2026-11-02")).toBe(true);
    expect(estLundi("2026-11-03")).toBe(false);
    expect(prochainLundi("2026-10-11")).toBe("2026-10-12");
    expect(prochainLundi("2026-10-12")).toBe("2026-10-19");
    expect(prochainLundi("2026-10-14")).toBe("2026-10-19");
  });
});

describe("parserCodes", () => {
  it("normalise la casse, écarte vides et doublons", () => {
    expect(parserCodes("BB, bi")).toEqual(["BB", "BI"]);
    expect(parserCodes("BB;BB  bb,, ")).toEqual(["BB"]);
    expect(parserCodes("")).toEqual([]);
  });

  it("reprend l'écriture de l'état du client quand le code y figure", () => {
    expect(parserCodes("bb, Xy_1", ["BB", "xy_1"])).toEqual(["BB", "xy_1"]);
  });

  it("garde tous les codes saisis (la limite de 50 est contrôlée à l'envoi)", () => {
    const beaucoup = Array.from({ length: 60 }, (_, i) => `C${i}`).join(",");
    expect(parserCodes(beaucoup)).toHaveLength(60);
  });
});

describe("correspondance de postes", () => {
  const vide = saisieCorrespondanceDepuis(null);
  const avec = (modif: Partial<SaisieCorrespondance>): SaisieCorrespondance => ({
    ...vide,
    ...modif,
  });

  it("omet les postes sans code, garde « Sans objet » et respecte le schéma partagé", () => {
    const corps = ok(
      corpsCorrespondanceDepuisFormulaire(
        avec({
          stocks: { codes: "bb, bc", sans_objet: false },
          capital: { codes: "", sans_objet: true },
        }),
        "  Première version  ",
      ),
    );
    expect(corps).toEqual({
      postes: {
        stocks: { codes: ["BB", "BC"], sans_objet: false },
        capital: { codes: [], sans_objet: true },
      },
      motif: "Première version",
    });
    expect(redCorrespondanceCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("refuse une correspondance vide, un poste sans objet avec codes et trop de codes", () => {
    expect(ko(corpsCorrespondanceDepuisFormulaire(vide, "")).postes).toContain("au moins un poste");
    expect(
      ko(
        corpsCorrespondanceDepuisFormulaire(
          avec({ stocks: { codes: "BB", sans_objet: true } }),
          "",
        ),
      )["poste.stocks"],
    ).toContain("sans objet");
    const beaucoup = Array.from({ length: 51 }, (_, i) => `C${i}`).join(",");
    expect(
      ko(
        corpsCorrespondanceDepuisFormulaire(
          avec({ stocks: { codes: beaucoup, sans_objet: false } }),
          "",
        ),
      )["poste.stocks"],
    ).toContain("Cinquante");
    expect(
      ko(
        corpsCorrespondanceDepuisFormulaire(
          avec({ stocks: { codes: "B B/!", sans_objet: false } }),
          "",
        ),
      )["poste.stocks"],
    ).toBeDefined();
  });

  it("préremplit depuis une correspondance existante", () => {
    const s = saisieCorrespondanceDepuis({ stocks: { codes: ["BB", "BC"], sans_objet: false } });
    expect(s.stocks).toEqual({ codes: "BB, BC", sans_objet: false });
    expect(s.capital).toEqual({ codes: "", sans_objet: false });
  });
});

describe("questionnaire d'urgence", () => {
  const grille = [
    { code: "T1", domaine: "tresorerie" as const, libelle: "Q1", critique: true },
    { code: "T2", domaine: "tresorerie" as const, libelle: "Q2", critique: false },
    { code: "A1", domaine: "activite" as const, libelle: "Q3", critique: false },
  ];

  it("regroupe les questions par domaine dans l'ordre des domaines", () => {
    const g = grouperQuestions(grille);
    expect(g.map((x) => [x.domaine, x.questions.length])).toEqual([
      ["tresorerie", 2],
      ["activite", 1],
    ]);
  });

  it("compte les réponses et annonce « 12 questions sur 15 renseignées »", () => {
    expect(compterReponses({ T1: "oui", T2: undefined, A1: "non" })).toBe(2);
    expect(libelleCompteur(12, 15)).toBe("12 questions sur 15 renseignées");
    expect(libelleCompteur(1, 15)).toBe("1 question sur 15 renseignée");
    expect(libelleCompteur(0, 15)).toBe("0 question sur 15 renseignée");
  });

  it("n'envoie que les questions renseignées et la durée passée sur la page", () => {
    const corps = ok(
      corpsUrgenceDepuisFormulaire(
        { T1: "oui", T2: undefined, A1: "inconnu" },
        125,
        " note ",
        grille,
      ),
    );
    expect(corps).toEqual({
      reponses: { T1: "oui", A1: "inconnu" },
      duree_secondes: 125,
      commentaire: "note",
    });
    expect(redUrgenceCreationSchema.safeParse(corps).success).toBe(true);
    expect(
      ok(corpsUrgenceDepuisFormulaire({ T1: "non" }, null, "", grille)).duree_secondes,
    ).toBeUndefined();
    expect(
      ok(corpsUrgenceDepuisFormulaire({ T1: "non" }, 999_999, "", grille)).duree_secondes,
    ).toBe(86_400);
  });

  it("refuse une évaluation sans réponse et ignore une question inconnue", () => {
    expect(ko(corpsUrgenceDepuisFormulaire({}, 10, "", grille)).reponses).toContain(
      "au moins une question",
    );
    expect(ko(corpsUrgenceDepuisFormulaire({ Z9: "oui" }, 10, "", grille)).reponses).toBeDefined();
  });
});

describe("incidents de paiement", () => {
  it("envoie null pour un champ vide ou inconnu (jamais zéro)", () => {
    const corps = ok(corpsScoreDepuisFormulaire({ rejets: "", retards: "2", arrieres: "inconnu" }));
    expect(corps).toEqual({
      incidents: {
        rejets_bancaires_12m: null,
        retards_fournisseurs_90j: 2,
        arrieres_fiscaux_sociaux: null,
      },
    });
    expect(redScoreCreationSchema.safeParse(corps).success).toBe(true);
    expect(
      ok(corpsScoreDepuisFormulaire({ rejets: "0", retards: "0", arrieres: "non" })).incidents
        .arrieres_fiscaux_sociaux,
    ).toBe(false);
  });

  it("refuse un nombre illisible ou hors bornes", () => {
    const e = ko(corpsScoreDepuisFormulaire({ rejets: "1000", retards: "x", arrieres: "oui" }));
    expect(e.rejets).toBeDefined();
    expect(e.retards).toBeDefined();
  });

  it("préremplit depuis le dernier score", () => {
    expect(
      saisieIncidentsDepuis({
        rejets_bancaires_12m: 3,
        retards_fournisseurs_90j: null,
        arrieres_fiscaux_sociaux: true,
      }),
    ).toEqual({ rejets: "3", retards: "", arrieres: "oui" });
    expect(saisieIncidentsDepuis(null).arrieres).toBe("inconnu");
  });
});

describe("seuils d'alerte", () => {
  const defaut: RedSeuils = {
    criteres: {
      liquidite_generale: { orange: 12000, rouge: 10000, poids: 15 },
      liquidite_immediate: { orange: 2000, rouge: 1000, poids: 10 },
      autonomie_financiere: { orange: 2500, rouge: 1000, poids: 10 },
      endettement: { orange: 10000, rouge: 20000, poids: 10 },
      couverture_charges_financieres: { orange: 30000, rouge: 15000, poids: 10 },
      marge_nette: { orange: 200, rouge: 0, poids: 10 },
      bfr_jours: { orange: 60, rouge: 90, poids: 5 },
      croissance_ca: { orange: 0, rouge: -1000, poids: 10 },
      variation_marge_brute: { orange: 0, rouge: -500, poids: 5 },
      rejets_bancaires_12m: { orange: 0, rouge: 2, poids: 5 },
      retards_fournisseurs_90j: { orange: 0, rouge: 4, poids: 5 },
      arrieres_fiscaux_sociaux: { orange: 0, rouge: 0, poids: 5 },
    },
    niveaux: { modere: 25, eleve: 50, critique: 75 },
    part_minimale_evaluee_pct: 50,
  };

  it("affiche les rapports en rapport et les marges en pourcentage, puis les renvoie à l'identique", () => {
    const s = saisieSeuilsDepuis(defaut);
    expect(s.criteres.liquidite_generale).toEqual({ orange: "1,2", rouge: "1", poids: "15" });
    expect(s.criteres.marge_nette).toEqual({ orange: "2", rouge: "0", poids: "10" });
    expect(s.criteres.bfr_jours.orange).toBe("60");
    const corps = ok(corpsSeuilsDepuisFormulaire("btp", s));
    expect(corps.seuils).toEqual(defaut);
    expect(corps.secteur).toBe("btp");
    expect(redSeuilsCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("somme les poids de contrôle : 100 pour les valeurs par défaut", () => {
    expect(sommeDesPoids(saisieSeuilsDepuis(defaut).criteres)).toBe(100);
    expect(RED_CRITERES_ALERTE).toHaveLength(12);
  });

  it("refuse une somme de poids différente de 100 avant l'envoi", () => {
    const s = saisieSeuilsDepuis(defaut);
    s.criteres.bfr_jours.poids = "6";
    expect(ko(corpsSeuilsDepuisFormulaire("general", s)).poids).toBe(
      "La somme des poids doit être égale à 100 (actuellement 101).",
    );
  });

  it("refuse une valeur illisible et un niveau hors bornes", () => {
    const s = saisieSeuilsDepuis(defaut);
    s.criteres.endettement.orange = "abc";
    s.niveaux.critique = "150";
    const e = ko(corpsSeuilsDepuisFormulaire("general", s));
    expect(e["endettement.orange"]).toBe("Valeur illisible.");
    expect(e.niveaux).toBeDefined();
  });
});

describe("trésorerie : version de la prévision", () => {
  const base: SaisieVersionTresorerie = {
    date_debut: "2026-11-02",
    solde_initial: "5 000 000",
    seuil_tension: "",
    motif: "",
    lignes: [
      { ...ligneVide("encaissement"), semaine: "2", montant: "1 200 000", libelle: " Clients " },
      { ...ligneVide("decaissement"), categorie: "salaires", semaine: "1", montant: "" },
    ],
  };

  it("ignore les lignes sans montant, accepte un seuil vide (0) et respecte le schéma partagé", () => {
    const corps = ok(corpsVersionDepuisFormulaire(base, "XOF"));
    expect(corps.lignes).toEqual([
      {
        semaine: 2,
        sens: "encaissement",
        categorie: "clients",
        montant: 1_200_000,
        libelle: "Clients",
      },
    ]);
    expect(corps.seuil_tension).toBe(0);
    expect(redTresorerieVersionCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("accepte un solde initial négatif", () => {
    expect(
      ok(corpsVersionDepuisFormulaire({ ...base, solde_initial: "-300 000" }, "XOF")).solde_initial,
    ).toBe(-300_000);
  });

  it("refuse une date qui n'est pas un lundi, un solde absent et un montant illisible", () => {
    expect(
      ko(corpsVersionDepuisFormulaire({ ...base, date_debut: "2026-11-03" }, "XOF")).date_debut,
    ).toBe("Un lundi est attendu.");
    expect(
      ko(corpsVersionDepuisFormulaire({ ...base, solde_initial: "" }, "XOF")).solde_initial,
    ).toContain("solde bancaire initial");
    const e = ko(
      corpsVersionDepuisFormulaire(
        { ...base, lignes: [{ ...ligneVide(), montant: "12,5" }] },
        "XOF",
      ),
    );
    expect(e.lignes).toContain("Ligne 1");
    expect(
      ko(
        corpsVersionDepuisFormulaire(
          { ...base, lignes: [{ ...ligneVide(), montant: "0" }] },
          "XOF",
        ),
      ).lignes,
    ).toContain("supérieur à zéro");
  });

  it("rattache une ligne importée à son échéance d'accord", () => {
    const ligne = {
      ...ligneVide("decaissement"),
      categorie: "service_dette",
      montant: "400 000",
      creancier_id: "11111111-1111-4111-8111-111111111111",
      echeance_id: "22222222-2222-4222-8222-222222222222",
    };
    const corps = ok(corpsVersionDepuisFormulaire({ ...base, lignes: [ligne] }, "XOF"));
    expect(corps.lignes[0]).toMatchObject({
      creancier_id: ligne.creancier_id,
      echeance_id: ligne.echeance_id,
    });
    expect(redTresorerieVersionCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("préremplit la version suivante depuis la version courante, ou au lundi suivant", () => {
    const vide = saisieVersionDepuis(null, "XOF", "2026-10-11");
    expect(vide.date_debut).toBe("2026-10-12");
    expect(vide.lignes).toEqual([]);
    const s = saisieVersionDepuis(
      {
        id: "v",
        version: 2,
        date_debut: "2026-11-02",
        solde_initial: -1_500_000,
        seuil_tension: 0,
        motif: null,
        cree_par: { id: "u", nom: "A" },
        cree_le: "2026-10-11T10:00:00Z",
        lignes: [
          {
            id: "l",
            rang: 1,
            semaine: 3,
            sens: "encaissement",
            categorie: "clients",
            libelle: null,
            montant: 250_000,
            creancier_id: null,
            echeance_id: null,
          },
        ],
      },
      "XOF",
      "2026-10-11",
    );
    expect(s.solde_initial).toBe("-1500000");
    expect(s.lignes[0]).toMatchObject({ semaine: "3", montant: "250000", libelle: "" });
  });
});

describe("trésorerie : réalisé", () => {
  it("regroupe les flux par sens et catégorie : montants avec espaces, vides ignorés", () => {
    const corps = ok(
      corpsRealiseDepuisFormulaire(
        {
          ...saisieRealiseVide("2026-11-02"),
          encaissement: { clients: "1 200 000", cessions: "" },
          decaissement: { salaires: "800 000" },
          solde_constate: "-100 000",
          commentaire: " ok ",
        },
        "XOF",
      ),
    );
    expect(corps).toEqual({
      semaine_debut: "2026-11-02",
      flux: { encaissement: { clients: 1_200_000 }, decaissement: { salaires: 800_000 } },
      solde_constate: -100_000,
      commentaire: "ok",
    });
    expect(redRealiseCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("accepte une semaine sans flux, refuse une décimale (XOF) et une date qui n'est pas un lundi", () => {
    expect(ok(corpsRealiseDepuisFormulaire(saisieRealiseVide("2026-11-02"), "XOF")).flux).toEqual(
      {},
    );
    expect(
      ko(
        corpsRealiseDepuisFormulaire(
          { ...saisieRealiseVide("2026-11-02"), encaissement: { clients: "1200,5" } },
          "XOF",
        ),
      ).encaissement,
    ).toContain("sans décimale");
    expect(
      ko(corpsRealiseDepuisFormulaire(saisieRealiseVide("2026-11-04"), "XOF")).semaine_debut,
    ).toBe("Un lundi est attendu.");
    expect(
      ko(corpsRealiseDepuisFormulaire(saisieRealiseVide(""), "XOF")).semaine_debut,
    ).toBeDefined();
  });
});

describe("point mort", () => {
  it("convertit les trois montants et la période", () => {
    const corps = ok(
      corpsPointMortDepuisFormulaire(
        {
          chiffre_affaires: "100 000 000",
          charges_variables: "60 000 000",
          charges_fixes: "30 000 000",
          periode_jours: "",
        },
        "XOF",
      ),
    );
    expect(corps).toEqual({
      chiffre_affaires: 100_000_000,
      charges_variables: 60_000_000,
      charges_fixes: 30_000_000,
    });
    expect(redPointMortSchema.safeParse(corps).success).toBe(true);
  });

  it("refuse un montant absent et une période hors bornes", () => {
    const e = ko(
      corpsPointMortDepuisFormulaire(
        { chiffre_affaires: "", charges_variables: "1", charges_fixes: "2", periode_jours: "400" },
        "XOF",
      ),
    );
    expect(e.chiffre_affaires).toBe("Saisissez un montant.");
    expect(e.periode_jours).toBeDefined();
  });
});

describe("créanciers", () => {
  const s = {
    nom: " Banque Alpha ",
    categorie: "banque" as const,
    garanti: true,
    reference: "",
    principal: "10 000 000",
    interets: "",
    date_arrete: "2026-10-01",
    echeance_initiale: "",
    nature: "Crédit de campagne",
  };

  it("construit le corps de création conforme au schéma partagé", () => {
    const corps = ok(corpsCreancierDepuisFormulaire(s, "XOF"));
    expect(corps).toEqual({
      nom: "Banque Alpha",
      categorie: "banque",
      garanti: true,
      principal: 10_000_000,
      interets: 0,
      date_arrete: "2026-10-01",
      nature: "Crédit de campagne",
    });
    expect(redCreancierCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("refuse un nom vide, un principal absent et une date illisible", () => {
    const e = ko(
      corpsCreancierDepuisFormulaire({ ...s, nom: " ", principal: "", date_arrete: "x" }, "XOF"),
    );
    expect(e.nom).toBeDefined();
    expect(e.principal).toBeDefined();
    expect(e.date_arrete).toBeDefined();
  });

  it("construit une nouvelle version de la créance", () => {
    const corps = ok(
      corpsCreanceDepuisFormulaire(
        {
          principal: "9 000 000",
          interets: "100 000",
          date_arrete: "2026-11-01",
          echeance_initiale: "",
          nature: "",
          commentaire: "Paiement partiel",
        },
        "XOF",
      ),
    );
    expect(corps).toEqual({
      principal: 9_000_000,
      interets: 100_000,
      date_arrete: "2026-11-01",
      commentaire: "Paiement partiel",
    });
    expect(redCreanceCreationSchema.safeParse(corps).success).toBe(true);
  });
});

describe("événements de négociation", () => {
  const base = (m: Partial<SaisieEvenement>): SaisieEvenement => ({
    ...evenementVide("2026-10-11", "99999999-9999-4999-8999-999999999999"),
    ...m,
  });

  it("construit une note sans montant, une proposition avec montant", () => {
    const note = ok(
      corpsEvenementDepuisFormulaire(base({ type: "note", conditions: " rappel " }), "XOF"),
    );
    expect(note).toEqual({ type: "note", date_evenement: "2026-10-11", conditions: "rappel" });
    const prop = ok(
      corpsEvenementDepuisFormulaire(base({ type: "proposition", montant: "5 000 000" }), "XOF"),
    );
    expect(prop).toMatchObject({ type: "proposition", montant: 5_000_000 });
    expect(redEvenementNegociationSchema.safeParse(prop).success).toBe(true);
  });

  it("construit un accord à échéancier régulier ou explicite", () => {
    const reg = ok(
      corpsEvenementDepuisFormulaire(
        base({
          type: "accord",
          montant: "10 000 000",
          nombre_echeances: "10",
          date_premiere: "2026-12-01",
          periodicite_mois: "1",
        }),
        "XOF",
      ),
    );
    expect(reg).toMatchObject({
      type: "accord",
      montant: 10_000_000,
      echeancier: {
        mode: "regulier",
        nombre_echeances: 10,
        date_premiere: "2026-12-01",
        periodicite_mois: 1,
      },
    });
    expect(redEvenementNegociationSchema.safeParse(reg).success).toBe(true);
    const exp = ok(
      corpsEvenementDepuisFormulaire(
        base({
          type: "accord",
          montant: "10 000 000",
          mode: "explicite",
          lignes: [
            { cle: "a", date: "2026-12-01", montant: "4 000 000" },
            { cle: "b", date: "2027-01-01", montant: "6 000 000" },
          ],
        }),
        "XOF",
      ),
    );
    expect(redEvenementNegociationSchema.safeParse(exp).success).toBe(true);
  });

  it("refuse un accord sans montant, sans échéance explicite ou à plus de 60 échéances", () => {
    expect(
      ko(corpsEvenementDepuisFormulaire(base({ type: "accord" }), "XOF")).montant,
    ).toBeDefined();
    expect(
      ko(
        corpsEvenementDepuisFormulaire(
          base({ type: "accord", montant: "100", mode: "explicite" }),
          "XOF",
        ),
      ).lignes,
    ).toContain("au moins une échéance");
    expect(
      ko(
        corpsEvenementDepuisFormulaire(
          base({ type: "accord", montant: "100", mode: "regulier", nombre_echeances: "61" }),
          "XOF",
        ),
      ).nombre_echeances,
    ).toContain("60");
  });

  it("rattache un paiement à une échéance et refuse un paiement sans accord", () => {
    const p = ok(
      corpsEvenementDepuisFormulaire(
        base({ type: "paiement", montant: "1 000 000", echeance_rang: "2" }),
        "XOF",
      ),
    );
    expect(p).toMatchObject({
      type: "paiement",
      echeance_rang: 2,
      accord_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(redEvenementNegociationSchema.safeParse(p).success).toBe(true);
    expect(
      ko(
        corpsEvenementDepuisFormulaire(
          base({ type: "paiement", montant: "1", accord_id: "" }),
          "XOF",
        ),
      ).accord_id,
    ).toBeDefined();
  });

  it("construit une rupture visant l'accord en vigueur", () => {
    const r = ok(corpsEvenementDepuisFormulaire(base({ type: "rupture" }), "XOF"));
    expect(r).toMatchObject({ type: "rupture", accord_id: "99999999-9999-4999-8999-999999999999" });
    expect(redEvenementNegociationSchema.safeParse(r).success).toBe(true);
    expect(
      ko(corpsEvenementDepuisFormulaire(base({ type: "rupture", accord_id: "" }), "XOF")).accord_id,
    ).toBeDefined();
  });
});

describe("annulation d'un paiement", () => {
  const id = "44444444-4444-4444-8444-444444444444";

  it("vise le paiement par son identifiant, sans montant, conforme au schéma partagé", () => {
    const corps = ok(corpsAnnulationPaiement(id, "2026-10-11"));
    expect(corps).toEqual({
      type: "annulation_paiement",
      date_evenement: "2026-10-11",
      paiement_annule_id: id,
    });
    expect(redEvenementNegociationSchema.safeParse(corps).success).toBe(true);
  });

  it("refuse un identifiant qui n'est pas un uuid et une date illisible", () => {
    expect(ko(corpsAnnulationPaiement("abc", "2026-10-11")).paiement_annule_id).toBeDefined();
    expect(ko(corpsAnnulationPaiement(id, "demain")).date_evenement).toBeDefined();
  });
});

describe("dossier et clôture", () => {
  it("valide l'intitulé et le motif de clôture (10 caractères au moins)", () => {
    expect(ok(corpsDossierDepuisFormulaire({ intitule: " Dossier X ", secteur: "btp" }))).toEqual({
      intitule: "Dossier X",
      secteur: "btp",
    });
    expect(
      ko(corpsDossierDepuisFormulaire({ intitule: " ", secteur: "btp" })).intitule,
    ).toBeDefined();
    expect(ko(corpsCloture("court")).motif).toContain("10 caractères");
    expect(ok(corpsCloture("  Dossier réglé avec les créanciers  "))).toEqual({
      statut: "clos",
      motif: "Dossier réglé avec les créanciers",
    });
  });
});

describe("actions et leviers", () => {
  const levier: RedDefinitionLevierVue = {
    code: "reduction_delai_clients",
    famille: "bfr",
    libelle: "Réduire le délai de paiement des clients",
    description: "d",
    postes_base: ["creances_clients", "chiffre_affaires"],
    parametres: [{ cle: "joursGagnes", libelle: "Jours gagnés", unite: "jours", min: 1, max: 180 }],
    hypotheses: [],
  };
  const cession: RedDefinitionLevierVue = {
    ...levier,
    code: "cession_actif",
    famille: "cessions",
    parametres: [
      {
        cle: "prix",
        libelle: "Prix de cession",
        unite: "montant",
        min: 0,
        max: 10_000_000_000_000,
      },
    ],
  };
  const saisie: SaisieAction = {
    titre: " Relancer les clients ",
    description: "",
    volet: "quick_win",
    domaine: "tresorerie",
    echeance: "2027-01-15",
    responsable_id: "33333333-3333-4333-8333-333333333333",
    levier_code: "",
    parametres: {},
    creer_tache: true,
  };

  it("construit la création sans levier, conforme au schéma partagé", () => {
    const corps = ok(corpsActionDepuisFormulaire(saisie, "XOF", [levier], "creation"));
    expect(corps).toEqual({
      titre: "Relancer les clients",
      volet: "quick_win",
      domaine: "tresorerie",
      echeance: "2027-01-15",
      responsable_id: saisie.responsable_id,
      creer_tache: true,
    });
    expect(redActionCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("construit la création avec levier et paramètres entiers", () => {
    const corps = ok(
      corpsActionDepuisFormulaire(
        { ...saisie, levier_code: "reduction_delai_clients", parametres: { joursGagnes: "15" } },
        "XOF",
        [levier],
        "creation",
      ),
    );
    expect(corps.levier).toEqual({
      code: "reduction_delai_clients",
      parametres: { joursGagnes: 15 },
    });
    expect(redActionCreationSchema.safeParse(corps).success).toBe(true);
  });

  it("convertit un paramètre « montant » en unités mineures de la devise", () => {
    const p = parametresDepuisSaisie(cession, { prix: "1 500,50" }, "EUR");
    expect(p).toEqual({ parametres: { prix: 150050 }, erreur: null });
  });

  it("refuse un paramètre hors bornes ou absent, un levier inconnu et un titre vide", () => {
    expect(
      ko(
        corpsActionDepuisFormulaire(
          { ...saisie, levier_code: "reduction_delai_clients", parametres: { joursGagnes: "500" } },
          "XOF",
          [levier],
          "creation",
        ),
      ).parametres,
    ).toContain("entre 1 et 180");
    expect(
      ko(
        corpsActionDepuisFormulaire(
          { ...saisie, levier_code: "reduction_delai_clients" },
          "XOF",
          [levier],
          "creation",
        ),
      ).parametres,
    ).toContain("Renseignez");
    expect(
      ko(
        corpsActionDepuisFormulaire(
          { ...saisie, levier_code: "hausse_prix" },
          "XOF",
          [levier],
          "creation",
        ),
      ).levier,
    ).toBeDefined();
    expect(
      ko(corpsActionDepuisFormulaire({ ...saisie, titre: " " }, "XOF", [levier], "creation")).titre,
    ).toBeDefined();
    expect(
      ko(
        corpsActionDepuisFormulaire({ ...saisie, responsable_id: "" }, "XOF", [levier], "creation"),
      ).responsable_id,
    ).toBeDefined();
  });

  it("la modification retire le levier (null) et n'envoie pas creer_tache", () => {
    const corps = ok(corpsActionDepuisFormulaire(saisie, "XOF", [levier], "modification"));
    expect(corps.levier).toBeNull();
    expect("creer_tache" in corps).toBe(false);
    expect(redActionModificationSchema.safeParse(corps).success).toBe(true);
  });

  it("construit la simulation d'un levier", () => {
    expect(ok(corpsSimulationDepuisFormulaire(levier, { joursGagnes: "10" }, "XOF"))).toEqual({
      code: "reduction_delai_clients",
      parametres: { joursGagnes: 10 },
    });
    expect(ko(corpsSimulationDepuisFormulaire(undefined, {}, "XOF")).levier).toBeDefined();
    expect(ko(corpsSimulationDepuisFormulaire(levier, {}, "XOF")).parametres).toBeDefined();
  });
});
