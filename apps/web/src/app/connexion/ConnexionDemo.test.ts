import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Demo } from "../../lib/demo-connexion";

// La configuration Vitest du web n'active pas le runtime JSX automatique : les composants (.tsx)
// attendent `React` global, d'où l'import dynamique après sa mise en place.
(globalThis as { React?: unknown }).React = React;
const { EtapeChoix, EtapeComptes, EtapeSuperAdmin } = await import("./EtapesDemo");
const { Alerte } = await import("../../components/ui/Alerte");

const demo: Demo = {
  superAdmin: { email: "root@demo.test", nom: "Awa Plateforme" },
  cabinets: [
    {
      id: "c1",
      nom: "Cabinet Alpha",
      comptes: [
        {
          email: "assoc@alpha.test",
          nom: "Koffi Associé",
          roles: ["associe", "inconnu"],
          portail: false,
        },
        { email: "client@alpha.test", nom: "Cliente", roles: ["client_lecteur"], portail: true },
      ],
    },
    { id: "c2", nom: "Cabinet Beta", comptes: [] },
  ],
};

const compter = (html: string, motif: RegExp) => (html.match(motif) ?? []).length;

const choix = (d: Demo, occupe = false) =>
  renderToStaticMarkup(createElement(EtapeChoix, { demo: d, occupe }));

describe("EtapeChoix", () => {
  it("super administrateur en premier, puis un carton par cabinet", () => {
    const html = choix(demo);
    expect(html).toContain('id="titre-demo-choix"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Super administrateur");
    expect(html).toContain("Créer des cabinets et gérer leurs comptes");
    expect(html).toContain("Awa Plateforme");
    expect(html.indexOf("Super administrateur")).toBeLessThan(html.indexOf("Cabinet Alpha"));
    expect(html).toContain("2 comptes");
    expect(html).toContain("Aucun compte");
    expect(compter(html, /<button/g)).toBe(3);
  });

  it("sans super administrateur : pas de carte plateforme", () => {
    const html = choix({ ...demo, superAdmin: null });
    expect(html).not.toContain("Super administrateur");
    expect(compter(html, /<button/g)).toBe(2);
  });

  it("aucun cabinet : message d'état vide", () => {
    const html = choix({ superAdmin: null, cabinets: [] });
    expect(html).not.toContain("<button");
    expect(html).toContain("Aucun cabinet de démonstration");
  });

  it("cartes désactivées pendant une connexion", () => {
    expect(compter(choix(demo, true), /disabled=""/g)).toBe(3);
  });
});

const comptes = (over: Partial<Parameters<typeof EtapeComptes>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(EtapeComptes, {
      cabinet: demo.cabinets[0]!,
      occupe: false,
      ouverture: null,
      ...over,
    }),
  );

describe("EtapeComptes", () => {
  it("titre du cabinet, retour, deux groupes titrés, rôles et e-mails", () => {
    const html = comptes();
    expect(html).toMatch(/<h3[^>]*id="titre-demo-cabinet"[^>]*>Cabinet Alpha<\/h3>/);
    expect(html).toMatch(/<h3[^>]*tabindex="-1"/);
    expect(html).toContain("Retour");
    expect(html).toContain("<h4");
    expect(html.indexOf("Équipe du cabinet")).toBeGreaterThan(-1);
    expect(html.indexOf("Équipe du cabinet")).toBeLessThan(html.indexOf("Espace client (portail)"));
    expect(html).toContain("Koffi Associé");
    expect(html).toContain("assoc@alpha.test");
    expect(html).not.toContain("inconnu");
    expect(html).toContain('aria-labelledby="titre-demo-groupe-equipe"');
  });

  it("groupe vide omis", () => {
    const html = comptes({
      cabinet: { ...demo.cabinets[0]!, comptes: [demo.cabinets[0]!.comptes[0]!] },
    });
    expect(html).toContain("Équipe du cabinet");
    expect(html).not.toContain("Espace client (portail)");
  });

  it("cabinet sans compte : état vide", () => {
    const html = comptes({ cabinet: demo.cabinets[1]! });
    expect(html).toContain("aucun compte de démonstration");
    expect(html).not.toContain("<h4");
  });

  it("ligne en cours : indicateur, texte et aria-busy ; les autres boutons désactivés, la ligne active reste focalisable", () => {
    const html = comptes({
      occupe: true,
      ouverture: { type: "compte", email: "assoc@alpha.test" },
    });
    expect(html).toContain("Connexion en cours…");
    expect(html).toContain("mp-bouton__indicateur");
    expect(compter(html, /aria-busy="true"/g)).toBe(1);
    expect(compter(html, /disabled=""/g)).toBe(2);
    expect(compter(html, /aria-disabled="true"/g)).toBe(1);
  });
});

describe("EtapeSuperAdmin", () => {
  const rendre = (enCours = false) =>
    renderToStaticMarkup(
      createElement(EtapeSuperAdmin, { superAdmin: demo.superAdmin!, occupe: enCours, enCours }),
    );

  it("confirmation à un clic", () => {
    const html = rendre();
    expect(html).toContain("Se connecter en tant que Awa Plateforme ?");
    expect(html).toContain("Se connecter");
    expect(html).toContain("Retour");
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain("aria-busy");
  });

  it("en cours : indicateur, bouton actif non retiré du focus, Retour désactivé", () => {
    const html = rendre(true);
    expect(html).toContain("Connexion en cours…");
    expect(html).toContain('aria-busy="true"');
    expect(compter(html, /disabled=""/g)).toBe(1);
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("alerte d'erreur", () => {
  it("rôle alert, focalisable, message lisible", () => {
    const html = renderToStaticMarkup(
      createElement(
        Alerte,
        { tonalite: "danger", titre: "Connexion impossible", ref: () => {} },
        "Trop de tentatives.",
      ),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Connexion impossible");
    expect(html).toContain("Trop de tentatives.");
  });
});
