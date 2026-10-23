import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CabinetListe } from "../../../lib/plateforme";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

// Pas de runtime JSX automatique dans la configuration Vitest du web : `React` global attendu.
(globalThis as { React?: unknown }).React = React;
const { ConsoleCabinets } = await import("./ConsoleCabinets");
const { FormulaireCreationCabinet, premierChampEnErreur } =
  await import("./FormulaireCreationCabinet");
const { BoutonDeconnexionPlateforme } = await import("./BoutonDeconnexionPlateforme");
const { FormulaireConnexionPlateforme } =
  await import("../connexion/FormulaireConnexionPlateforme");

const cabinet = (o: Partial<CabinetListe>): CabinetListe => ({
  id: "c1",
  nom: "Cabinet Akwaba",
  pays: "CI",
  actif: true,
  estDemo: false,
  creeLe: "2026-10-20T10:00:00.000Z",
  nbUtilisateurs: 5,
  nbUtilisateursActifs: 4,
  ...o,
});

const rendu = (cabinets: CabinetListe[]) =>
  renderToStaticMarkup(createElement(ConsoleCabinets, { cabinets }));

describe("ConsoleCabinets", () => {
  const html = rendu([
    cabinet({}),
    cabinet({ id: "c2", nom: "Démo & Associés", estDemo: true }),
    cabinet({ id: "c3", nom: "Cabinet Dormant", actif: false }),
  ]);

  it("affiche le titre, le sous-titre et le bouton de création accessible", () => {
    expect(html).toContain("<h1");
    expect(html).toContain("Cabinets");
    expect(html).toContain("aucune donnée de mission ou de facturation");
    expect(html).toContain("Créer un cabinet");
    expect(html).not.toContain('id="formulaire-cabinet"');
  });

  it("liste les cabinets : liens, pays en clair, état en texte, utilisateurs, date", () => {
    expect(html).toContain('href="/plateforme/cabinets/c1"');
    expect(html).toMatch(/Côte d.Ivoire/);
    expect(html).toContain("Actif");
    expect(html).toContain("Désactivé");
    expect(html).toContain("5 utilisateurs, 4 actifs");
    expect(html).toContain("20 oct. 2026");
    expect(html).toContain('data-libelle="Utilisateurs"');
  });

  it("marque le cabinet de démonstration", () => {
    expect(html).toContain("Démo");
  });

  it("nomme les boutons d'action avec le cabinet", () => {
    expect(html).toContain('aria-label="Désactiver le cabinet Cabinet Akwaba"');
    expect(html).toContain('aria-label="Activer le cabinet Cabinet Dormant"');
    // Un cabinet démo se désactive comme les autres.
    expect(html).toContain('aria-label="Désactiver le cabinet Démo &amp; Associés"');
    expect(html).toContain('aria-label="Gérer les comptes du cabinet Cabinet Akwaba"');
    expect(html).toContain("Gérer les comptes");
  });

  it("liste vide : état vide avec bouton de création, sans tableau", () => {
    const vide = rendu([]);
    expect(vide).toContain("Aucun cabinet pour le moment.");
    expect(vide).toContain("Créer le premier cabinet");
    expect(vide).not.toContain("<table");
  });
});

describe("FormulaireCreationCabinet", () => {
  const html = renderToStaticMarkup(
    createElement(FormulaireCreationCabinet, {
      surCree: () => undefined,
      surAnnuler: () => undefined,
    }),
  );

  it("expose les libellés et champs attendus", () => {
    for (const libelle of [
      "Nom du cabinet",
      "Pays",
      "Premier associé",
      "Mot de passe (facultatif)",
    ]) {
      expect(html).toContain(libelle);
    }
    expect(html).toMatch(/Nom de l(&#x27;|')associé/);
    expect(html).toMatch(/Adresse e-mail de l(&#x27;|')associé/);
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Nom du cabinet/);
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toContain('id="formulaire-cabinet"');
  });

  it("mot de passe masqué par défaut, aide, bascule, pays par défaut CI", () => {
    expect(html).toContain('type="password"');
    expect(html).toContain(
      "Laissez vide pour générer un mot de passe provisoire. Sinon, au moins 12 caractères.",
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Afficher le mot de passe");
    expect(html).toMatch(/<option value="CI" selected/);
    expect(html).toContain("Créer le cabinet");
    expect(html).toContain("Annuler");
  });

  it("premierChampEnErreur suit l'ordre d'affichage", () => {
    expect(premierChampEnErreur({})).toBeUndefined();
    expect(premierChampEnErreur({ associeEmail: "x", associeNom: "y" })).toBe("associeNom");
    expect(premierChampEnErreur({ associeMotDePasse: "x", nom: "y" })).toBe("nom");
  });
});

describe("connexion et déconnexion", () => {
  it("le formulaire de connexion a ses libellés, autocomplétions et lien secondaire", () => {
    const html = renderToStaticMarkup(createElement(FormulaireConnexionPlateforme));
    expect(html).toContain("Adresse e-mail");
    expect(html).toContain("Mot de passe");
    expect(html).toContain('type="password"');
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain("Afficher le mot de passe");
    expect(html).toContain("Se connecter");
    expect(html).toContain('href="/connexion"');
    expect(html).toContain("Connexion à un cabinet");
  });

  it("le bouton de déconnexion est nommé et sans erreur initiale", () => {
    const html = renderToStaticMarkup(
      createElement(BoutonDeconnexionPlateforme, { estDemo: false }),
    );
    expect(html).toContain("Se déconnecter");
    expect(html).not.toContain('role="alert"');
  });
});
