import { describe, expect, it } from "vitest";
import type { FastifyReply } from "fastify";
import type { Config } from "../src/config.js";
import { poserCookiePlateforme } from "../src/plateforme/session.js";
import { ALPHABET_MOT_DE_PASSE, genererMotDePasse } from "../src/plateforme/mot-de-passe.js";
import {
  connexionSchema,
  creerCabinetSchema,
  creerUtilisateurSchema,
  modifierCabinetSchema,
  modifierUtilisateurSchema,
  paramsCabinet,
  paramsUtilisateur,
} from "../src/plateforme/schemas.js";
import { traduireErreurPlateforme } from "../src/plateforme/service.js";

describe("genererMotDePasse", () => {
  it("fait au moins 20 caractères, tous issus de l'alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const mdp = genererMotDePasse();
      expect(mdp.length).toBeGreaterThanOrEqual(20);
      for (const c of mdp) expect(ALPHABET_MOT_DE_PASSE).toContain(c);
    }
  });

  it("porte une majuscule, une minuscule, un chiffre et un symbole", () => {
    for (let i = 0; i < 200; i++) {
      const mdp = genererMotDePasse();
      expect(mdp).toMatch(/[A-Z]/);
      expect(mdp).toMatch(/[a-z]/);
      expect(mdp).toMatch(/[0-9]/);
      expect(mdp).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("exclut les caractères ambigus", () => {
    expect(ALPHABET_MOT_DE_PASSE).not.toMatch(/[0O1lI]/);
  });

  it("ne se répète pas sur 1000 tirages", () => {
    const vus = new Set(Array.from({ length: 1000 }, () => genererMotDePasse()));
    expect(vus.size).toBe(1000);
  });

  it("refuse une longueur inférieure à 20", () => {
    expect(() => genererMotDePasse(19)).toThrow();
  });
});

const associe = { nom: "Awa Koné", email: "awa@cabinet.test" };

describe("schémas plateforme", () => {
  it("connexion : stricte", () => {
    expect(connexionSchema.safeParse({ email: "a@b.test", motDePasse: "x" }).success).toBe(true);
    expect(connexionSchema.safeParse({ email: "a@b.test", motDePasse: "x", z: 1 }).success).toBe(
      false,
    );
    expect(connexionSchema.safeParse({ email: "pas-un-email", motDePasse: "x" }).success).toBe(
      false,
    );
  });

  it("création de cabinet : pays par défaut CI, 2 lettres majuscules", () => {
    const ok = creerCabinetSchema.parse({ nom: "Cabinet", associe });
    expect(ok.pays).toBe("CI");
    for (const pays of ["ci", "CIV", "C", "1A"]) {
      expect(creerCabinetSchema.safeParse({ nom: "Cabinet", pays, associe }).success).toBe(false);
    }
    expect(creerCabinetSchema.safeParse({ nom: "Cabinet", pays: "SN", associe }).success).toBe(
      true,
    );
  });

  it("création de cabinet : clés inconnues, nom vide et mot de passe court refusés", () => {
    expect(creerCabinetSchema.safeParse({ nom: "C", associe, extra: 1 }).success).toBe(false);
    expect(
      creerCabinetSchema.safeParse({ nom: "C", associe: { ...associe, role: "associe" } }).success,
    ).toBe(false);
    expect(creerCabinetSchema.safeParse({ nom: " ", associe }).success).toBe(false);
    expect(
      creerCabinetSchema.safeParse({ nom: "C", associe: { ...associe, motDePasse: "court" } })
        .success,
    ).toBe(false);
    expect(
      creerCabinetSchema.safeParse({
        nom: "C",
        associe: { ...associe, motDePasse: "x".repeat(201) },
      }).success,
    ).toBe(false);
    expect(
      creerCabinetSchema.safeParse({
        nom: "C",
        associe: { ...associe, motDePasse: "x".repeat(12) },
      }).success,
    ).toBe(true);
  });

  it("modification de cabinet : au moins un champ, strict", () => {
    expect(modifierCabinetSchema.safeParse({}).success).toBe(false);
    expect(modifierCabinetSchema.safeParse({ nom: "N" }).success).toBe(true);
    expect(modifierCabinetSchema.safeParse({ actif: false }).success).toBe(true);
    expect(modifierCabinetSchema.safeParse({ actif: false, estDemo: true }).success).toBe(false);
  });

  it("création d'utilisateur : rôles du cabinet seulement, sans doublon, 1 à 8", () => {
    const base = { nom: "Moussa", email: "m@cabinet.test" };
    expect(creerUtilisateurSchema.safeParse({ ...base, roles: ["consultant"] }).success).toBe(true);
    expect(creerUtilisateurSchema.safeParse({ ...base, roles: [] }).success).toBe(false);
    expect(creerUtilisateurSchema.safeParse({ ...base, roles: ["client_dirigeant"] }).success).toBe(
      false,
    );
    expect(creerUtilisateurSchema.safeParse({ ...base, roles: ["inconnu"] }).success).toBe(false);
    expect(
      creerUtilisateurSchema.safeParse({ ...base, roles: ["consultant", "consultant"] }).success,
    ).toBe(false);
    expect(creerUtilisateurSchema.safeParse({ ...base, roles: ["consultant"], x: 1 }).success).toBe(
      false,
    );
  });

  it("modification d'utilisateur : au moins un champ, rôles validés", () => {
    expect(modifierUtilisateurSchema.safeParse({}).success).toBe(false);
    expect(modifierUtilisateurSchema.safeParse({ actif: true }).success).toBe(true);
    expect(
      modifierUtilisateurSchema.safeParse({ roles: ["associe", "chef_mission"] }).success,
    ).toBe(true);
    expect(modifierUtilisateurSchema.safeParse({ roles: ["client_investisseur"] }).success).toBe(
      false,
    );
    expect(modifierUtilisateurSchema.safeParse({ roles: [] }).success).toBe(false);
  });

  it("paramètres : UUID stricts, aucune autre clé", () => {
    const uuid = "7d3f1c2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f";
    expect(paramsCabinet.safeParse({ id: uuid }).success).toBe(true);
    expect(paramsCabinet.safeParse({ id: "1" }).success).toBe(false);
    expect(paramsCabinet.safeParse({ id: uuid, uid: uuid }).success).toBe(false);
    expect(paramsUtilisateur.safeParse({ id: uuid, uid: uuid }).success).toBe(true);
    expect(paramsUtilisateur.safeParse({ id: uuid, uid: "x" }).success).toBe(false);
  });
});

describe("traduireErreurPlateforme", () => {
  const code = (c: string) => {
    try {
      traduireErreurPlateforme({ code: c, message: "secret" });
    } catch (e) {
      return e as { statut?: number; code?: string; message: string };
    }
    return undefined;
  };

  it.each([
    ["MQP01", 401, "NON_AUTHENTIFIE"],
    ["MQP02", 404, "INTROUVABLE"],
    ["MQP03", 404, "INTROUVABLE"],
    ["MQP04", 400, "REQUETE_INVALIDE"],
    ["MQP05", 409, "DERNIER_ASSOCIE"],
    ["23505", 409, "CONFLIT"],
  ])("%s → %i %s, sans reprendre le message d'origine", (pg, statut, appCode) => {
    const e = code(pg);
    expect(e?.statut).toBe(statut);
    expect(e?.code).toBe(appCode);
    expect(e?.message).not.toContain("secret");
  });

  it("laisse passer une erreur inconnue", () => {
    expect(code("XX000")?.statut).toBeUndefined();
  });
});

describe("nom : aucun caractère de contrôle", () => {
  const associe = { nom: "Associé", email: "a@exemple.test" };
  it.each(["Cab\u0000inet", "Cab\ninet", "Cab\tinet", "Cab\u007finet", "\u001fCabinet"])(
    "refuse %j (nom de cabinet, d'associé et d'utilisateur)",
    (nom) => {
      expect(creerCabinetSchema.safeParse({ nom, associe }).success).toBe(false);
      expect(
        creerCabinetSchema.safeParse({ nom: "Cabinet", associe: { ...associe, nom } }).success,
      ).toBe(false);
      expect(
        creerUtilisateurSchema.safeParse({
          nom,
          email: "u@exemple.test",
          roles: ["consultant"],
        }).success,
      ).toBe(false);
    },
  );

  it("accepte un nom ordinaire avec accents et apostrophe", () => {
    expect(creerCabinetSchema.safeParse({ nom: "Cabinet d'Études Koné", associe }).success).toBe(
      true,
    );
  });
});

describe("cookie de session plateforme", () => {
  const poser = (nodeEnv: string | undefined) => {
    const appels: { nom: string; options: Record<string, unknown> }[] = [];
    const reply = {
      setCookie: (nom: string, _valeur: string, options: Record<string, unknown>) =>
        appels.push({ nom, options }),
    };
    poserCookiePlateforme(
      reply as unknown as FastifyReply,
      { NODE_ENV: nodeEnv } as unknown as Config,
      "jeton",
    );
    return appels[0]!;
  };

  it("est secure hors développement et test, httpOnly, SameSite lax, 8 h", () => {
    for (const env of ["production", "staging"]) {
      const c = poser(env);
      expect(c.nom).toBe("mp_plateforme");
      expect(c.options).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 3600,
      });
    }
  });

  it("n'est pas secure en développement local et en test", () => {
    for (const env of ["development", "test", undefined]) {
      expect(poser(env).options.secure).toBe(false);
    }
  });
});
