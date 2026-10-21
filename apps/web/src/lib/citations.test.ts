import { describe, expect, it } from "vitest";
import {
  ancreSource,
  cheminSourceCitee,
  cheminSourcesLivrable,
  estLivrableCitation,
  formaterRenvois,
  formaterRenvoisContre,
  hrefAncreSource,
  hrefLivrableCitant,
  hrefOuvertureCitation,
  indexerSources,
  libelleFiabiliteSource,
  libelleRetourLivrable,
  libelleSoliditeCitee,
  libelleTypeSource,
  MESSAGE_VERBATIM_MASQUE,
  nomAccessibleRenvoi,
  type SourceCiteeVue,
} from "./citations";

const M = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";

const SOURCE: SourceCiteeVue = {
  numero: 3,
  preuve_id: P,
  type_source: "entretien",
  source_precise: "Compte rendu du 12 mars",
  date_preuve: "2026-03-12",
  fiabilite: "B",
  extrait: null,
  masque: false,
};

describe("renvois", () => {
  it("formate « [1], [2] » et « contre : [3] »", () => {
    expect(formaterRenvois([1, 2])).toBe("[1], [2]");
    expect(formaterRenvois([])).toBe("");
    expect(formaterRenvoisContre([3])).toBe("contre : [3]");
    expect(formaterRenvoisContre([3, 4])).toBe("contre : [3], [4]");
    expect(formaterRenvoisContre([])).toBe("");
  });

  it("nomme un renvoi pour les lecteurs d'écran", () => {
    expect(nomAccessibleRenvoi(3, SOURCE)).toBe("Source 3 : Entretien, Compte rendu du 12 mars");
    expect(nomAccessibleRenvoi(7, undefined)).toBe("Source 7");
  });

  it("indexe les sources par numéro", () => {
    expect(indexerSources([SOURCE]).get(3)?.preuve_id).toBe(P);
  });
});

describe("solidité et libellés", () => {
  it("écrit la lecture du moteur avec son indice, sans couleur seule", () => {
    expect(libelleSoliditeCitee({ lecture: "solide", indice: 0.875 })).toBe("Solide (0,875)");
    expect(libelleSoliditeCitee({ lecture: "fragile", indice: 0 })).toBe("Fragile (0)");
    expect(libelleSoliditeCitee(null)).toBe("Non évaluée");
  });

  it("traduit type et fiabilité, et tolère une valeur inconnue", () => {
    expect(libelleTypeSource("entretien")).toBe("Entretien");
    expect(libelleTypeSource("inconnu")).toBe("inconnu");
    expect(libelleFiabiliteSource("A")).toBe("A · Très fiable");
    expect(libelleFiabiliteSource("Z")).toBe("Z");
  });

  it("garde le texte de masquage attendu", () => {
    expect(MESSAGE_VERBATIM_MASQUE).toBe(
      "Verbatim nominatif masqué : accord de la personne non recueilli",
    );
  });
});

describe("chemins et liens", () => {
  it("construit les ancres et les liens d'ouverture", () => {
    expect(ancreSource(2)).toBe("source-2");
    expect(hrefAncreSource(2)).toBe("#source-2");
    expect(hrefOuvertureCitation(M, "plan", P)).toBe(`/missions/${M}/preuves/citations/plan/${P}`);
  });

  it("route le retour vers le bon livrable", () => {
    expect(hrefLivrableCitant(M, "plan")).toBe(`/missions/${M}/plan`);
    expect(hrefLivrableCitant(M, "notation")).toBe(`/missions/${M}/notation`);
    expect(libelleRetourLivrable("plan")).toBe("Revenir au plan stratégique");
    expect(libelleRetourLivrable("notation")).toBe("Revenir à la notation");
  });

  it("construit les chemins d'API", () => {
    expect(cheminSourcesLivrable(M, "notation")).toBe(
      `/api/missions/${M}/livrables/notation/sources`,
    );
    expect(cheminSourceCitee(M, "plan", P)).toBe(`/api/missions/${M}/livrables/plan/sources/${P}`);
  });

  it("ne reconnaît que les livrables cités", () => {
    expect(estLivrableCitation("plan")).toBe(true);
    expect(estLivrableCitation("notation")).toBe(true);
    expect(estLivrableCitation("budget")).toBe(false);
  });
});
