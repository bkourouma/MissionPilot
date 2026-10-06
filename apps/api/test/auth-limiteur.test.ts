import { describe, expect, it } from "vitest";
import { creerLimiteur } from "../src/auth/limiteur.js";

/*
 * Constat F4 (audit du commit 6f28b95) : quand la table du limiteur était
 * pleine, la plus ancienne entrée était évincée, même bloquée. Un attaquant
 * vidait donc le blocage d'une cible en saturant la table d'e-mails inventés.
 */
describe("limiteur de tentatives : saturation (F4)", () => {
  const FENETRE = 60_000;

  it("une entrée bloquée n'est jamais évincée ; une nouvelle clé est refusée si toutes le sont", () => {
    let maintenant = 1_000_000;
    const l = creerLimiteur(2, FENETRE, 2, () => maintenant);
    expect(l.reserver("cible@exemple.test")).toBe(true);
    expect(l.reserver("cible@exemple.test")).toBe(true);
    expect(l.reserver("cible@exemple.test")).toBe(false); // bloquée
    expect(l.reserver("x1@exemple.test")).toBe(true);
    expect(l.reserver("x1@exemple.test")).toBe(true); // bloquée à son tour : table pleine
    // Saturation : la nouvelle clé est refusée plutôt que d'évincer une entrée bloquée.
    for (let i = 0; i < 50; i++) expect(l.reserver(`faux${i}@exemple.test`)).toBe(false);
    expect(l.reserver("cible@exemple.test")).toBe(false);
    // Fenêtre écoulée : les entrées périmées font place, la cible retrouve ses essais.
    maintenant += FENETRE;
    expect(l.reserver("nouvelle@exemple.test")).toBe(true);
    expect(l.reserver("cible@exemple.test")).toBe(true);
  });

  it("table pleine : une entrée non bloquée (la plus ancienne) fait place, la cible bloquée reste", () => {
    const maintenant = 5_000_000;
    const l = creerLimiteur(2, FENETRE, 3, () => maintenant);
    l.reserver("cible@exemple.test");
    l.reserver("cible@exemple.test");
    expect(l.reserver("cible@exemple.test")).toBe(false);
    for (let i = 0; i < 100; i++) expect(l.reserver(`faux${i}@exemple.test`)).toBe(true);
    expect(l.reserver("cible@exemple.test")).toBe(false);
  });
});
