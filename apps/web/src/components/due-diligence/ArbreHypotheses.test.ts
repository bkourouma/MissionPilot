import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { construireArbre, type NoeudHypothese } from "../../lib/due-diligence";

// La configuration Vitest du web n'active pas le runtime JSX automatique : le composant (.tsx)
// attend `React` global, d'où l'import dynamique après sa mise en place.
(globalThis as { React?: unknown }).React = React;
const { ArbreHypotheses } = await import("./ArbreHypotheses");

const noeud = (id: string, parent: string | null, conflit = false): NoeudHypothese =>
  ({
    id,
    parent_id: parent,
    version: 1,
    libelle: `Hypothèse ${id}`,
    description: null,
    critere: null,
    liens: [],
    indication: { indication: "non_concluante", conflit },
    verdict_en_vigueur: null,
    verdict_en_attente: null,
  }) as unknown as NoeudHypothese;

const arbre = construireArbre([
  noeud("h1", null),
  noeud("h2", "h1", true),
  noeud("h3", "h2"),
  noeud("h4", null),
]);

const rendu = (selectionId?: string) =>
  renderToStaticMarkup(
    createElement(ArbreHypotheses, { missionId: "m1", dossierId: "d1", arbre, selectionId }),
  );

describe("ArbreHypotheses : attributs ARIA", () => {
  const html = rendu();

  it("conteneur tree nommé, groupes nommés, li neutres", () => {
    expect(html).toMatch(/<ul[^>]*role="tree"[^>]*aria-label="Arbre des hypothèses"/);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Sous-hypothèses de Hypothèse h1"');
    expect(html.match(/<li role="none"/g)).toHaveLength(4);
    expect((html.match(/role="treeitem"/g) ?? []).length).toBe(4);
  });

  it("chaque nœud a son niveau ; aria-expanded seulement s'il a des enfants", () => {
    const items = html.match(/<a [^>]*role="treeitem"[^>]*>/g) ?? [];
    const de = (id: string) => items.find((i) => i.includes(`data-noeud-id="${id}"`)) ?? "";
    expect(de("h1")).toContain('aria-level="1"');
    expect(de("h1")).toContain('aria-expanded="true"');
    expect(de("h2")).toContain('aria-level="2"');
    expect(de("h2")).toContain('aria-expanded="true"');
    expect(de("h3")).toContain('aria-level="3"');
    expect(de("h3")).not.toContain("aria-expanded");
    expect(de("h4")).toContain('aria-level="1"');
    expect(de("h4")).not.toContain("aria-expanded");
  });

  it("un seul élément dans l'ordre de tabulation (le premier), aria-selected seulement avec une sélection", () => {
    const items = html.match(/<a [^>]*role="treeitem"[^>]*>/g) ?? [];
    expect(items.filter((i) => i.includes('tabindex="0"'))).toHaveLength(1);
    expect(items[0]).toContain('tabindex="0"');
    expect(html).not.toContain("aria-selected");
    const avecSelection = rendu("h3");
    const h3 = (avecSelection.match(/<a [^>]*role="treeitem"[^>]*>/g) ?? []).find((a) =>
      a.includes('data-noeud-id="h3"'),
    );
    expect(h3).toContain('aria-selected="true"');
    expect((avecSelection.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((avecSelection.match(/aria-selected="false"/g) ?? []).length).toBe(3);
  });

  it("les badges décrivent le nœud (aria-describedby) ; le conflit s'y ajoute", () => {
    const items = html.match(/<a [^>]*role="treeitem"[^>]*>/g) ?? [];
    const h2 = items.find((i) => i.includes('data-noeud-id="h2"')) ?? "";
    const h1 = items.find((i) => i.includes('data-noeud-id="h1"')) ?? "";
    expect(h2.match(/aria-describedby="([^"]+)"/)?.[1]?.split(" ")).toHaveLength(2);
    expect(h1.match(/aria-describedby="([^"]+)"/)?.[1]?.split(" ")).toHaveLength(1);
  });
});
