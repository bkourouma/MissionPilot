import { describe, expect, it } from "vitest";
import { formaterMontantMineur } from "./format";
import {
  dateValide,
  initiativesDuPlan,
  lireLignes,
  memeContenu,
  MESSAGE_CONTENU_IDENTIQUE,
  nomInitiative,
  nomPersonnePlan,
  OPTIONS_PERSPECTIVES,
  OPTIONS_STATUTS_INITIATIVE,
  optionsDependances,
  optionsResponsables,
  personnesPlan,
  saisieDepuisDonnees,
  saisieElementVide,
  sansVides,
  texteElement,
  validerElement,
  type SaisieElement,
} from "./plan-elements";

const CTX = { horizon: 3, devise: "XOF" as const };
const RESP = "a0000000-0000-4000-8000-000000000003";

const saisie = (partiel: Partial<SaisieElement>): SaisieElement => ({
  ...saisieElementVide(3),
  ...partiel,
});

describe("validation des contenus (bornes des schémas partagés)", () => {
  it("diagnostic : synthèse obligatoire", () => {
    expect(validerElement("diagnostic", saisie({}), CTX)).toEqual({
      ok: false,
      erreurs: { synthese: "Champ obligatoire." },
    });
    expect(validerElement("diagnostic", saisie({ synthese: " Constat " }), CTX)).toEqual({
      ok: true,
      charge: { synthese: "Constat" },
    });
    const long = validerElement("diagnostic", saisie({ synthese: "x".repeat(20_001) }), CTX);
    expect(long.ok).toBe(false);
  });

  it("SWOT : une entrée par ligne, au moins un constat, 30 lignes de 500 caractères au plus", () => {
    const vide = validerElement("swot", saisie({}), CTX);
    expect(vide.ok).toBe(false);
    if (!vide.ok) expect(vide.erreurs.swot).toContain("au moins un constat");
    const r = validerElement(
      "swot",
      saisie({ forces: "Marque\n\n Équipe \nMarque", menaces: "Prix" }),
      CTX,
    );
    expect(r).toEqual({
      ok: true,
      charge: { forces: ["Marque", "Équipe"], faiblesses: [], opportunites: [], menaces: ["Prix"] },
    });
    const trop = validerElement(
      "swot",
      saisie({ forces: Array.from({ length: 31 }, (_, i) => `f${i}`).join("\n") }),
      CTX,
    );
    expect(trop.ok).toBe(false);
    if (!trop.ok) expect(trop.erreurs.forces).toBe("30 lignes au plus.");
  });

  it("vision et mission : deux textes obligatoires, valeurs facultatives", () => {
    const r = validerElement(
      "vision_mission",
      saisie({ vision: "Leader", mission: "Servir" }),
      CTX,
    );
    expect(r).toEqual({ ok: true, charge: { vision: "Leader", mission: "Servir" } });
    const v = validerElement(
      "vision_mission",
      saisie({ vision: "Leader", mission: "Servir", valeurs: "Intégrité\nRigueur" }),
      CTX,
    );
    expect(v.ok && v.charge.valeurs).toEqual(["Intégrité", "Rigueur"]);
  });

  it("axe et objectif : titre, perspective obligatoire, échéance facultative", () => {
    expect(validerElement("axe", saisie({ titre: "Export" }), CTX)).toEqual({
      ok: true,
      charge: { titre: "Export" },
    });
    const sansPerspective = validerElement("objectif", saisie({ titre: "Doubler" }), CTX);
    expect(sansPerspective.ok).toBe(false);
    if (!sansPerspective.ok)
      expect(sansPerspective.erreurs.perspective).toBe("Choisissez une perspective.");
    const o = validerElement(
      "objectif",
      saisie({ titre: "Doubler", perspective: "finances", cible: "x2", echeance: "2028-12-31" }),
      CTX,
    );
    expect(o).toEqual({
      ok: true,
      charge: { titre: "Doubler", perspective: "finances", cible: "x2", echeance: "2028-12-31" },
    });
    const date = validerElement(
      "objectif",
      saisie({ titre: "x", perspective: "clients", echeance: "2028-02-30" }),
      CTX,
    );
    expect(date.ok).toBe(false);
  });

  it("initiative : échéance et budget obligatoires, début avant l'échéance", () => {
    const r = validerElement("initiative", saisie({ titre: "Filiale" }), CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs.echeance).toBe("Champ obligatoire.");
      expect(r.erreurs.budget).toBe("Champ obligatoire.");
    }
    const ordre = validerElement(
      "initiative",
      saisie({ titre: "Filiale", debut: "2027-07-01", echeance: "2027-06-30", budget: "0" }),
      CTX,
    );
    expect(ordre.ok).toBe(false);
    if (!ordre.ok) expect(ordre.erreurs.debut).toBe("Le début doit précéder l'échéance.");
    const negatif = validerElement(
      "initiative",
      saisie({ titre: "x", echeance: "2027-06-30", budget: "-1" }),
      CTX,
    );
    expect(negatif.ok).toBe(false);
  });

  it("initiative : gains nets annuels, tous ou aucun, autant que d'années d'horizon (pertes admises)", () => {
    const base = {
      titre: "Filiale",
      responsable_id: RESP,
      debut: "2027-02-01",
      echeance: "2027-11-30",
      budget: "25 000 000",
      statut: "en_cours",
    };
    const sansGains = validerElement("initiative", saisie(base), CTX);
    expect(sansGains).toEqual({
      ok: true,
      charge: {
        titre: "Filiale",
        responsable_id: RESP,
        debut: "2027-02-01",
        echeance: "2027-11-30",
        budget: 25_000_000,
        statut: "en_cours",
      },
    });
    const partiels = validerElement("initiative", saisie({ ...base, gains: ["1", "", "3"] }), CTX);
    expect(partiels.ok).toBe(false);
    if (!partiels.ok) expect(partiels.erreurs.gains).toContain("Renseignez les 3 années");
    const gains = validerElement(
      "initiative",
      saisie({ ...base, gains: ["-2 000 000", "10 000 000", "15 000 000"] }),
      CTX,
    );
    expect(gains.ok && gains.charge.gains_annuels).toEqual([-2_000_000, 10_000_000, 15_000_000]);
  });

  it("montants en EUR convertis en centimes", () => {
    const r = validerElement(
      "initiative",
      saisie({ titre: "x", echeance: "2027-06-30", budget: "1 500,50", gains: ["1", "2", "3,5"] }),
      { horizon: 3, devise: "EUR" },
    );
    expect(r.ok && r.charge.budget).toBe(150_050);
    expect(r.ok && r.charge.gains_annuels).toEqual([100, 200, 350]);
  });
});

describe("préremplissage et contenu identique", () => {
  it("aller-retour d'une initiative", () => {
    const donnees = {
      titre: "Filiale",
      description: null,
      responsable_id: RESP,
      debut: null,
      echeance: "2027-11-30",
      budget: 25_000_000,
      statut: "a_lancer",
      gains_annuels: [1, 2, 3],
    };
    const s = saisieDepuisDonnees(donnees, "XOF", 3);
    expect(s.budget).toBe("25000000");
    expect(s.gains).toEqual(["1", "2", "3"]);
    expect(s.debut).toBe("");
    const r = validerElement("initiative", s, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) expect(memeContenu(r.charge, donnees)).toBe(true);
    if (r.ok) expect(memeContenu({ ...r.charge, budget: 1 }, donnees)).toBe(false);
    expect(MESSAGE_CONTENU_IDENTIQUE).toContain("identique");
  });

  it("aller-retour d'un SWOT ; les clés nulles sont ignorées", () => {
    const donnees = { forces: ["a", "b"], faiblesses: [], opportunites: ["c"], menaces: [] };
    const r = validerElement("swot", saisieDepuisDonnees(donnees, "XOF", 3), CTX);
    expect(r.ok && memeContenu(r.charge, donnees)).toBe(true);
    expect(sansVides({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
  });

  it("gains de longueur différente de l'horizon : cases complétées à vide", () => {
    expect(saisieDepuisDonnees({ gains_annuels: [5] }, "XOF", 3).gains).toEqual(["5", "", ""]);
  });
});

describe("texte comparable d'une version", () => {
  const c = { devise: "XOF" as const, nomResponsable: (id: string | null) => (id ? "Awa" : "—") };

  it("SWOT en listes à puces, initiative avec ses champs", () => {
    expect(
      texteElement("swot", { forces: ["a"], faiblesses: [], opportunites: [], menaces: ["m"] }, c),
    ).toBe("Forces\n• a\n\nFaiblesses\n(aucun)\n\nOpportunités\n(aucun)\n\nMenaces\n• m");
    const t = texteElement(
      "initiative",
      {
        titre: "Filiale",
        responsable_id: RESP,
        echeance: "2027-11-30",
        budget: 1000,
        statut: "en_cours",
        gains_annuels: [10, 20],
      },
      c,
    );
    expect(t).toContain("Titre : Filiale");
    expect(t).toContain("Responsable : Awa");
    expect(t).toContain(`Budget : ${formaterMontantMineur(1000, "XOF")}`);
    expect(t).toContain("Statut : En cours");
    expect(t).toContain(`année 2 : ${formaterMontantMineur(20, "XOF")}`);
    expect(texteElement("initiative", { titre: "x", budget: 0 }, c)).toContain(
      "Gains nets annuels : non estimés",
    );
  });

  it("vision, objectif, axe, diagnostic", () => {
    expect(
      texteElement("vision_mission", { vision: "V", mission: "M", valeurs: ["a", "b"] }, c),
    ).toBe("Vision : V\n\nMission : M\n\nValeurs : a, b");
    expect(texteElement("objectif", { titre: "T", perspective: "clients" }, c)).toBe(
      "Titre : T\n\nPerspective : Clients",
    );
    expect(texteElement("axe", { titre: "A", description: "D" }, c)).toBe("Titre : A\n\nD");
    expect(texteElement("diagnostic", { synthese: "S" }, c)).toBe("S");
  });
});

describe("outils", () => {
  it("dates et lignes", () => {
    expect(dateValide("2027-02-28")).toBe(true);
    expect(dateValide("2027-02-29")).toBe(false);
    expect(dateValide("1999-12-31")).toBe(false);
    expect(dateValide("2101-01-01")).toBe(false);
    expect(dateValide("27-02-28")).toBe(false);
    expect(lireLignes(" a \n\nb\na")).toEqual(["a", "b"]);
    expect(OPTIONS_PERSPECTIVES.map((o) => o.valeur)).toEqual([
      "finances",
      "clients",
      "processus",
      "apprentissage",
    ]);
    expect(OPTIONS_STATUTS_INITIATIVE[0]).toEqual({ valeur: "a_lancer", libelle: "À lancer" });
  });
});

describe("responsables d'initiative", () => {
  const moi = { id: "u1", nom: "Awa" };

  it("référentiel du cabinet sinon équipe ; l'utilisateur toujours présent", () => {
    expect(
      personnesPlan(
        [
          { utilisateur_id: "u2", nom: "Kofi" },
          { utilisateur_id: "u1", nom: "Awa" },
          { utilisateur_id: "u2", nom: "Kofi" },
        ],
        [{ utilisateur_id: "u9", nom: "Zoé" }],
        moi,
      ),
    ).toEqual([
      { id: "u1", nom: "Awa (vous)" },
      { id: "u2", nom: "Kofi" },
    ]);
    expect(personnesPlan([], [{ utilisateur_id: "u9", nom: "Zoé" }], moi)).toEqual([
      { id: "u1", nom: "Awa (vous)" },
      { id: "u9", nom: "Zoé" },
    ]);
  });

  it("nom affiché et options, responsable actuel conservé", () => {
    const p = [{ id: "u2", nom: "Kofi" }];
    expect(nomPersonnePlan("u2", p)).toBe("Kofi");
    expect(nomPersonnePlan(null, p)).toBe("Non désigné");
    expect(nomPersonnePlan("u7", p)).toContain("hors liste");
    expect(optionsResponsables(p, null)).toEqual([
      { valeur: "", libelle: "Non désigné" },
      { valeur: "u2", libelle: "Kofi" },
    ]);
    expect(optionsResponsables(p, "u7").at(-1)).toEqual({
      valeur: "u7",
      libelle: "Responsable actuel (hors liste affichée)",
    });
  });
});

describe("dépendances d'une initiative (PLA-05)", () => {
  const A = "a0000000-0000-4000-8000-00000000000a";
  const B = "a0000000-0000-4000-8000-00000000000b";
  const C = "a0000000-0000-4000-8000-00000000000c";
  const base = { titre: "CRM", echeance: "2027-06-30", budget: "1000" };

  it("absentes par défaut, envoyées sans doublon si choisies", () => {
    expect(saisieElementVide(3).dependances).toEqual([]);
    const sans = validerElement("initiative", saisie(base), CTX);
    expect(sans.ok && "dependances" in sans.charge).toBe(false);
    const avec = validerElement("initiative", saisie({ ...base, dependances: [A, B, A] }), CTX);
    expect(avec.ok && avec.charge.dependances).toEqual([A, B]);
  });

  it("au plus 20 dépendances", () => {
    const trop = Array.from(
      { length: 21 },
      (_, i) => `${A.slice(0, -2)}${String(i).padStart(2, "0")}`,
    );
    const r = validerElement("initiative", saisie({ ...base, dependances: trop }), CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.dependances).toBe("20 dépendances au plus.");
  });

  it("préremplies depuis la version courante (une modification ne les perd pas)", () => {
    const s = saisieDepuisDonnees({ ...base, budget: 1000, dependances: [A] }, "XOF", 3);
    expect(s.dependances).toEqual([A]);
    const r = validerElement("initiative", s, CTX);
    expect(r.ok && r.charge.dependances).toEqual([A]);
  });

  it("options : autres initiatives actives, retirées seulement si déjà choisies, triées", () => {
    const initiatives = initiativesDuPlan([
      { id: A, type: "initiative", retire: false, donnees: { titre: "Zèbre" } },
      { id: B, type: "initiative", retire: true, donnees: { titre: "Ancienne" } },
      { id: C, type: "initiative", retire: false, donnees: { titre: "Atelier" } },
      { id: "x", type: "axe", retire: false, donnees: { titre: "Axe" } },
    ]);
    expect(initiatives.map((i) => i.id)).toEqual([A, B, C]);
    expect(optionsDependances(initiatives, A, [])).toEqual([{ valeur: C, libelle: "Atelier" }]);
    expect(optionsDependances(initiatives, null, [B]).map((o) => o.libelle)).toEqual([
      "Ancienne (retirée)",
      "Atelier",
      "Zèbre",
    ]);
    expect(nomInitiative(C, initiatives)).toBe("Atelier");
    expect(nomInitiative(B, initiatives)).toBe("Ancienne (retirée)");
    expect(nomInitiative("inconnue", initiatives)).toBe("Initiative inconnue");
    expect(
      initiativesDuPlan([{ id: A, type: "initiative", retire: false, donnees: {} }])[0]?.titre,
    ).toBe("Initiative");
  });

  it("texte d'une version : « Dépend de » avec les titres", () => {
    const d = { titre: "CRM", echeance: "2027-06-30", budget: 1000, dependances: [A] };
    const avecNoms = texteElement("initiative", d, {
      devise: "XOF",
      nomResponsable: () => "x",
      nomInitiative: () => "Formation",
    });
    expect(avecNoms).toContain("Dépend de : Formation");
    const sansNoms = texteElement("initiative", d, { devise: "XOF", nomResponsable: () => "x" });
    expect(sansNoms).toContain("Dépend de : initiative du plan");
  });
});
