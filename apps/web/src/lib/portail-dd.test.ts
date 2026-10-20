import { describe, expect, it } from "vitest";
import { entreesPortail, peut } from "./portail";
import {
  API_DD_PORTAIL,
  cheminApiDdPortail,
  CHEMIN_DD_PORTAIL,
  conditionsDdPortail,
  etatRecommandationPortail,
  hrefDdPortail,
  hrefPieceDdPortail,
  libellePieceDdPortail,
  libellePiecesResume,
  MESSAGE_AUCUNE_NOTE,
  mentionValidation,
  piecesDdPortail,
  resumeLigneDdPortail,
} from "./portail-dd";
import { requetePage } from "./portail";

const ID = "3f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";
const PIECE = "9a8b7c6d-1111-4222-8333-444455556666";

describe("chemins du portail investisseur", () => {
  it("construit les liens de la rubrique, du détail et du téléchargement d'une pièce", () => {
    expect(CHEMIN_DD_PORTAIL).toBe("/portail/due-diligence");
    expect(hrefDdPortail(ID)).toBe(`/portail/due-diligence/${ID}`);
    expect(cheminApiDdPortail(ID)).toBe(`/api/portail/due-diligence/publications/${ID}`);
    expect(hrefPieceDdPortail(ID, PIECE)).toBe(
      `/api/portail/due-diligence/publications/${ID}/pieces/${PIECE}/fichier`,
    );
  });

  it("encode les identifiants et pagine la liste par curseur", () => {
    expect(hrefDdPortail("a/b")).toBe("/portail/due-diligence/a%2Fb");
    expect(requetePage(API_DD_PORTAIL, null)).toBe(
      "/api/portail/due-diligence/publications?limite=20",
    );
    expect(requetePage(API_DD_PORTAIL, "abc_-")).toContain("curseur=abc_-");
  });
});

describe("droits et menu du portail", () => {
  it("seul l'investisseur voit l'entrée « Due diligence »", () => {
    const ids = (r: string) => entreesPortail([r]).map((e) => e.id);
    expect(ids("client_investisseur")).toContain("due-diligence");
    expect(ids("client_dirigeant")).not.toContain("due-diligence");
    expect(ids("client_contributeur")).not.toContain("due-diligence");
    expect(peut(["client_investisseur"], "portail.dd.lire")).toBe(true);
    expect(peut(["client_dirigeant"], "portail.dd.lire")).toBe(false);
    expect(peut(["role_inconnu"], "portail.dd.lire")).toBe(false);
  });

  it("l'entrée du menu pointe vers la rubrique", () => {
    const e = entreesPortail(["client_investisseur"]).find((x) => x.id === "due-diligence");
    expect(e?.href).toBe(CHEMIN_DD_PORTAIL);
    expect(e?.libelle).toBe("Due diligence");
  });
});

describe("libellés", () => {
  it("traduit les quatre recommandations et reste neutre sur une valeur inconnue", () => {
    expect(etatRecommandationPortail("favorable")).toEqual({
      libelle: "Favorable",
      tonalite: "succes",
    });
    expect(etatRecommandationPortail("favorable_sous_conditions").libelle).toBe(
      "Favorable sous conditions",
    );
    expect(etatRecommandationPortail("reservee").libelle).toBe("Réservée");
    expect(etatRecommandationPortail("defavorable").tonalite).toBe("danger");
    expect(etatRecommandationPortail("zzz")).toEqual({
      libelle: "Recommandation à préciser",
      tonalite: "neutre",
    });
  });

  it("nomme une pièce par sa variante et son format, sans identifiant", () => {
    expect(libellePieceDdPortail({ variante: "executive", format: "pdf" })).toBe(
      "Version exécutive (PDF)",
    );
    expect(libellePieceDdPortail({ variante: "detaillee", format: "docx" })).toBe(
      "Version détaillée (Word)",
    );
  });

  it("annonce la validation par le cabinet et le nombre de pièces", () => {
    expect(mentionValidation("2026-10-05T10:00:00Z")).toMatch(
      /^Document validé par le cabinet le .*2026$/,
    );
    expect(libellePiecesResume(0)).toBe("Aucune pièce jointe");
    expect(libellePiecesResume(1)).toBe("1 pièce à télécharger");
    expect(libellePiecesResume(3)).toBe("3 pièces à télécharger");
    const l = resumeLigneDdPortail({
      valide_le: "2026-10-05T10:00:00Z",
      publie_le: "2026-10-06T10:00:00Z",
      nb_pieces: 2,
      version: 3,
    });
    expect(l).toContain("version 3");
    expect(l).toContain("2 pièces à télécharger");
  });

  it("l'état vide est la phrase attendue", () => {
    expect(MESSAGE_AUCUNE_NOTE).toBe("Aucune note ne vous a été communiquée.");
  });
});

describe("lecture défensive des réponses", () => {
  it("n'accepte que des conditions textuelles non vides", () => {
    expect(conditionsDdPortail(["A", " ", 3, "B"])).toEqual(["A", "B"]);
    expect(conditionsDdPortail(null)).toEqual([]);
    expect(conditionsDdPortail("A")).toEqual([]);
  });

  it("une réponse sans pièces valides donne une liste vide", () => {
    expect(piecesDdPortail(undefined)).toEqual([]);
    expect(piecesDdPortail([{ id: PIECE, variante: "executive", format: "pdf" }])).toHaveLength(1);
  });
});
