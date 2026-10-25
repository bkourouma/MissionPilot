import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROLES, ROLES_CLIENT } from "@missionpilot/shared";
import type { Demo, DemoCabinet, DemoCompte } from "../../lib/demo-connexion";
import { filtreInitial, type FiltreComptesDemo } from "../../lib/demo-connexion-comptes";

// La configuration Vitest du web n'active pas le runtime JSX automatique : les composants (.tsx)
// attendent `React` global, d'où l'import dynamique après sa mise en place.
(globalThis as { React?: unknown }).React = React;
const { EtapeChoix } = await import("./EtapesDemo");
const { EtapeComptes } = await import("./EtapeComptesDemo");
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
        { email: "client@alpha.test", nom: "Cliente", roles: ["client_dirigeant"], portail: true },
      ],
    },
    { id: "c2", nom: "Cabinet Beta", comptes: [] },
  ],
};

/** Cabinet de la taille du Tenant démo : 19 comptes d'équipe sur 8 rôles, 24 comptes du portail. */
function grandCabinet(): DemoCabinet {
  const comptes: DemoCompte[] = [];
  const ajouter = (role: string, portail: boolean, n: number) => {
    for (let i = 0; i < n; i++) {
      comptes.push({
        email: `${role}.${i}@gros.test`,
        nom: `${role} ${i}`,
        roles: [role],
        portail,
      });
    }
  };
  ROLES.forEach((r, i) => ajouter(r, false, i < 3 ? 3 : 2)); // 3+3+3+2*5 = 19
  ROLES_CLIENT.forEach((r) => ajouter(r, true, 8)); // 24
  return { id: "gros", nom: "Tenant démo", comptes };
}

const compter = (html: string, motif: RegExp) => (html.match(motif) ?? []).length;

const choix = (d: Demo, occupe = false) =>
  renderToStaticMarkup(createElement(EtapeChoix, { demo: d, occupe }));

describe("EtapeChoix", () => {
  it("cabinets en premier avec nombre de comptes et mention démonstration, puis la plateforme", () => {
    const html = choix(demo);
    expect(html).toContain('id="titre-demo-choix"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Cabinets de démonstration");
    expect(html).toContain("Plateforme");
    expect(html).toContain("Super administrateur");
    expect(html).toContain("Créer des cabinets et gérer leurs comptes");
    expect(html).toContain("Awa Plateforme");
    expect(html.indexOf("Cabinet Alpha")).toBeLessThan(html.indexOf("Super administrateur"));
    expect(html).toContain("2 comptes (1 équipe, 1 client)");
    expect(html).toContain("Aucun compte");
    expect(compter(html, /Démonstration<\/span>/g)).toBe(2);
    expect(compter(html, /<button/g)).toBe(3);
  });

  it("répartition du Tenant démo lisible sur sa carte", () => {
    const html = choix({ superAdmin: null, cabinets: [grandCabinet()] });
    expect(html).toContain("43 comptes (19 équipe, 24 client)");
  });

  it("sans super administrateur : pas de carte plateforme", () => {
    const html = choix({ ...demo, superAdmin: null });
    expect(html).not.toContain("Super administrateur");
    expect(html).not.toContain("Plateforme");
    expect(compter(html, /<button/g)).toBe(2);
  });

  it("sans cabinet : seul le super administrateur est proposé", () => {
    const html = choix({ ...demo, cabinets: [] });
    expect(html).not.toContain("Cabinets de démonstration");
    expect(compter(html, /<button/g)).toBe(1);
  });

  it("aucun cabinet ni super administrateur : message d'état vide", () => {
    const html = choix({ superAdmin: null, cabinets: [] });
    expect(html).not.toContain("<button");
    expect(html).toContain("Aucun cabinet de démonstration");
  });

  it("cartes désactivées pendant une connexion", () => {
    expect(compter(choix(demo, true), /disabled=""/g)).toBe(3);
  });
});

const comptes = (over: Partial<Parameters<typeof EtapeComptes>[0]> = {}) => {
  const cabinet = over.cabinet ?? demo.cabinets[0]!;
  return renderToStaticMarkup(
    createElement(EtapeComptes, {
      cabinet,
      filtre: filtreInitial(cabinet.comptes),
      occupe: false,
      ouverture: null,
      ...over,
    }),
  );
};

describe("EtapeComptes", () => {
  it("titre du cabinet, mention démonstration, retour, espaces, rôle en titre de groupe, e-mails", () => {
    const html = comptes();
    expect(html).toMatch(/<h3[^>]*id="titre-demo-cabinet"[^>]*>Cabinet Alpha<\/h3>/);
    expect(html).toMatch(/<h3[^>]*tabindex="-1"/);
    expect(html).toContain("Démonstration");
    expect(html).toContain("Retour");
    expect(html).toContain('aria-label="Espace"');
    expect(html.indexOf("Équipe du cabinet")).toBeLessThan(html.indexOf("Espace client (portail)"));
    // Équipe sélectionnée par défaut : rôle en français, pas de rôle inconnu, e-mail visible.
    expect(html).toContain('id="titre-demo-role-associe"');
    expect(html).toContain("Koffi Associé");
    expect(html).toContain("assoc@alpha.test");
    expect(html).not.toContain("inconnu");
    expect(html).not.toContain("client@alpha.test");
    expect(compter(html, /aria-pressed="true"/g)).toBe(1);
  });

  it("espace client : comptes du portail seuls, rôle client en clair, plus de comptes d'équipe", () => {
    const portail: FiltreComptesDemo = { espace: "portail", role: null };
    const html = comptes({ filtre: portail });
    expect(html).toContain('id="titre-demo-role-client_dirigeant"');
    expect(html).toContain("Dirigeant client");
    expect(html).toContain("client@alpha.test");
    expect(html).not.toContain("assoc@alpha.test");
  });

  it("un seul espace : pas de bascule d'espace", () => {
    const html = comptes({
      cabinet: { ...demo.cabinets[0]!, comptes: [demo.cabinets[0]!.comptes[0]!] },
    });
    expect(html).not.toContain('aria-label="Espace"');
    expect(html).toContain("Koffi Associé");
  });

  it("cabinet sans compte : état vide, aucun filtre", () => {
    const html = comptes({ cabinet: demo.cabinets[1]! });
    expect(html).toContain("aucun compte de démonstration");
    expect(html).not.toContain("<h4");
    expect(html).not.toContain("aria-pressed");
  });

  it("43 comptes : 8 groupes équipe, 8 puces de rôle, comptes tous accessibles dans les 2 espaces", () => {
    const cabinet = grandCabinet();
    const equipe = comptes({ cabinet });
    expect(compter(equipe, /<h4/g)).toBe(8);
    expect(compter(equipe, /class="mp-demo__puce"/g)).toBe(8);
    expect(compter(equipe, /mp-demo__carte/g)).toBe(19);
    expect(equipe).toContain("19 comptes affichés");
    const client = comptes({ cabinet, filtre: { espace: "portail", role: null } });
    expect(compter(client, /<h4/g)).toBe(3);
    expect(compter(client, /mp-demo__carte/g)).toBe(24);
  });

  it("filtre de rôle : un seul groupe, puce enfoncée, annonce du nombre affiché", () => {
    const html = comptes({
      cabinet: grandCabinet(),
      filtre: { espace: "equipe", role: "consultant" },
    });
    expect(compter(html, /<h4/g)).toBe(1);
    expect(html).toContain('id="titre-demo-role-consultant"');
    expect(html).toContain("2 comptes affichés");
    expect(compter(html, /aria-pressed="true"/g)).toBe(2);
  });

  it("ligne en cours : indicateur, texte et aria-busy ; les autres boutons de compte désactivés, la ligne active reste focalisable", () => {
    const html = comptes({
      cabinet: grandCabinet(),
      occupe: true,
      ouverture: { type: "compte", email: "associe.0@gros.test" },
    });
    expect(html).toContain("Connexion en cours…");
    expect(html).toContain("mp-bouton__indicateur");
    expect(compter(html, /aria-busy="true"/g)).toBe(1);
    expect(compter(html, /aria-disabled="true"/g)).toBe(1);
    // 18 autres comptes + « Retour » désactivés.
    expect(compter(html, /disabled=""/g)).toBe(19);
  });
});

describe("EtapeChoix : connexion directe du super administrateur", () => {
  it("la carte est un bouton qui connecte (plus d'étape de confirmation)", () => {
    const html = choix(demo);
    expect(html).not.toContain("Se connecter en tant que");
    expect(html).not.toContain('id="titre-demo-super-admin"');
  });

  it("en cours : indicateur, texte et aria-busy sur la carte, elle reste focalisable, les autres sont désactivées", () => {
    const html = renderToStaticMarkup(
      createElement(EtapeChoix, { demo, occupe: true, ouverture: { type: "super_admin" } }),
    );
    expect(html).toContain("Connexion en cours…");
    expect(html).toContain("mp-bouton__indicateur");
    expect(compter(html, /aria-busy="true"/g)).toBe(1);
    expect(compter(html, /aria-disabled="true"/g)).toBe(1);
    expect(compter(html, /disabled=""/g)).toBe(2);
    expect(html).not.toContain("Créer des cabinets et gérer leurs comptes");
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
