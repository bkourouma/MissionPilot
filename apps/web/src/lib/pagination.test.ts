import { describe, expect, it } from "vitest";
import {
  cheminPage,
  chargerToutesLesPages,
  LIMITE_PAGE_MAX,
  LIMITE_PAGE_SURE,
  pagesAffichees,
} from "./pagination";

describe("pagesAffichees", () => {
  it("affiche toutes les pages quand il y en a peu", () => {
    expect(pagesAffichees(1, 1)).toEqual([1]);
    expect(pagesAffichees(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("place des ellipses autour de la page courante", () => {
    expect(pagesAffichees(5, 10)).toEqual([1, "ellipse", 4, 5, 6, "ellipse", 10]);
    expect(pagesAffichees(1, 10)).toEqual([1, 2, "ellipse", 10]);
    expect(pagesAffichees(10, 10)).toEqual([1, "ellipse", 9, 10]);
  });

  it("remplace une ellipse d'une seule page par le numéro", () => {
    expect(pagesAffichees(3, 10)).toEqual([1, 2, 3, 4, "ellipse", 10]);
  });

  it("borne une page hors limites et gère zéro page", () => {
    expect(pagesAffichees(99, 3)).toEqual([1, 2, 3]);
    expect(pagesAffichees(0, 3)).toEqual([1, 2, 3]);
    expect(pagesAffichees(1, 0)).toEqual([]);
  });
});

describe("cheminPage", () => {
  it("ajoute limite et curseur, avec ou sans requête existante", () => {
    expect(cheminPage("/api/missions", 500, null)).toBe("/api/missions?limite=500");
    expect(cheminPage("/api/missions?statut=en_cours", 100, "abc_-1")).toBe(
      "/api/missions?statut=en_cours&limite=100&curseur=abc_-1",
    );
    expect(cheminPage("/api/missions?limite=3&curseur=x", 7, null)).toBe("/api/missions?limite=7");
  });
});

describe("chargerToutesLesPages", () => {
  /** Faux serveur : 7 éléments servis par pages, curseur = position suivante. */
  const serveur = (total: number, appels: string[]) => async (chemin: string) => {
    appels.push(chemin);
    const r = new URLSearchParams(chemin.split("?")[1]);
    const limite = Number(r.get("limite"));
    const debut = Number(r.get("curseur") ?? "0");
    const fin = Math.min(total, debut + limite);
    return {
      ok: true as const,
      donnees: {
        elements: Array.from({ length: fin - debut }, (_, i) => debut + i),
        suivant: fin < total ? String(fin) : null,
      },
    };
  };

  it("suit `suivant` jusqu'au bout, sans doublon ni oubli", async () => {
    const appels: string[] = [];
    const r = await chargerToutesLesPages(serveur(7, appels), "/api/missions?statut=x", {
      limite: 3,
    });
    expect(r).toEqual({ ok: true, donnees: { elements: [0, 1, 2, 3, 4, 5, 6], tronquee: false } });
    expect(appels).toEqual([
      "/api/missions?statut=x&limite=3",
      "/api/missions?statut=x&limite=3&curseur=3",
      "/api/missions?statut=x&limite=3&curseur=6",
    ]);
  });

  it("par défaut, pages de 200 (plafond sûr) ; liste vide", async () => {
    const appels: string[] = [];
    expect(await chargerToutesLesPages(serveur(0, appels), "/api/opportunites")).toEqual({
      ok: true,
      donnees: { elements: [], tronquee: false },
    });
    expect(appels).toEqual(["/api/opportunites?limite=200"]);
  });

  it("la limite demandée ne dépasse jamais le plafond déclaré de la route", async () => {
    // Collaborateurs : l'API plafonne à 200 et rejette (400) une limite de 500.
    const a: string[] = [];
    await chargerToutesLesPages(serveur(0, a), "/api/collaborateurs", { limite: 500 });
    expect(a).toEqual(["/api/collaborateurs?limite=200"]);
    const b: string[] = [];
    await chargerToutesLesPages(serveur(0, b), "/api/collaborateurs", { limiteMax: 50 });
    expect(b).toEqual(["/api/collaborateurs?limite=50"]);
    const c: string[] = [];
    await chargerToutesLesPages(serveur(0, c), "/api/missions", { limiteMax: LIMITE_PAGE_MAX });
    expect(c).toEqual(["/api/missions?limite=500"]);
    const d: string[] = [];
    await chargerToutesLesPages(serveur(0, d), "/api/missions", {
      limiteMax: LIMITE_PAGE_MAX,
      limite: 1_000,
    });
    expect(d).toEqual(["/api/missions?limite=500"]);
    // Une limite plus petite que le plafond est respectée ; jamais en dessous de 1.
    const e: string[] = [];
    await chargerToutesLesPages(serveur(0, e), "/api/missions", { limite: 0 });
    expect(e).toEqual(["/api/missions?limite=1"]);
    expect(LIMITE_PAGE_SURE).toBeLessThanOrEqual(200);
  });

  it("au-delà du nombre de pages maximal : liste partielle marquée tronquée", async () => {
    const r = await chargerToutesLesPages(serveur(10, []), "/api/missions", {
      limite: 2,
      pagesMax: 3,
    });
    expect(r).toEqual({ ok: true, donnees: { elements: [0, 1, 2, 3, 4, 5], tronquee: true } });
  });

  it("une erreur d'une page est rendue telle quelle ; un curseur répété arrête le parcours", async () => {
    let n = 0;
    const erreur = await chargerToutesLesPages<number>(async () => {
      n += 1;
      return n === 1
        ? { ok: true, donnees: { elements: [1], suivant: "a" } }
        : { ok: false, message: "Service indisponible.", statut: 503 };
    }, "/api/missions");
    expect(erreur).toEqual({ ok: false, message: "Service indisponible.", statut: 503 });
    const boucle = await chargerToutesLesPages<number>(
      async () => ({ ok: true, donnees: { elements: [1], suivant: "meme" } }),
      "/api/missions",
    );
    expect(boucle).toEqual({ ok: true, donnees: { elements: [1, 1], tronquee: false } });
  });
});
