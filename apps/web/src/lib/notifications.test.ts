import { describe, expect, it } from "vitest";
import {
  hrefNotifications,
  libelleCloche,
  lienNotification,
  lireParametresNotifications,
  paragraphes,
  pastilleCloche,
} from "./notifications";

describe("liens des notifications", () => {
  it("garde un chemin interne", () => {
    expect(lienNotification("/temps/validation")).toBe("/temps/validation");
    expect(lienNotification("/temps?semaine=2026-10-05")).toBe("/temps?semaine=2026-10-05");
  });

  it("redirige l'ancien chemin de « Mon planning »", () => {
    expect(lienNotification("/mon-planning?semaine=2026-10-05")).toBe(
      "/planning?semaine=2026-10-05",
    );
    expect(lienNotification("/mon-planning")).toBe("/planning");
    expect(lienNotification("/mon-planning-bis")).toBe("/mon-planning-bis");
  });

  it("refuse toute adresse externe ou détournée", () => {
    for (const l of [
      "https://exemple.com",
      "//exemple.com",
      "/\\exemple.com",
      "javascript:alert(1)",
      "/<script>",
      "",
      null,
    ]) {
      expect(lienNotification(l)).toBeNull();
    }
  });
});

describe("cloche", () => {
  it("a un nom accessible qui porte le compteur", () => {
    expect(libelleCloche(0)).toBe("Notifications, aucune non lue");
    expect(libelleCloche(null)).toBe("Notifications, aucune non lue");
    expect(libelleCloche(1)).toBe("Notifications, 1 non lue");
    expect(libelleCloche(12)).toBe("Notifications, 12 non lues");
  });

  it("plafonne la pastille à « 9+ »", () => {
    expect(pastilleCloche(0)).toBeNull();
    expect(pastilleCloche(3)).toBe("3");
    expect(pastilleCloche(10)).toBe("9+");
  });
});

describe("page des notifications", () => {
  it("lit le filtre et le curseur, construit les liens", () => {
    expect(lireParametresNotifications({ filtre: "non_lues", curseur: "abc" })).toEqual({
      nonLues: true,
      curseur: "abc",
    });
    expect(lireParametresNotifications({ curseur: "a b" })).toEqual({
      nonLues: false,
      curseur: "",
    });
    expect(hrefNotifications(true, "abc")).toBe("/notifications?filtre=non_lues&curseur=abc");
    expect(hrefNotifications(false)).toBe("/notifications");
  });

  it("découpe le corps en paragraphes de texte brut", () => {
    expect(paragraphes("Ligne 1\n\n <b>Ligne 2</b> ")).toEqual(["Ligne 1", "<b>Ligne 2</b>"]);
    expect(paragraphes(null)).toEqual([]);
  });
});
