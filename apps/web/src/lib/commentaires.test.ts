import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  actionsCommentaire,
  fusionnerCommentaires,
  insererMention,
  libelleDelaiModification,
  mentionsDuTexte,
  messageCommentaire,
  requeteCommentaires,
  requeteMention,
  secondesRestantes,
  segmentsCommentaire,
  validerTexteCommentaire,
  type Commentaire,
} from "./commentaires";

const T0 = Date.parse("2026-10-06T10:00:00Z");
const c = (p: Partial<Commentaire> = {}): Commentaire => ({
  id: "c1",
  entite_type: "mission",
  entite_id: "m1",
  auteur_id: "moi",
  auteur_nom: "Awa",
  texte: "Bonjour",
  mentions: [],
  cree_le: "2026-10-06T10:00:00Z",
  modifie_le: null,
  modifiable_jusqu_au: "2026-10-06T10:15:00Z",
  supprime: false,
  supprime_le: null,
  supprime_par: null,
  ...p,
});

describe("fenêtre de modification", () => {
  it("compte les secondes restantes, jamais négatives", () => {
    expect(secondesRestantes("2026-10-06T10:15:00Z", T0)).toBe(900);
    expect(secondesRestantes("2026-10-06T10:15:00Z", T0 + 901_000)).toBe(0);
    expect(secondesRestantes("pas une date", T0)).toBe(0);
  });

  it("affiche un compte à rebours discret", () => {
    expect(libelleDelaiModification(900)).toBe("Modifiable encore 15 min");
    expect(libelleDelaiModification(61)).toBe("Modifiable encore 2 min");
    expect(libelleDelaiModification(45)).toBe("Modifiable encore 45 s");
    expect(libelleDelaiModification(0)).toBeNull();
  });

  it("ne laisse modifier que l'auteur, dans les 15 minutes", () => {
    expect(actionsCommentaire(c(), "moi", false, T0 + 60_000).modifier).toBe(true);
    expect(actionsCommentaire(c(), "moi", false, T0 + 16 * 60_000).modifier).toBe(false);
    expect(actionsCommentaire(c(), "autre", true, T0).modifier).toBe(false);
  });

  it("laisse supprimer l'auteur ou un associé, jamais un commentaire déjà supprimé", () => {
    expect(actionsCommentaire(c(), "moi", false, T0 + 3_600_000).supprimer).toBe(true);
    expect(actionsCommentaire(c(), "autre", false, T0).supprimer).toBe(false);
    expect(actionsCommentaire(c(), "autre", true, T0).supprimer).toBe(true);
    expect(actionsCommentaire(c({ supprime: true, texte: null }), "moi", true, T0)).toEqual({
      modifier: false,
      supprimer: false,
      historique: false,
    });
  });

  it("propose l'historique d'un commentaire modifié", () => {
    expect(actionsCommentaire(c(), "x", false, T0).historique).toBe(false);
    expect(
      actionsCommentaire(c({ modifie_le: "2026-10-06T10:05:00Z" }), "x", false, T0).historique,
    ).toBe(true);
  });
});

describe("saisie", () => {
  it("valide un texte brut de 1 à 5 000 caractères", () => {
    expect(validerTexteCommentaire("  Ligne 1\nLigne 2  ")).toEqual({
      ok: true,
      charge: "Ligne 1\nLigne 2",
    });
    expect(validerTexteCommentaire("   ").ok).toBe(false);
    expect(validerTexteCommentaire("x".repeat(5001)).ok).toBe(false);
    expect(validerTexteCommentaire("a\u0007b").ok).toBe(false);
    // Le balisage reste du texte : il est accepté tel quel (et affiché échappé).
    expect(validerTexteCommentaire("<script>alert(1)</script>").ok).toBe(true);
  });

  it("explique les refus de l'API propres aux commentaires", () => {
    expect(messageCommentaire(new ErreurApi("DELAI_MODIFICATION_DEPASSE", "x", 409))).toContain(
      "15 minutes",
    );
    expect(messageCommentaire(new ErreurApi("COMMENTAIRE_FIGE", "x", 409))).toContain(
      "ne peut plus",
    );
    expect(messageCommentaire(new ErreurApi("INTROUVABLE", "x", 404))).toContain("plus accessible");
  });
});

describe("mentions", () => {
  it("repère la mention en cours avant le curseur", () => {
    expect(requeteMention("Bonjour @Ko", 11)).toEqual({ debut: 8, requete: "Ko" });
    expect(requeteMention("@", 1)).toEqual({ debut: 0, requete: "" });
    expect(requeteMention("Bonjour @Koffi Ya", 17)).toEqual({ debut: 8, requete: "Koffi Ya" });
  });

  it("ignore une adresse e-mail, un retour à la ligne ou un texte trop long", () => {
    expect(requeteMention("awa@cabinet.ci", 14)).toBeNull();
    expect(requeteMention("@Ko\nsuite", 9)).toBeNull();
    expect(requeteMention(`@${"a".repeat(41)}`, 42)).toBeNull();
    expect(requeteMention("sans arobase", 5)).toBeNull();
    expect(requeteMention("@a  b", 5)).toBeNull();
  });

  it("insère « @Nom » et place le curseur après", () => {
    const texte = "Merci @Ko pour ça";
    const r = requeteMention(texte, 9)!;
    expect(insererMention(texte, r, 9, "Koffi Yao")).toEqual({
      texte: "Merci @Koffi Yao pour ça",
      curseur: 17,
    });
  });

  it("n'envoie que les mentions encore présentes dans le texte, sans doublon", () => {
    const choisies = [
      { id: "u1", nom: "Koffi Yao" },
      { id: "u2", nom: "Awa" },
      { id: "u1", nom: "Koffi Yao" },
    ];
    expect(mentionsDuTexte("Merci @Koffi Yao", choisies)).toEqual(["u1"]);
    expect(mentionsDuTexte("@Awa et @Koffi Yao", choisies)).toEqual(["u1", "u2"]);
    expect(mentionsDuTexte("plus personne", choisies)).toEqual([]);
  });

  it("met en valeur les mentions sans produire de HTML", () => {
    const s = segmentsCommentaire("Voir @Koffi Yao et <b>@Awa</b>", [
      { id: "u1", nom: "Koffi Yao" },
      { id: "u2", nom: "Awa" },
      { id: "u3", nom: null },
    ]);
    expect(s).toEqual([
      { type: "texte", valeur: "Voir " },
      { type: "mention", valeur: "@Koffi Yao" },
      { type: "texte", valeur: " et <b>" },
      { type: "mention", valeur: "@Awa" },
      { type: "texte", valeur: "</b>" },
    ]);
    expect(segmentsCommentaire("Sans mention", [])).toEqual([
      { type: "texte", valeur: "Sans mention" },
    ]);
    expect(segmentsCommentaire("", [])).toEqual([]);
  });

  it("préfère le nom le plus long quand deux noms commencent pareil", () => {
    const s = segmentsCommentaire("@Awa Diallo", [
      { id: "1", nom: "Awa" },
      { id: "2", nom: "Awa Diallo" },
    ]);
    expect(s).toEqual([{ type: "mention", valeur: "@Awa Diallo" }]);
  });
});

describe("liste", () => {
  it("fusionne sans doublon, du plus ancien au plus récent", () => {
    const a = c({ id: "a", cree_le: "2026-10-06T10:00:00Z" });
    const b = c({ id: "b", cree_le: "2026-10-06T09:00:00Z" });
    const aModifie = { ...a, texte: "Modifié" };
    expect(fusionnerCommentaires([a], [b, aModifie]).map((x) => [x.id, x.texte])).toEqual([
      ["b", "Bonjour"],
      ["a", "Modifié"],
    ]);
  });

  it("construit la requête paginée", () => {
    expect(requeteCommentaires("facture", "f1")).toBe(
      "/api/commentaires?entite_type=facture&entite_id=f1&limite=20",
    );
    expect(requeteCommentaires("debours", "d1", "abc")).toContain("&curseur=abc");
  });
});
