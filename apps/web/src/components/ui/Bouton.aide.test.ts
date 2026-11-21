import { describe, expect, it } from "vitest";
import { accessibiliteBouton } from "./Bouton.aide";

describe("accessibiliteBouton", () => {
  it("n'ajoute rien à un bouton actif", () => {
    const r = accessibiliteBouton({ id: "b1" });
    expect(r).toEqual({
      desactive: false,
      ariaBusy: undefined,
      idRaison: undefined,
      ariaDescribedBy: undefined,
      title: undefined,
    });
  });

  it("désactive et signale occupé pendant le chargement, sans raison annoncée", () => {
    const r = accessibiliteBouton({ id: "b1", chargement: true, raisonDesactive: "Pourquoi" });
    expect(r.desactive).toBe(true);
    expect(r.ariaBusy).toBe(true);
    expect(r.idRaison).toBeUndefined();
    expect(r.title).toBeUndefined();
  });

  it("explique un bouton désactivé : texte lié et title", () => {
    const r = accessibiliteBouton({
      id: "b1",
      disabled: true,
      raisonDesactive: "  Complétez le formulaire ",
    });
    expect(r.desactive).toBe(true);
    expect(r.idRaison).toBe("b1-raison");
    expect(r.ariaDescribedBy).toBe("b1-raison");
    expect(r.title).toBe("Complétez le formulaire");
  });

  it("ignore la raison si le bouton n'est pas désactivé ou si elle est vide", () => {
    expect(accessibiliteBouton({ id: "b", raisonDesactive: "x" }).idRaison).toBeUndefined();
    expect(
      accessibiliteBouton({ id: "b", disabled: true, raisonDesactive: "  " }).idRaison,
    ).toBeUndefined();
  });

  it("conserve aria-describedby et title de l'appelant", () => {
    const r = accessibiliteBouton({
      id: "b1",
      disabled: true,
      raisonDesactive: "Raison",
      describedBy: "aide",
      title: "Mon titre",
    });
    expect(r.ariaDescribedBy).toBe("aide b1-raison");
    expect(r.title).toBe("Mon titre");
  });
});
