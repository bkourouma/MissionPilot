import { describe, expect, it } from "vitest";
import {
  classeSaisie,
  iconeSaisie,
  libelleNombreEnAttente,
  MESSAGE_SAISIE,
  messageReseau,
} from "./etats";

describe("états affichés", () => {
  it("signale clairement « en attente d'envoi »", () => {
    expect(MESSAGE_SAISIE.en_attente).toMatch(/^En attente d'envoi/);
    expect(MESSAGE_SAISIE.session).toMatch(/^En attente d'envoi/);
  });

  it("réutilise les classes de style existantes", () => {
    expect(classeSaisie("en_attente")).toBe("hors_ligne");
    expect(classeSaisie("session")).toBe("hors_ligne");
    expect(classeSaisie("conflit")).toBe("refuse");
    expect(classeSaisie("a_jour")).toBe("a_jour");
    expect(iconeSaisie("conflit")).toBe("attention");
    expect(iconeSaisie("en_attente")).toBe("nuage");
    expect(iconeSaisie("modifie")).toBe("succes");
  });

  it("indicateur réseau : rien à annoncer en ligne, sauf au retour", () => {
    expect(messageReseau(true, false)).toBe("");
    expect(messageReseau(true, true)).toBe("Connexion rétablie.");
    expect(messageReseau(false, false)).toMatch(/^Hors connexion\./);
  });

  it("accorde le nombre de saisies", () => {
    expect(libelleNombreEnAttente(1)).toBe("1 saisie en attente d'envoi");
    expect(libelleNombreEnAttente(3)).toBe("3 saisies en attente d'envoi");
  });
});
