import { describe, expect, it } from "vitest";
import {
  ACTIONS_RETARD_CRITIQUE,
  COVENANTS_DEFAUT_CRITIQUE,
  MOTIFS_PRINCIPAUX_MAX,
  SEMAINES_TENSION_CRITIQUE,
  calculerEtatVoyant,
  comparerAttention,
  motifsPrincipaux,
  synthetiserPortefeuilleVoyants,
  type EntreesVoyant,
} from "./tableau-bord";

const VIDE: EntreesVoyant = {
  voyantUrgence: null,
  niveauAlerte: null,
  semainesTension: null,
  covenantsEnDefaut: null,
  actionsEnRetard: 0,
  alertesSuivi: null,
  statutCloture: null,
};
const avec = (e: Partial<EntreesVoyant>): EntreesVoyant => ({ ...VIDE, ...e });
const codes = (e: Partial<EntreesVoyant>) => calculerEtatVoyant(avec(e)).motifs.map((m) => m.code);

describe("calculerEtatVoyant : sans donnée", () => {
  it("aucune donnée : inconnu, aucun motif", () => {
    expect(calculerEtatVoyant(VIDE)).toEqual({
      voyant: "inconnu",
      motifs: [],
      donneesDisponibles: false,
    });
  });

  it("non évalué, niveau insuffisant, clôture absente seule : toujours inconnu", () => {
    const r = calculerEtatVoyant(
      avec({ voyantUrgence: "non_evalue", niveauAlerte: "insuffisant", statutCloture: "absent" }),
    );
    expect(r.voyant).toBe("inconnu");
    expect(r.motifs.map((m) => m.code)).toEqual(["CLOTURE_ABSENTE"]);
  });
});

describe("calculerEtatVoyant : règles", () => {
  it("vert : données connues sans point d'attention", () => {
    for (const e of [
      avec({ voyantUrgence: "vert" }),
      avec({ niveauAlerte: "faible" }),
      avec({ semainesTension: 0 }),
      avec({ covenantsEnDefaut: 0 }),
      avec({ statutCloture: "valide" }),
      avec({ alertesSuivi: { nombre: 0, attention: 0 } }),
    ]) {
      const r = calculerEtatVoyant(e);
      expect(r.voyant).toBe("vert");
      expect(r.motifs).toEqual([]);
    }
  });

  it("urgence : rouge critique, orange vigilance", () => {
    expect(codes({ voyantUrgence: "rouge" })).toEqual(["URGENCE_ROUGE"]);
    expect(calculerEtatVoyant(avec({ voyantUrgence: "rouge" })).voyant).toBe("rouge");
    expect(codes({ voyantUrgence: "orange" })).toEqual(["URGENCE_ORANGE"]);
    expect(calculerEtatVoyant(avec({ voyantUrgence: "orange" })).voyant).toBe("orange");
  });

  it("alerte précoce : critique rouge ; élevé et modéré orange", () => {
    expect(calculerEtatVoyant(avec({ niveauAlerte: "critique" })).voyant).toBe("rouge");
    expect(codes({ niveauAlerte: "critique" })).toEqual(["ALERTE_CRITIQUE"]);
    expect(codes({ niveauAlerte: "eleve" })).toEqual(["ALERTE_ELEVEE"]);
    expect(codes({ niveauAlerte: "modere" })).toEqual(["ALERTE_MODEREE"]);
    expect(calculerEtatVoyant(avec({ niveauAlerte: "modere" })).voyant).toBe("orange");
  });

  it("trésorerie : seuil de gravité, singulier et pluriel", () => {
    const un = calculerEtatVoyant(avec({ semainesTension: 1 }));
    expect(un.voyant).toBe("orange");
    expect(un.motifs[0]).toMatchObject({ code: "TRESORERIE_TENSION", gravite: "vigilance" });
    expect(un.motifs[0]?.libelle).toContain("1 semaine sur 13");
    const bord = calculerEtatVoyant(avec({ semainesTension: SEMAINES_TENSION_CRITIQUE }));
    expect(bord.voyant).toBe("rouge");
    expect(bord.motifs[0]).toMatchObject({ code: "TRESORERIE_TENSION_PROLONGEE" });
    expect(bord.motifs[0]?.libelle).toContain("semaines sur 13");
    expect(
      calculerEtatVoyant(avec({ semainesTension: SEMAINES_TENSION_CRITIQUE - 1 })).voyant,
    ).toBe("orange");
  });

  it("covenants en défaut : un orange, plusieurs rouge", () => {
    const un = calculerEtatVoyant(avec({ covenantsEnDefaut: 1 }));
    expect(un.voyant).toBe("orange");
    expect(un.motifs[0]).toMatchObject({ code: "COVENANT_DEFAUT" });
    expect(un.motifs[0]?.libelle).toContain("1 covenant n'est pas respecté");
    const n = calculerEtatVoyant(avec({ covenantsEnDefaut: COVENANTS_DEFAUT_CRITIQUE }));
    expect(n.voyant).toBe("rouge");
    expect(n.motifs[0]).toMatchObject({ code: "COVENANTS_DEFAUT_MULTIPLES" });
    expect(n.motifs[0]?.libelle).toContain("covenants ne sont pas respectés");
  });

  it("actions en retard : seuil de gravité", () => {
    expect(calculerEtatVoyant(avec({ actionsEnRetard: 1 })).motifs[0]?.libelle).toBe(
      "1 action du plan est en retard.",
    );
    expect(codes({ actionsEnRetard: ACTIONS_RETARD_CRITIQUE - 1 })).toEqual(["ACTIONS_RETARD"]);
    expect(calculerEtatVoyant(avec({ actionsEnRetard: ACTIONS_RETARD_CRITIQUE })).voyant).toBe(
      "rouge",
    );
    expect(codes({ actionsEnRetard: ACTIONS_RETARD_CRITIQUE })).toEqual([
      "ACTIONS_RETARD_NOMBREUSES",
    ]);
  });

  it("suivi : attention orange, information sans effet sur le voyant", () => {
    const att = calculerEtatVoyant(avec({ alertesSuivi: { nombre: 3, attention: 2 } }));
    expect(att.voyant).toBe("orange");
    expect(att.motifs[0]).toMatchObject({ code: "SUIVI_ATTENTION" });
    expect(att.motifs[0]?.libelle).toContain("2 points d'attention");
    expect(
      calculerEtatVoyant(avec({ alertesSuivi: { nombre: 1, attention: 1 } })).motifs[0]?.libelle,
    ).toContain("1 point d'attention");
    const info = calculerEtatVoyant(avec({ alertesSuivi: { nombre: 2, attention: 0 } }));
    expect(info.voyant).toBe("vert");
    expect(info.motifs[0]).toMatchObject({ code: "SUIVI_INFORMATION", gravite: "information" });
    expect(info.motifs[0]?.libelle).toContain("2 informations");
    expect(
      calculerEtatVoyant(avec({ alertesSuivi: { nombre: 1, attention: 0 } })).motifs[0]?.libelle,
    ).toContain("1 information.");
  });

  it("clôture : brouillon informatif et donnée ; valide sans motif", () => {
    const b = calculerEtatVoyant(avec({ statutCloture: "brouillon" }));
    expect(b.voyant).toBe("vert");
    expect(b.motifs.map((m) => m.code)).toEqual(["CLOTURE_BROUILLON"]);
    expect(codes({ statutCloture: "valide" })).toEqual([]);
  });

  it("ordre des motifs : gravité décroissante, ordre des règles à gravité égale", () => {
    const r = calculerEtatVoyant(
      avec({
        voyantUrgence: "orange",
        niveauAlerte: "critique",
        semainesTension: 2,
        covenantsEnDefaut: 3,
        actionsEnRetard: 1,
        alertesSuivi: { nombre: 1, attention: 1 },
        statutCloture: "brouillon",
      }),
    );
    expect(r.voyant).toBe("rouge");
    expect(r.motifs.map((m) => m.code)).toEqual([
      "ALERTE_CRITIQUE",
      "COVENANTS_DEFAUT_MULTIPLES",
      "URGENCE_ORANGE",
      "TRESORERIE_TENSION",
      "ACTIONS_RETARD",
      "SUIVI_ATTENTION",
      "CLOTURE_BROUILLON",
    ]);
  });

  it("déterministe et sans mutation de l'entrée", () => {
    const e = avec({ voyantUrgence: "rouge", actionsEnRetard: 2 });
    const copie = JSON.stringify(e);
    expect(calculerEtatVoyant(e)).toEqual(calculerEtatVoyant(e));
    expect(JSON.stringify(e)).toBe(copie);
  });

  it("refuse un compteur négatif ou non entier", () => {
    expect(() => calculerEtatVoyant(avec({ semainesTension: -1 }))).toThrow(RangeError);
    expect(() => calculerEtatVoyant(avec({ covenantsEnDefaut: 1.5 }))).toThrow(RangeError);
    expect(() => calculerEtatVoyant(avec({ actionsEnRetard: -2 }))).toThrow(RangeError);
    expect(() => calculerEtatVoyant(avec({ alertesSuivi: { nombre: -1, attention: 0 } }))).toThrow(
      RangeError,
    );
    expect(() => calculerEtatVoyant(avec({ alertesSuivi: { nombre: 1, attention: 0.5 } }))).toThrow(
      RangeError,
    );
  });

  it("aucun libellé ne qualifie juridiquement la situation", () => {
    const interdits = [
      "cessation des paiements",
      "faillite",
      "défaillance",
      "état de crise",
      "en difficulté",
    ];
    const r = calculerEtatVoyant(
      avec({
        voyantUrgence: "rouge",
        niveauAlerte: "critique",
        semainesTension: 6,
        covenantsEnDefaut: 2,
        actionsEnRetard: 6,
        alertesSuivi: { nombre: 2, attention: 1 },
        statutCloture: "absent",
      }),
    );
    for (const m of r.motifs) {
      for (const mot of interdits) expect(m.libelle.toLowerCase()).not.toContain(mot);
    }
  });
});

describe("portefeuille", () => {
  it("synthèse : chaque voyant présent, comptes exacts", () => {
    expect(synthetiserPortefeuilleVoyants([])).toEqual({
      rouge: 0,
      orange: 0,
      vert: 0,
      inconnu: 0,
    });
    expect(synthetiserPortefeuilleVoyants(["rouge", "vert", "rouge", "inconnu"])).toEqual({
      rouge: 2,
      orange: 0,
      vert: 1,
      inconnu: 1,
    });
  });

  it("tri d'attention : voyant, puis motifs critiques, puis motifs de vigilance", () => {
    const rouge2 = calculerEtatVoyant(avec({ voyantUrgence: "rouge", niveauAlerte: "critique" }));
    const rouge1 = calculerEtatVoyant(avec({ voyantUrgence: "rouge" }));
    const orange2 = calculerEtatVoyant(avec({ voyantUrgence: "orange", actionsEnRetard: 1 }));
    const orange1 = calculerEtatVoyant(avec({ voyantUrgence: "orange" }));
    const vert = calculerEtatVoyant(avec({ voyantUrgence: "vert" }));
    const inconnu = calculerEtatVoyant(VIDE);
    const trie = [inconnu, vert, orange1, rouge1, orange2, rouge2].sort(comparerAttention);
    expect(trie).toEqual([rouge2, rouge1, orange2, orange1, vert, inconnu]);
    expect(comparerAttention(vert, vert)).toBe(0);
  });

  it("motifs principaux : les plus graves, plafonnés", () => {
    const r = calculerEtatVoyant(
      avec({
        voyantUrgence: "rouge",
        niveauAlerte: "critique",
        semainesTension: 6,
        covenantsEnDefaut: 1,
        actionsEnRetard: 1,
      }),
    );
    const p = motifsPrincipaux(r.motifs);
    expect(p).toHaveLength(MOTIFS_PRINCIPAUX_MAX);
    expect(p).toEqual(r.motifs.slice(0, MOTIFS_PRINCIPAUX_MAX));
    expect(motifsPrincipaux([])).toEqual([]);
  });
});
