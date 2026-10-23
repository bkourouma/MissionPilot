import { describe, expect, it } from "vitest";
import {
  RED_GRAVITES_MOTIF,
  RED_TABLEAU_LIMITE_DEFAUT,
  RED_TABLEAU_LIMITE_MAX,
  RED_VOYANTS_PILOTAGE,
} from "@missionpilot/shared";
import { MOTS_INTERDITS } from "./redressement";
import {
  BLOCS_VIDES,
  cheminTableauDossier,
  cheminTableauPortefeuille,
  formaterIndicateur,
  hrefTableauPortefeuille,
  libelleGravite,
  libelleNombre,
  libellesTableau,
  lireFiltresTableau,
  texteAlternatifVoyant,
  tonaliteGravite,
  tonaliteVoyantPilotage,
} from "./redressement-tableau";

describe("chemins et liens", () => {
  it("construit le chemin du tableau d'un dossier", () => {
    expect(cheminTableauDossier("a/b")).toBe("/api/redressement/dossiers/a%2Fb/tableau-de-bord");
  });

  it("construit le chemin du portefeuille avec limite, filtres et curseur", () => {
    expect(cheminTableauPortefeuille({ limite: 10 })).toBe(
      "/api/redressement/tableau-de-bord?limite=10",
    );
    expect(
      cheminTableauPortefeuille({
        limite: 25,
        statut: "ouvert",
        secteur: "commerce",
        curseur: "x y",
      }),
    ).toBe(
      "/api/redressement/tableau-de-bord?limite=25&statut=ouvert&secteur=commerce&curseur=x+y",
    );
  });

  it("n'écrit pas la limite par défaut dans le lien de la page", () => {
    expect(hrefTableauPortefeuille({ limite: RED_TABLEAU_LIMITE_DEFAUT })).toBe(
      "/redressement/tableau-de-bord",
    );
    expect(hrefTableauPortefeuille({ limite: 25 })).toBe("/redressement/tableau-de-bord?limite=25");
  });
});

describe("filtres de l'URL", () => {
  it("applique la limite par défaut et ignore les valeurs invalides", () => {
    expect(lireFiltresTableau({}).limite).toBe(RED_TABLEAU_LIMITE_DEFAUT);
    expect(lireFiltresTableau({ limite: "abc" }).limite).toBe(RED_TABLEAU_LIMITE_DEFAUT);
    expect(lireFiltresTableau({ limite: "0" }).limite).toBe(RED_TABLEAU_LIMITE_DEFAUT);
    expect(lireFiltresTableau({ statut: "inconnu", secteur: "nimporte" })).toMatchObject({
      statut: undefined,
      secteur: undefined,
    });
  });

  it("borne la limite au maximum", () => {
    expect(lireFiltresTableau({ limite: "500" }).limite).toBe(RED_TABLEAU_LIMITE_MAX);
    expect(lireFiltresTableau({ limite: ["5", "9"] }).limite).toBe(5);
  });

  it("conserve le curseur", () => {
    expect(lireFiltresTableau({ curseur: "abc" }).curseur).toBe("abc");
  });
});

describe("libellés et tonalités", () => {
  it("donne une tonalité distincte à chaque voyant et son texte alternatif", () => {
    expect(RED_VOYANTS_PILOTAGE.map(tonaliteVoyantPilotage)).toEqual([
      "danger",
      "attention",
      "succes",
      "neutre",
    ]);
    for (const v of RED_VOYANTS_PILOTAGE) {
      expect(texteAlternatifVoyant(v)).toContain("indicatif");
    }
    expect(texteAlternatifVoyant("rouge")).toContain("priorité haute");
  });

  it("libelle et teinte chaque gravité", () => {
    expect(RED_GRAVITES_MOTIF.map(tonaliteGravite)).toEqual(["danger", "attention", "neutre"]);
    expect(libelleGravite("critique")).toBe("Point critique");
  });

  it("met en forme les indicateurs sans calcul", () => {
    expect(formaterIndicateur({ cle: "score_alerte", valeur: null })).toBe("—");
    expect(formaterIndicateur({ cle: "voyant_urgence", valeur: "rouge" })).not.toBe("rouge");
    expect(formaterIndicateur({ cle: "niveau_alerte", valeur: "critique" })).not.toBe("critique");
    expect(formaterIndicateur({ cle: "actions_en_retard", valeur: 3 })).toBe("3");
    expect(formaterIndicateur({ cle: "semaines_tension", valeur: "texte" })).toBe("texte");
    expect(libelleNombre(null)).toBe("—");
  });
});

describe("blocs vides", () => {
  it("explique chaque bloc absent et renvoie vers un onglet existant", () => {
    const sections = [
      "tresorerie",
      "financement",
      "plan",
      "creanciers",
      "diagnostic",
      "cloture",
      "suivi",
    ];
    for (const b of Object.values(BLOCS_VIDES)) {
      expect(b.texte.length).toBeGreaterThan(10);
      expect(sections).toContain(b.section);
    }
    expect(Object.keys(BLOCS_VIDES)).toHaveLength(8);
  });
});

describe("textes de l'écran", () => {
  it("n'emploie aucun mot interdit et mentionne le caractère indicatif", () => {
    for (const t of libellesTableau()) {
      for (const mot of MOTS_INTERDITS) expect(t.toLowerCase()).not.toContain(mot);
    }
    expect(libellesTableau().join(" ")).toContain("ne qualifie pas");
  });
});
