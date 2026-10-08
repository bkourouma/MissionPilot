import { describe, expect, it } from "vitest";
import {
  portailClientQuerySchema,
  portailInvitationCreationSchema,
  portailListeQuerySchema,
  portailParametresModificationSchema,
  portailPartagesSchema,
  portailValidationJalonSchema,
} from "./portail";

const UUID = "7b0e2f0a-1c4d-4e5f-8a9b-0c1d2e3f4a5b";
const UUID2 = "8c1f3a1b-2d5e-4f60-9bac-1d2e3f4a5b6c";

describe("schémas du portail client (SOC-09)", () => {
  it("invitation : rôles client seulement, dédoublonnés, e-mail normalisé", () => {
    const v = portailInvitationCreationSchema.parse({
      email: " DG@Client.TEST ",
      client_id: UUID,
      roles: ["client_dirigeant", "client_dirigeant"],
    });
    expect(v).toEqual({ email: "dg@client.test", client_id: UUID, roles: ["client_dirigeant"] });
    for (const role of ["associe", "chef_mission", "gestionnaire", "admin"]) {
      expect(
        portailInvitationCreationSchema.safeParse({
          email: "a@b.test",
          client_id: UUID,
          roles: [role],
        }).success,
      ).toBe(false);
    }
    expect(
      portailInvitationCreationSchema.safeParse({ email: "a@b.test", client_id: UUID, roles: [] })
        .success,
    ).toBe(false);
    expect(
      portailInvitationCreationSchema.safeParse({
        email: "a@b.test",
        client_id: UUID,
        roles: ["client_dirigeant"],
        cabinet_id: UUID2,
      }).success,
    ).toBe(false);
  });

  it("partages : remplacement complet, valeurs par défaut fermées, doublons refusés", () => {
    const v = portailPartagesSchema.parse({
      missions: [{ mission_id: UUID }],
      documents: [UUID2, UUID2],
    });
    expect(v.missions).toEqual([{ mission_id: UUID, jalons: false, factures: false }]);
    expect(v.documents).toEqual([UUID2]);
    expect(
      portailPartagesSchema.safeParse({
        missions: [{ mission_id: UUID }, { mission_id: UUID, jalons: true }],
        documents: [],
      }).success,
    ).toBe(false);
    expect(
      portailPartagesSchema.safeParse({
        missions: [{ mission_id: UUID, budget: true }],
        documents: [],
      }).success,
    ).toBe(false);
    expect(portailPartagesSchema.safeParse({ missions: [], documents: ["x"] }).success).toBe(false);
  });

  it("requêtes et validation de jalon strictes", () => {
    expect(portailClientQuerySchema.safeParse({ client_id: "1" }).success).toBe(false);
    expect(portailListeQuerySchema.parse({}).limite).toBe(50);
    expect(portailListeQuerySchema.safeParse({ limite: "1000" }).success).toBe(false);
    expect(portailValidationJalonSchema.parse({ commentaire: "  " }).commentaire).toBeNull();
    expect(portailValidationJalonSchema.safeParse({ atteint: true }).success).toBe(false);
  });

  it("politique du portail : un seul second facteur", () => {
    expect(
      portailParametresModificationSchema.safeParse({
        tfa_obligatoire: true,
        mot_de_passe: "x",
        code: "123456",
        code_secours: "abcde-fghjk",
      }).success,
    ).toBe(false);
    expect(
      portailParametresModificationSchema.safeParse({ tfa_obligatoire: true, mot_de_passe: "x" })
        .success,
    ).toBe(true);
  });
});
