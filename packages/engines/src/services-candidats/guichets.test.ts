import { describe, expect, it } from "vitest";
import {
  OBJETS_FINANCEMENT,
  rapprocherGuichets,
  TYPES_GUICHET,
  type GuichetFinancement,
  type ProfilFinancement,
} from "./guichets";

const AUJOURDHUI = "2026-10-21";

const guichet = (id: string, extra: Partial<GuichetFinancement> = {}): GuichetFinancement => ({
  id,
  nom: `Guichet ${id}`,
  type: "banque",
  pays: [],
  secteurs: [],
  filieres: [],
  tailles: [],
  objets: [],
  devises: [],
  montant_min: null,
  montant_max: null,
  devise_montant: null,
  date_limite: null,
  actif: true,
  ...extra,
});

const profilVide: ProfilFinancement = {
  pays: null,
  secteur: null,
  filieres: [],
  taille: null,
  objet: null,
  montant: null,
  devise: null,
};
const profil = (extra: Partial<ProfilFinancement> = {}): ProfilFinancement => ({
  ...profilVide,
  ...extra,
});

const un = (g: GuichetFinancement, p: ProfilFinancement) =>
  rapprocherGuichets([g], p, AUJOURDHUI)[0]!;
const verdict = (g: GuichetFinancement, p: ProfilFinancement, cle: string) =>
  un(g, p).criteres.find((c) => c.critere === cle)?.verdict;

describe("vocabulaires", () => {
  it("expose les types et objets du contrat", () => {
    expect(TYPES_GUICHET).toHaveLength(5);
    expect(OBJETS_FINANCEMENT).toHaveLength(6);
  });
});

describe("rapprocherGuichets : sans restriction", () => {
  it("liste vide : aucun résultat", () => {
    expect(rapprocherGuichets([], profilVide, AUJOURDHUI)).toEqual([]);
  });

  it("guichet sans aucune restriction : compatible, score 100", () => {
    const r = un(guichet("a"), profilVide);
    expect(r.statut).toBe("compatible");
    expect(r.score).toBe(100);
    expect(r.raisons_exclusion).toEqual([]);
    expect(r.criteres.map((c) => c.critere)).toEqual([
      "actif",
      "echeance",
      "pays",
      "secteur",
      "filiere",
      "taille",
      "objet",
      "devise",
      "montant",
    ]);
    expect(verdict(guichet("a"), profilVide, "pays")).toBe("non_restreint");
  });
});

describe("actif et échéance", () => {
  it("guichet inactif : exclu, score 0", () => {
    const r = un(guichet("a", { actif: false }), profilVide);
    expect(r.statut).toBe("exclu");
    expect(r.score).toBe(0);
    expect(r.raisons_exclusion).toEqual(["Guichet inactif."]);
  });

  it("date limite dépassée : exclu ; le jour même et le futur : acceptés", () => {
    expect(un(guichet("a", { date_limite: "2026-10-20" }), profilVide).statut).toBe("exclu");
    expect(un(guichet("a", { date_limite: "2026-10-21" }), profilVide).statut).toBe("compatible");
    expect(un(guichet("a", { date_limite: "2027-01-01" }), profilVide).statut).toBe("compatible");
  });

  it("formats de date invalides : erreur claire", () => {
    expect(() => rapprocherGuichets([], profilVide, "21/10/2026")).toThrow(/Date du jour/);
    expect(() => rapprocherGuichets([], profilVide, "2026-02-31")).toThrow(/valide attendue/);
    expect(() =>
      rapprocherGuichets([guichet("g1", { date_limite: "demain" })], profilVide, AUJOURDHUI),
    ).toThrow(/g1/);
  });
});

describe("critères en liste", () => {
  it("valeur dans la liste : ok ; sans casse ni accents", () => {
    const g = guichet("a", { pays: ["Côte d’Ivoire"], secteurs: ["Agro-industrie"] });
    const p = profil({ pays: "  COTE D’IVOIRE ", secteur: "agro-industrie" });
    expect(verdict(g, p, "pays")).toBe("ok");
    expect(verdict(g, p, "secteur")).toBe("ok");
    expect(un(g, p).statut).toBe("compatible");
  });

  it("hors liste : ko, exclu, raison en français", () => {
    const r = un(guichet("a", { pays: ["SN"] }), profil({ pays: "CI" }));
    expect(r.statut).toBe("exclu");
    expect(r.score).toBe(0);
    expect(r.raisons_exclusion).toEqual(["Pays du client hors de la liste du guichet."]);
  });

  it("profil non renseigné : inconnu, partiel, score proportionnel", () => {
    const g = guichet("a", { pays: ["CI"], secteurs: ["agro"], tailles: ["PME"] });
    const p = profil({ pays: "CI", secteur: null, taille: null });
    const r = un(g, p);
    expect(r.statut).toBe("partiel");
    expect(r.score).toBe(33);
    expect(verdict(g, p, "secteur")).toBe("inconnu");
  });

  it("filières : au moins une en commun", () => {
    const g = guichet("a", { filieres: ["cacao", "anacarde"] });
    expect(verdict(g, profil({ filieres: ["Café", "Anacarde"] }), "filiere")).toBe("ok");
    expect(verdict(g, profil({ filieres: ["café"] }), "filiere")).toBe("ko");
    expect(verdict(g, profil({ filieres: [] }), "filiere")).toBe("inconnu");
  });

  it("taille, objet et devise", () => {
    const g = guichet("a", { tailles: ["PME"], objets: ["bfr", "export"], devises: ["XOF"] });
    const p = profil({ taille: "pme", objet: "bfr", devise: "XOF" });
    expect(un(g, p).statut).toBe("compatible");
    expect(verdict(g, profil({ objet: "creation" }), "objet")).toBe("ko");
    expect(verdict(g, profil({ devise: "EUR" }), "devise")).toBe("ko");
  });
});

describe("montant", () => {
  const g = guichet("a", { montant_min: 1000, montant_max: 5000, devise_montant: "XOF" });

  it("aucune borne : non restreint", () => {
    expect(verdict(guichet("a"), profil({ montant: 1 }), "montant")).toBe("non_restreint");
  });

  it("dans les bornes (inclusives) : ok", () => {
    expect(verdict(g, profil({ montant: 1000, devise: "XOF" }), "montant")).toBe("ok");
    expect(verdict(g, profil({ montant: 5000, devise: "XOF" }), "montant")).toBe("ok");
  });

  it("sous le minimum ou au-dessus du maximum : ko", () => {
    const bas = un(g, profil({ montant: 999, devise: "XOF" }));
    expect(bas.statut).toBe("exclu");
    expect(bas.raisons_exclusion[0]).toMatch(/inférieur au minimum/);
    expect(un(g, profil({ montant: 5001, devise: "XOF" })).raisons_exclusion[0]).toMatch(
      /supérieur au maximum/,
    );
  });

  it("bornes partielles : seul le minimum, seul le maximum", () => {
    const min = guichet("a", { montant_min: 10 });
    const max = guichet("a", { montant_max: 10 });
    expect(verdict(min, profil({ montant: 1_000_000 }), "montant")).toBe("ok");
    expect(verdict(min, profil({ montant: 5 }), "montant")).toBe("ko");
    expect(verdict(max, profil({ montant: 5 }), "montant")).toBe("ok");
    expect(verdict(max, profil({ montant: 50 }), "montant")).toBe("ko");
  });

  it("devises différentes ou absente : inconnu, aucune conversion", () => {
    const r = un(g, profil({ montant: 999_999_999, devise: "EUR" }));
    expect(r.statut).toBe("partiel");
    expect(r.criteres.find((c) => c.critere === "montant")?.detail).toBe(
      "Devises différentes, montant non comparable (aucune conversion).",
    );
    expect(verdict(g, profil({ montant: 2000 }), "montant")).toBe("inconnu");
  });

  it("sans devise de borne : comparaison directe ; profil sans montant : inconnu", () => {
    const sansDevise = guichet("a", { montant_max: 100 });
    expect(verdict(sansDevise, profil({ montant: 50, devise: "EUR" }), "montant")).toBe("ok");
    expect(verdict(sansDevise, profil({ devise: "XOF" }), "montant")).toBe("inconnu");
  });
});

describe("tri et immutabilité", () => {
  it("statut, score décroissant, nom (accents), puis id", () => {
    const p = profil({ pays: "CI", secteur: "agro" });
    const liste = [
      guichet("exclu", { nom: "Aaa", actif: false }),
      guichet("part", { nom: "Bbb", pays: ["CI"], tailles: ["PME"] }),
      guichet("part2", { nom: "Ccc", pays: ["CI"], secteurs: ["agro"], tailles: ["PME"] }),
      guichet("z", { nom: "Écureuil" }),
      guichet("y", { nom: "Ecureuil" }),
      guichet("x", { nom: "Ecureuil" }),
      guichet("zz", { nom: "Zèbre" }),
    ];
    const ids = rapprocherGuichets(liste, p, AUJOURDHUI).map((r) => r.guichet_id);
    expect(ids).toEqual(["x", "y", "z", "zz", "part2", "part", "exclu"]);
  });

  it("score décroissant à statut égal", () => {
    const liste = [
      guichet("b", { nom: "A", pays: ["CI"], secteurs: ["agro"], tailles: ["PME"] }),
      guichet("a", { nom: "B", pays: ["CI"], secteurs: ["agro"] }),
    ];
    const r = rapprocherGuichets(liste, profil({ pays: "CI", secteur: "agro" }), AUJOURDHUI);
    expect(r.map((x) => [x.guichet_id, x.score])).toEqual([
      ["a", 100],
      ["b", 67],
    ]);
  });

  it("identifiants identiques : ordre stable, sans erreur", () => {
    const r = rapprocherGuichets([guichet("a"), guichet("a")], profilVide, AUJOURDHUI);
    expect(r).toHaveLength(2);
  });

  it("n'altère pas l'entrée", () => {
    const liste = [guichet("b", { nom: "B", pays: ["CI"] }), guichet("a", { nom: "A" })];
    const p = profil({ filieres: ["cacao"], pays: "SN" });
    const avant = JSON.stringify([liste, p]);
    rapprocherGuichets(liste, p, AUJOURDHUI);
    expect(JSON.stringify([liste, p])).toBe(avant);
    expect(liste.map((g) => g.id)).toEqual(["b", "a"]);
  });
});
