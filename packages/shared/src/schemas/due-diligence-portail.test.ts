import { describe, expect, it } from "vitest";
import {
  ddPortailInvitationParamSchema,
  ddPortailInvitationSchema,
  ddPortailListeQuerySchema,
  ddPortailOptionSchema,
  ddPortailParamSchema,
  ddPortailPieceParamSchema,
  ddPortailPublicationSchema,
  PLAFONDS_DD_PORTAIL,
} from "./due-diligence-portail";

const ID = "3f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";
const ID2 = "4f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `3f2b8c1e-5d4a-4b6f-9e7d-${String(i).padStart(12, "0")}`);

describe("portail investisseur de la due diligence : schémas", () => {
  it("paramètres : identifiants uuid, aucun champ en trop", () => {
    expect(ddPortailParamSchema.safeParse({ id: ID }).success).toBe(true);
    expect(ddPortailParamSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(ddPortailParamSchema.safeParse({ id: ID, autre: 1 }).success).toBe(false);
    expect(ddPortailInvitationParamSchema.safeParse({ id: ID, utilisateurId: ID2 }).success).toBe(
      true,
    );
    expect(ddPortailPieceParamSchema.safeParse({ id: ID, pieceId: "1" }).success).toBe(false);
  });

  it("liste : limite bornée et par défaut, curseur borné", () => {
    expect(ddPortailListeQuerySchema.parse({})).toEqual({
      limite: PLAFONDS_DD_PORTAIL.liste_limite_defaut,
    });
    expect(ddPortailListeQuerySchema.parse({ limite: "5" }).limite).toBe(5);
    expect(ddPortailListeQuerySchema.safeParse({ limite: "51" }).success).toBe(false);
    expect(ddPortailListeQuerySchema.safeParse({ limite: "0" }).success).toBe(false);
    expect(ddPortailListeQuerySchema.safeParse({ curseur: "x".repeat(501) }).success).toBe(false);
    expect(ddPortailListeQuerySchema.safeParse({ tri: "titre" }).success).toBe(false);
  });

  it("option : un booléen, rien d'autre", () => {
    expect(ddPortailOptionSchema.parse({ actif: true })).toEqual({ actif: true });
    expect(ddPortailOptionSchema.safeParse({ actif: "oui" }).success).toBe(false);
    expect(ddPortailOptionSchema.safeParse({}).success).toBe(false);
    expect(ddPortailOptionSchema.safeParse({ actif: false, cabinet_id: ID }).success).toBe(false);
  });

  it("invitation : un compte, jamais de rôle ni de client reçus", () => {
    expect(ddPortailInvitationSchema.parse({ utilisateur_id: ID })).toEqual({ utilisateur_id: ID });
    expect(
      ddPortailInvitationSchema.safeParse({ utilisateur_id: ID, client_id: ID2 }).success,
    ).toBe(false);
  });

  it("publication : version, 10 rapports au plus, sans doublon ; aucun contenu de note reçu", () => {
    expect(ddPortailPublicationSchema.parse({ version: 2 })).toEqual({ version: 2, rapports: [] });
    expect(ddPortailPublicationSchema.safeParse({ version: 2, rapports: ids(10) }).success).toBe(
      true,
    );
    expect(ddPortailPublicationSchema.safeParse({ version: 2, rapports: ids(11) }).success).toBe(
      false,
    );
    expect(ddPortailPublicationSchema.safeParse({ version: 2, rapports: [ID, ID] }).success).toBe(
      false,
    );
    expect(ddPortailPublicationSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(ddPortailPublicationSchema.safeParse({ version: 201 }).success).toBe(false);
    for (const champ of ["titre", "synthese", "recommandation", "conditions", "client_id"]) {
      expect(
        ddPortailPublicationSchema.safeParse({ version: 2, [champ]: "x" }).success,
        champ,
      ).toBe(false);
    }
  });
});
