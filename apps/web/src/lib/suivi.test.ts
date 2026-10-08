import { describe, expect, it } from "vitest";
import {
  aplatirArbre,
  badgeCouleur,
  formaterEcart,
  lectureIndice,
  libelleAlerte,
  libelleNoeud,
  type NoeudSuivi,
} from "./suivi";

const noeud = (p: Partial<NoeudSuivi> & Pick<NoeudSuivi, "id" | "niveau">): NoeudSuivi => ({
  libelle: p.id,
  budget: 0,
  realise: 0,
  reste_a_faire: 0,
  atterrissage: 0,
  ecart: 0,
  ecart_relatif: null,
  consommation: null,
  couleur: "vert",
  en_attente: 0,
  enfants: [],
  ...p,
});

/** Exemple du PRD (« Volumes journaliers budgétés et réalisés »), tel que l'API le renvoie. */
const racine = noeud({
  id: "m",
  niveau: "mission",
  budget: 50,
  realise: 26.5,
  reste_a_faire: 26,
  atterrissage: 52.5,
  ecart: 2.5,
  ecart_relatif: 0.05,
  couleur: "orange",
  enfants: [
    noeud({
      id: "diag",
      niveau: "phase",
      libelle: "Diagnostic",
      enfants: [
        noeud({ id: "lot", niveau: "lot", enfants: [noeud({ id: "t1", niveau: "tache" })] }),
      ],
    }),
    noeud({ id: "analyse", niveau: "phase", libelle: "Analyse des processus" }),
  ],
});

describe("suivi de mission", () => {
  it("aplatit l'arbre (phases, lots, tâches) avec la profondeur", () => {
    expect(aplatirArbre(racine).map((l) => [l.noeud.id, l.profondeur])).toEqual([
      ["diag", 0],
      ["lot", 1],
      ["t1", 2],
      ["analyse", 0],
    ]);
  });

  it("affiche l'écart signé avec son pourcentage (+2,5 j (+5 %))", () => {
    expect(formaterEcart(2.5, 0.05)).toBe("+2,5\u00a0j (+5\u00a0%)");
    expect(formaterEcart(-1, null)).toBe("\u22121\u00a0j");
    expect(formaterEcart(0, 0)).toBe("0\u00a0j (0\u00a0%)");
  });

  it("accompagne toujours la couleur d'un libellé", () => {
    expect(badgeCouleur("vert")).toEqual({ tonalite: "succes", libelle: "Dans le budget" });
    expect(badgeCouleur("orange").libelle).toBe("À surveiller");
    expect(badgeCouleur("rouge").tonalite).toBe("danger");
  });

  it("nomme les alertes et l'élément concerné", () => {
    expect(libelleAlerte({ type: "consommation_seuil" })).toBe("Consommation au-delà du seuil");
    expect(libelleAlerte({ type: "atterrissage_superieur_budget" })).toBe(
      "Atterrissage supérieur au budget",
    );
    expect(libelleAlerte({ type: "autre" })).toBe("Alerte de suivi");
    expect(libelleNoeud(racine, "m")).toBe("Mission");
    expect(libelleNoeud(racine, "diag")).toBe("Diagnostic");
    expect(libelleNoeud(racine, "inconnu")).toBe("Élément du découpage");
  });

  it("lit l'indice de performance par rapport à 1", () => {
    expect(lectureIndice(null).tonalite).toBe("neutre");
    expect(lectureIndice(1.2).tonalite).toBe("succes");
    expect(lectureIndice(0.8).tonalite).toBe("attention");
  });
});
