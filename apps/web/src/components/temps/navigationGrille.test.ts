import { describe, expect, it } from "vitest";
import { cibleGrille, pasDeTouche } from "./navigationGrille";

const ctx = (key: string, over: Partial<Parameters<typeof pasDeTouche>[0]> = {}) => ({
  key,
  debutSelection: 0,
  finSelection: 0,
  longueur: 0,
  ...over,
});

describe("pasDeTouche", () => {
  it("haut, bas et Entrée changent de ligne", () => {
    expect(pasDeTouche(ctx("ArrowDown"))).toEqual({ dl: 1, dc: 0 });
    expect(pasDeTouche(ctx("ArrowUp"))).toEqual({ dl: -1, dc: 0 });
    expect(pasDeTouche(ctx("Enter"))).toEqual({ dl: 1, dc: 0 });
    expect(pasDeTouche(ctx("Enter", { shiftKey: true }))).toEqual({ dl: -1, dc: 0 });
  });

  it("gauche et droite ne bougent qu'au bord du texte", () => {
    const milieu = { debutSelection: 1, finSelection: 1, longueur: 3 };
    expect(pasDeTouche(ctx("ArrowRight", milieu))).toBeNull();
    expect(pasDeTouche(ctx("ArrowLeft", milieu))).toBeNull();
    expect(
      pasDeTouche(ctx("ArrowRight", { debutSelection: 3, finSelection: 3, longueur: 3 })),
    ).toEqual({
      dl: 0,
      dc: 1,
    });
    expect(pasDeTouche(ctx("ArrowLeft", { longueur: 3 }))).toEqual({ dl: 0, dc: -1 });
  });

  it("une sélection partielle garde les flèches horizontales", () => {
    expect(
      pasDeTouche(ctx("ArrowRight", { debutSelection: 1, finSelection: 3, longueur: 3 })),
    ).toBeNull();
    expect(
      pasDeTouche(ctx("ArrowLeft", { debutSelection: 0, finSelection: 2, longueur: 3 })),
    ).toBeNull();
  });

  it("une sélection de tout le texte est au bord : la flèche change de case dès la première pression", () => {
    const tout = { debutSelection: 0, finSelection: 3, longueur: 3 };
    expect(pasDeTouche(ctx("ArrowRight", tout))).toEqual({ dl: 0, dc: 1 });
    expect(pasDeTouche(ctx("ArrowLeft", tout))).toEqual({ dl: 0, dc: -1 });
  });

  it("laisse les autres touches (Tab, chiffres) au navigateur", () => {
    expect(pasDeTouche(ctx("Tab"))).toBeNull();
    expect(pasDeTouche(ctx("1"))).toBeNull();
  });
});

describe("cibleGrille", () => {
  const taille = { lignes: 3, colonnes: 4 };
  const toutes = () => true;

  it("avance d'une case dans la direction demandée", () => {
    expect(cibleGrille({ ligne: 0, colonne: 0 }, { dl: 1, dc: 0 }, taille, toutes)).toEqual({
      ligne: 1,
      colonne: 0,
    });
    expect(cibleGrille({ ligne: 1, colonne: 1 }, { dl: 0, dc: 1 }, taille, toutes)).toEqual({
      ligne: 1,
      colonne: 2,
    });
  });

  it("reste en place au bord de la grille", () => {
    expect(cibleGrille({ ligne: 2, colonne: 0 }, { dl: 1, dc: 0 }, taille, toutes)).toBeNull();
    expect(cibleGrille({ ligne: 0, colonne: 0 }, { dl: 0, dc: -1 }, taille, toutes)).toBeNull();
    expect(cibleGrille({ ligne: 0, colonne: 3 }, { dl: 0, dc: 1 }, taille, toutes)).toBeNull();
  });

  it("saute les cases absentes (jour clôturé)", () => {
    const sansColonne2 = (p: { colonne: number }) => p.colonne !== 2;
    expect(cibleGrille({ ligne: 0, colonne: 1 }, { dl: 0, dc: 1 }, taille, sansColonne2)).toEqual({
      ligne: 0,
      colonne: 3,
    });
    expect(
      cibleGrille(
        { ligne: 0, colonne: 1 },
        { dl: 0, dc: 1 },
        { lignes: 1, colonnes: 3 },
        sansColonne2,
      ),
    ).toBeNull();
  });
});
