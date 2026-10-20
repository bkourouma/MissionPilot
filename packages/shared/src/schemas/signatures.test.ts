import { describe, expect, it } from "vitest";
import {
  AUTHENTIFICATIONS_PREUVE,
  AVERTISSEMENT_SIGNATURE_SIMULEE,
  LIBELLES_OBJET_SIGNATURE,
  LIBELLES_STATUT_DEMANDE_SIGNATURE,
  LIBELLES_STATUT_SIGNATAIRE,
  LIBELLES_TYPE_PREUVE_SIGNATURE,
  NIVEAU_SIGNATURE_SIMULEE,
  OBJETS_SIGNATURE,
  PLAFONDS_SIGNATURES,
  signatureAnnulationSchema,
  signatureCreationSchema,
  signatureEnvoiSchema,
  signatureParamSchema,
  signatureRefusSchema,
  signaturesPortailQuerySchema,
  signaturesQuerySchema,
  signatureSignerSchema,
  STATUTS_DEMANDE_SIGNATURE,
  STATUTS_SIGNATAIRE_SIGNATURE,
  TYPES_PREUVE_SIGNATURE,
} from "./signatures";

const UUID = "3f2c9b1e-0000-4000-8000-000000000001";
const UUID2 = "3f2c9b1e-0000-4000-8000-000000000002";
const UUID3 = "3f2c9b1e-0000-4000-8000-000000000003";

const base = {
  document_id: UUID,
  objet: "lettre_mission",
  signataires: [
    { utilisateur_id: UUID2, partie: "cabinet" },
    { utilisateur_id: UUID3, partie: "client" },
  ],
};

describe("listes et libellés", () => {
  it("un libellé français par valeur", () => {
    expect(Object.keys(LIBELLES_OBJET_SIGNATURE).sort()).toEqual([...OBJETS_SIGNATURE].sort());
    expect(Object.keys(LIBELLES_STATUT_DEMANDE_SIGNATURE).sort()).toEqual(
      [...STATUTS_DEMANDE_SIGNATURE].sort(),
    );
    expect(Object.keys(LIBELLES_STATUT_SIGNATAIRE).sort()).toEqual(
      [...STATUTS_SIGNATAIRE_SIGNATURE].sort(),
    );
    expect(Object.keys(LIBELLES_TYPE_PREUVE_SIGNATURE).sort()).toEqual(
      [...TYPES_PREUVE_SIGNATURE].sort(),
    );
    expect(AUTHENTIFICATIONS_PREUVE).toEqual(["mot_de_passe", "mot_de_passe_et_2fa"]);
  });

  it("niveau simulé et avertissement fixe : aucune valeur juridique revendiquée", () => {
    expect(NIVEAU_SIGNATURE_SIMULEE).toBe("simple_simulee");
    expect(AVERTISSEMENT_SIGNATURE_SIMULEE).toBe("Signature simulée : sans valeur juridique");
  });

  it("les plafonds reprennent la SPEC §13", () => {
    expect(PLAFONDS_SIGNATURES).toMatchObject({
      creationsPar10Min: 30,
      ouvertesParMission: 20,
      signatairesMax: 10,
      validiteJoursDefaut: 30,
      validiteJoursMin: 1,
      validiteJoursMax: 90,
    });
  });
});

describe("signatureCreationSchema", () => {
  it("valeurs par défaut : parallèle, 30 jours", () => {
    const v = signatureCreationSchema.parse(base);
    expect(v.ordre).toBe("parallele");
    expect(v.expire_jours).toBe(30);
  });

  it("validité de 1 à 90 jours", () => {
    expect(signatureCreationSchema.safeParse({ ...base, expire_jours: 1 }).success).toBe(true);
    expect(signatureCreationSchema.safeParse({ ...base, expire_jours: 90 }).success).toBe(true);
    expect(signatureCreationSchema.safeParse({ ...base, expire_jours: 0 }).success).toBe(false);
    expect(signatureCreationSchema.safeParse({ ...base, expire_jours: 91 }).success).toBe(false);
    expect(signatureCreationSchema.safeParse({ ...base, expire_jours: 1.5 }).success).toBe(false);
  });

  it("de 1 à 10 signataires distincts, parties connues", () => {
    expect(signatureCreationSchema.safeParse({ ...base, signataires: [] }).success).toBe(false);
    const onze = Array.from({ length: 11 }, (_, i) => ({
      utilisateur_id: `3f2c9b1e-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
      partie: "client",
    }));
    expect(signatureCreationSchema.safeParse({ ...base, signataires: onze }).success).toBe(false);
    expect(
      signatureCreationSchema.safeParse({ ...base, signataires: onze.slice(0, 10) }).success,
    ).toBe(true);
    expect(
      signatureCreationSchema.safeParse({
        ...base,
        signataires: [
          { utilisateur_id: UUID2, partie: "cabinet" },
          { utilisateur_id: UUID2, partie: "client" },
        ],
      }).success,
    ).toBe(false);
    expect(
      signatureCreationSchema.safeParse({
        ...base,
        signataires: [{ utilisateur_id: UUID2, partie: "tiers" }],
      }).success,
    ).toBe(false);
  });

  it("une version de budget ne se lie qu'à un avenant", () => {
    expect(
      signatureCreationSchema.safeParse({ ...base, objet: "avenant", budget_version_id: UUID })
        .success,
    ).toBe(true);
    expect(signatureCreationSchema.safeParse({ ...base, budget_version_id: UUID }).success).toBe(
      false,
    );
    expect(
      signatureCreationSchema.safeParse({
        ...base,
        objet: "proces_verbal",
        budget_version_id: UUID,
      }).success,
    ).toBe(false);
  });

  it("objet connu, document identifié, aucun champ inconnu (jamais de montant)", () => {
    expect(signatureCreationSchema.safeParse({ ...base, objet: "contrat" }).success).toBe(false);
    expect(signatureCreationSchema.safeParse({ ...base, document_id: "x" }).success).toBe(false);
    expect(signatureCreationSchema.safeParse({ ...base, montant: 100 }).success).toBe(false);
    expect(signatureCreationSchema.safeParse({ ...base, ordre: "sequentiel" }).success).toBe(true);
  });
});

describe("autres corps", () => {
  it("envoi : corps vide ; annulation et refus : motif obligatoire", () => {
    expect(signatureEnvoiSchema.safeParse({}).success).toBe(true);
    expect(signatureEnvoiSchema.safeParse({ x: 1 }).success).toBe(false);
    for (const schema of [signatureAnnulationSchema, signatureRefusSchema]) {
      expect(schema.safeParse({ motif: "Document erroné" }).success).toBe(true);
      expect(schema.safeParse({ motif: "   " }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it("signature : reconfirmation d'identité seulement (mot de passe, code OU code de secours)", () => {
    expect(
      signatureSignerSchema.safeParse({ mot_de_passe: "secret", code: "123456" }).success,
    ).toBe(true);
    expect(signatureSignerSchema.safeParse({ mot_de_passe: "secret" }).success).toBe(true);
    expect(
      signatureSignerSchema.safeParse({
        mot_de_passe: "secret",
        code: "123456",
        code_secours: "abcde-12345",
      }).success,
    ).toBe(false);
    expect(
      signatureSignerSchema.safeParse({ mot_de_passe: "secret", empreinte: "x" }).success,
    ).toBe(false);
  });

  it("paramètre et listes", () => {
    expect(signatureParamSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(signatureParamSchema.safeParse({ id: "x" }).success).toBe(false);
    expect(signaturesQuerySchema.parse({}).limite).toBe(30);
    expect(signaturesQuerySchema.safeParse({ statut: "signee", limite: "100" }).success).toBe(true);
    expect(signaturesQuerySchema.safeParse({ limite: "101" }).success).toBe(false);
    expect(signaturesQuerySchema.safeParse({ statut: "x" }).success).toBe(false);
    expect(signaturesPortailQuerySchema.safeParse({ statut: "signee" }).success).toBe(false);
  });
});
