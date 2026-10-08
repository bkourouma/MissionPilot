import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "./middleware";

const requete = (chemin: string, cookie?: string) =>
  new NextRequest(new URL(chemin, "http://localhost:3100"), {
    headers: cookie ? { cookie } : {},
  });

/** Redirection posée par le middleware (`null` s'il laisse passer). */
const redirection = (chemin: string, cookie?: string) =>
  middleware(requete(chemin, cookie)).headers.get("location");

describe("middleware", () => {
  it("laisse passer /invitation sans cookie de session", () => {
    expect(redirection("/invitation")).toBeNull();
  });

  it("laisse passer /connexion sans cookie de session", () => {
    expect(redirection("/connexion")).toBeNull();
  });

  it("renvoie vers la connexion toute autre page sans cookie, avec le chemin de retour", () => {
    expect(redirection("/clients?q=sotra")).toBe(
      "http://localhost:3100/connexion?suite=%2Fclients%3Fq%3Dsotra",
    );
    expect(redirection("/")).toBe("http://localhost:3100/connexion");
  });

  it("ne confond pas une page publique avec un préfixe", () => {
    expect(redirection("/invitation-piege")).toMatch(/\/connexion\?suite=/);
    expect(redirection("/invitation/x")).toMatch(/\/connexion\?suite=/);
  });

  it("le filtre exclut /sw.js (chemin exact) mais pas les pages voisines", () => {
    const filtre = new RegExp(`^${config.matcher[0]}$`);
    expect(filtre.test("/sw.js")).toBe(false);
    expect(filtre.test("/manifest.webmanifest")).toBe(false);
    expect(filtre.test("/sw.json")).toBe(true);
    expect(filtre.test("/sw.js/x")).toBe(true);
    expect(filtre.test("/temps")).toBe(true);
  });

  it("laisse passer une page protégée quand le cookie est présent", () => {
    expect(redirection("/clients", "mp_session=abc")).toBeNull();
  });

  it("portail client : l'invitation est publique (chemin exact), le reste exige une session", () => {
    expect(redirection("/portail/invitation")).toBeNull();
    expect(redirection("/portail")).toBe("http://localhost:3100/connexion?suite=%2Fportail");
    expect(redirection("/portail/factures")).toBe(
      "http://localhost:3100/connexion?suite=%2Fportail%2Ffactures",
    );
    expect(redirection("/portail/invitation/x")).toMatch(/\/connexion\?suite=/);
    expect(redirection("/portail/missions", "mp_session=abc")).toBeNull();
  });
});
