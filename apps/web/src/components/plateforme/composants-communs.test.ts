import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// La configuration Vitest du web n'active pas le runtime JSX automatique : les composants (.tsx)
// attendent `React` global, d'où l'import dynamique après sa mise en place.
(globalThis as { React?: unknown }).React = React;
const { MotDePasseGenere } = await import("./MotDePasseGenere");
const { ConfirmationAction } = await import("./ConfirmationAction");

/** Balise ouvrante du bouton dont le libellé (dans son span) est donné. */
function balise(html: string, libelle: string): string {
  const segment = html
    .split("<button")
    .slice(1)
    .find((s) => s.includes(`>${libelle}</span>`));
  return segment ? `<button${segment.split(">")[0]}` : "";
}

describe("MotDePasseGenere", () => {
  const html = renderToStaticMarkup(
    createElement(MotDePasseGenere, {
      motDePasse: "Provisoire-Genere-42",
      compte: "Compte de Awa Koné (awa@exemple.ci)",
      surTermine: () => undefined,
    }),
  );

  it("affiche le mot de passe dans un champ en lecture seule", () => {
    const champ = html.match(/<input[^>]*>/)?.[0] ?? "";
    expect(champ).toContain('value="Provisoire-Genere-42"');
    expect(champ).toContain('readOnly=""');
    expect(champ).toContain('id="mdp-genere-valeur"');
  });

  it("rappelle que le mot de passe ne sera plus jamais affiché, et le compte concerné", () => {
    expect(html).toContain("<strong>plus jamais affiché</strong>");
    expect(html).toContain("Compte de Awa Koné (awa@exemple.ci)");
  });

  it("annonce le message en role alert avec le titre à noter", () => {
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Mot de passe provisoire : à noter maintenant");
  });

  it("propose le bouton Copier", () => {
    expect(html).toContain("<span>Copier</span>");
    expect(balise(html, "Copier")).toContain('type="button"');
  });

  it("propose le bouton « J'ai noté le mot de passe » (apostrophe échappée)", () => {
    expect(html).toMatch(/J(&#x27;|')ai noté le mot de passe/);
  });

  it("la section est nommée par son titre", () => {
    expect(html).toContain('aria-labelledby="titre-mdp-genere"');
    expect(html).toContain('id="titre-mdp-genere"');
  });
});

describe("ConfirmationAction", () => {
  const rendu = (props: Partial<Parameters<typeof ConfirmationAction>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ConfirmationAction, {
        titre: "Désactiver le cabinet ?",
        libelleConfirmer: "Désactiver",
        surConfirmer: () => undefined,
        surAnnuler: () => undefined,
        children: "Les associés ne pourront plus se connecter.",
        ...props,
      }),
    );

  it("groupe nommé par son titre (role group + aria-labelledby)", () => {
    const html = rendu();
    expect(html).toMatch(/<div[^>]*role="group"/);
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(
      `<p id="${id}" class="mp-confirmation-plateforme__titre">Désactiver le cabinet ?</p>`,
    );
  });

  it("affiche les conséquences fournies en enfants", () => {
    expect(rendu()).toContain("Les associés ne pourront plus se connecter.");
  });

  it("boutons Confirmer et Annuler présents", () => {
    const html = rendu();
    expect(html).toContain("<span>Désactiver</span>");
    expect(html).toContain("<span>Annuler</span>");
  });

  it("variante par défaut : confirmation primaire, sans variante danger", () => {
    const html = rendu();
    expect(balise(html, "Désactiver")).toContain("mp-bouton--primaire");
    expect(html).not.toContain("mp-bouton--danger");
    expect(balise(html, "Annuler")).toContain("mp-bouton--secondaire");
  });

  it("variante danger : confirmation rouge", () => {
    const html = rendu({ danger: true });
    expect(balise(html, "Désactiver")).toContain("mp-bouton--danger");
    expect(balise(html, "Désactiver")).not.toContain("mp-bouton--primaire");
  });

  it("sans erreur : aucune alerte ; avec erreur : alerte danger affichant le message", () => {
    expect(rendu()).not.toContain("Action impossible");
    expect(rendu({ erreur: null })).not.toContain("Action impossible");

    const html = rendu({ erreur: "Le cabinet a déjà été désactivé." });
    expect(html).toContain("Action impossible");
    expect(html).toContain("Le cabinet a déjà été désactivé.");
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("mp-alerte--danger");
  });

  it("enCours : Annuler désactivé, confirmation en chargement avec son texte", () => {
    const html = rendu({ enCours: true });
    expect(balise(html, "Annuler")).toContain('disabled=""');
    const confirmer = balise(html, "Enregistrement…");
    expect(confirmer).toContain('disabled=""');
    expect(confirmer).toContain('aria-busy="true"');
    expect(html).not.toContain("<span>Désactiver</span>");
  });

  it("hors chargement : Annuler actif, aucun aria-busy", () => {
    const html = rendu();
    expect(balise(html, "Annuler")).not.toContain("disabled");
    expect(html).not.toContain("aria-busy");
  });
});
