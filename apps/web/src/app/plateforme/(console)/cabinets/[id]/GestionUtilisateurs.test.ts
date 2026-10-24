import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UtilisateurPlateforme } from "../../../../../lib/plateforme";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

// Runtime JSX automatique non activé dans la config Vitest : `React` global avant l'import.
(globalThis as { React?: unknown }).React = React;
const { GestionUtilisateurs } = await import("./GestionUtilisateurs");

const awa: UtilisateurPlateforme = {
  id: "u1",
  nom: "Awa Koné",
  email: "awa.kone@exemple.ci",
  roles: ["associe", "gestionnaire"],
  actif: true,
  creeLe: "2026-10-01T00:00:00Z",
};
const koffi: UtilisateurPlateforme = {
  id: "u2",
  nom: "Koffi Yao",
  email: "koffi.yao@exemple.ci",
  roles: ["consultant"],
  actif: false,
  creeLe: "2026-10-02T00:00:00Z",
};
const cabinetActif = { id: "c1", nom: "Cabinet Test", actif: true };

const rendu = (props: Partial<React.ComponentProps<typeof GestionUtilisateurs>> = {}) =>
  renderToStaticMarkup(
    createElement(GestionUtilisateurs, {
      cabinet: cabinetActif,
      utilisateurs: [awa, koffi],
      ...props,
    }),
  );

describe("GestionUtilisateurs : liste", () => {
  const html = rendu();

  it("affiche noms, e-mails et rôles en clair", () => {
    expect(html).toContain("Awa Koné");
    expect(html).toContain("awa.kone@exemple.ci");
    expect(html).toContain("Koffi Yao");
    expect(html).not.toContain(">associe<");
    expect(html).not.toContain(">gestionnaire<");
    expect(html).not.toContain(">consultant<");
  });

  it("états en texte", () => {
    expect(html).toContain("Actif");
    expect(html).toContain("Désactivé");
  });

  it("boutons nommés avec l'utilisateur", () => {
    expect(html).toContain('aria-label="Modifier les rôles de Awa Koné"');
    expect(html).toContain('aria-label="Désactiver le compte de Awa Koné"');
    expect(html).toContain('aria-label="Activer le compte de Koffi Yao"');
    expect(html).toContain("Modifier les rôles</span>");
  });

  it("pas d'alerte de cabinet désactivé ni de formulaire ouvert", () => {
    expect(html).not.toContain("Ce cabinet est désactivé");
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="formulaire-ajout-utilisateur"/);
    expect(html).not.toContain('type="password"');
  });

  it("zone de retour annoncée (vide) et titre de section en h2", () => {
    expect(html).toContain('<div role="status" aria-live="polite"></div>');
    expect(html).toContain('<h2 id="titre-utilisateurs"');
  });
});

describe("GestionUtilisateurs : états particuliers", () => {
  it("état vide explicite", () => {
    const html = rendu({ utilisateurs: [] });
    expect(html).toContain("Ce cabinet n&#x27;a encore aucun utilisateur.");
    expect(html).not.toContain("<table");
  });

  it("cabinet désactivé : alerte", () => {
    const html = rendu({ cabinet: { ...cabinetActif, actif: false } });
    expect(html).toContain(
      "Ce cabinet est désactivé : ses utilisateurs ne peuvent pas se connecter. Réactivez-le depuis la liste des cabinets.",
    );
  });
});

describe("GestionUtilisateurs : formulaire d'ajout ouvert", () => {
  const html = rendu({ ajoutOuvertInitial: true });

  it("libellés des champs", () => {
    expect(html).toContain("Nom");
    expect(html).toContain("Adresse e-mail");
    expect(html).toContain("Mot de passe provisoire (facultatif)");
    expect(html).toContain("Ajouter l&#x27;utilisateur");
  });

  it("rôles de cabinet en cases à cocher avec libellés français", () => {
    expect(html).toContain("<fieldset");
    expect(html).toMatch(/<legend[^>]*>Rôles/);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('value="associe"');
    expect(html).toContain('name="roles"');
  });

  it("mot de passe : champ password, new-password, aide, bascule", () => {
    expect(html).toContain('type="password"');
    expect(html).toMatch(/autoComplete="new-password"|autocomplete="new-password"/i);
    expect(html).toContain(
      "Laissez vide pour générer un mot de passe provisoire. Sinon, au moins 12 caractères.",
    );
    expect(html).toContain("Afficher le mot de passe");
  });

  it("bouton d'ouverture annonce l'état et le contrôlé", () => {
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-controls="formulaire-ajout-utilisateur"/);
    expect(html).not.toMatch(/<form[^>]*\shidden/);
  });
});
