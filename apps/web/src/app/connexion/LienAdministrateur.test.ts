import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Runtime JSX automatique absent de la configuration Vitest : `React` global avant l'import.
(globalThis as { React?: unknown }).React = React;
const { LienAdministrateur } = await import("./LienAdministrateur");

describe("LienAdministrateur", () => {
  it("renvoie vers la connexion de la plateforme, avec un libellé français", () => {
    const html = renderToStaticMarkup(createElement(LienAdministrateur));
    expect(html).toContain('href="/plateforme/connexion"');
    expect(html).toContain("Accès administrateur de la plateforme");
  });
});
