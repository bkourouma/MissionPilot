import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseLocale,
  connexionRapideDemoActive,
  dossierStockage,
  loadConfig,
} from "../src/config.js";

/*
 * Constat M4 (audit du commit 6f28b95) : NODE_ENV absent donnait accès aux
 * valeurs de développement (secrets publics, cookies non sécurisés) sur
 * n'importe quelle machine. Désormais : seulement avec une base locale.
 */

const DISTANTE = {
  DATABASE_OWNER_URL: "postgres://o:x@db.exemple.test:5432/mp",
  DATABASE_URL: "postgres://a:x@db.exemple.test:5432/mp",
};

const PROD = {
  NODE_ENV: "production",
  ...DISTANTE,
  SESSION_SECRET: "un-secret-de-production-tres-long-0123",
  TFA_MASTER_KEY: "une-cle-maitre-2fa-de-production-4567",
  SMTP_HOST: "smtp.exemple.test",
  MAIL_FROM: "noreply@exemple.test",
  STORAGE_DIR: "/srv/missionpilot/stockage",
};

describe("configuration : valeurs de développement (M4)", () => {
  it("NODE_ENV absent avec une base distante : refus de démarrer, message clair", () => {
    expect(() => loadConfig({ ...DISTANTE })).toThrow(/NODE_ENV absent avec une base distante/);
    // Même si les secrets sont fournis : le repli silencieux est fermé.
    expect(() => loadConfig({ ...DISTANTE, SESSION_SECRET: PROD.SESSION_SECRET })).toThrow(
      /base distante/,
    );
  });

  it("NODE_ENV development ou test avec une base distante : refus", () => {
    expect(() => loadConfig({ NODE_ENV: "development", ...DISTANTE })).toThrow(/base distante/);
    expect(() => loadConfig({ NODE_ENV: "test", DATABASE_URL: DISTANTE.DATABASE_URL })).toThrow(
      /base distante/,
    );
  });

  it("base locale (127.0.0.1, localhost, ::1) : valeurs de développement admises", () => {
    const c = loadConfig({});
    expect(c.NODE_ENV).toBe("development");
    expect(c.TFA_MASTER_KEY).not.toBe(c.SESSION_SECRET);
    expect(
      loadConfig({
        DATABASE_URL: "postgres://missionpilot_app:x@localhost:55440/mp",
        DATABASE_OWNER_URL: "postgres://missionpilot_owner:x@[::1]:55440/mp",
      }).SESSION_SECRET,
    ).toBe(c.SESSION_SECRET);
    expect(baseLocale("postgres://a:b@127.0.0.1:5432/x")).toBe(true);
    expect(baseLocale("postgres://a:b@127.0.0.1.exemple.test:5432/x")).toBe(false);
    expect(baseLocale("pas une url")).toBe(false);
  });

  it("production : TFA_MASTER_KEY obligatoire, distincte de SESSION_SECRET, jamais la valeur de développement", () => {
    expect(loadConfig(PROD).TFA_MASTER_KEY).toBe(PROD.TFA_MASTER_KEY);
    expect(() => loadConfig({ ...PROD, TFA_MASTER_KEY: undefined })).toThrow();
    expect(() => loadConfig({ ...PROD, TFA_MASTER_KEY: "court" })).toThrow();
    expect(() => loadConfig({ ...PROD, TFA_MASTER_KEY: PROD.SESSION_SECRET })).toThrow(
      "TFA_MASTER_KEY doit différer de SESSION_SECRET.",
    );
    const dev = loadConfig({}).TFA_MASTER_KEY;
    expect(() => loadConfig({ ...PROD, TFA_MASTER_KEY: dev })).toThrow(
      "TFA_MASTER_KEY utilise une valeur de développement hors développement.",
    );
    expect(() => loadConfig({ ...PROD, TFA_MASTER_KEY_PRECEDENTE: PROD.TFA_MASTER_KEY })).toThrow(
      "TFA_MASTER_KEY_PRECEDENTE doit différer de TFA_MASTER_KEY.",
    );
  });
});

describe("configuration : connexion rapide de démonstration (sans mot de passe)", () => {
  const LOCALE = {
    DATABASE_OWNER_URL: "postgres://missionpilot_owner:x@127.0.0.1:55440/mp",
    DATABASE_URL: "postgres://missionpilot_app:x@localhost:55440/mp",
  };
  const REFUS = /CONNEXION_RAPIDE_DEMO=oui est réservé au développement local/;

  it("désactivée par défaut, y compris en développement local", () => {
    const c = loadConfig({});
    expect(c.CONNEXION_RAPIDE_DEMO).toBe("non");
    expect(connexionRapideDemoActive(c)).toBe(false);
    expect(connexionRapideDemoActive(loadConfig({ NODE_ENV: "test", ...LOCALE }))).toBe(false);
  });

  it("activée seulement par « oui » explicite, NODE_ENV local et bases locales", () => {
    for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test", ...LOCALE }]) {
      const c = loadConfig({ ...env, CONNEXION_RAPIDE_DEMO: "oui" });
      expect(connexionRapideDemoActive(c)).toBe(true);
    }
    // Valeur inconnue (casse, faute de frappe) : refus de démarrer, jamais un « oui » implicite.
    for (const valeur of ["Oui", "OUI", "1", "true", "yes"]) {
      expect(() => loadConfig({ CONNEXION_RAPIDE_DEMO: valeur })).toThrow();
    }
  });

  it("production : refus de démarrer avec « oui », même avec des bases locales", () => {
    expect(() => loadConfig({ ...PROD, CONNEXION_RAPIDE_DEMO: "oui" })).toThrow(REFUS);
    expect(() => loadConfig({ ...PROD, ...LOCALE, CONNEXION_RAPIDE_DEMO: "oui" })).toThrow(REFUS);
    // Tout autre NODE_ENV que development ou test est traité comme un serveur.
    expect(() =>
      loadConfig({ ...PROD, NODE_ENV: "staging", ...LOCALE, CONNEXION_RAPIDE_DEMO: "oui" }),
    ).toThrow(REFUS);
    // « non » explicite : la production démarre.
    expect(loadConfig({ ...PROD, CONNEXION_RAPIDE_DEMO: "non" }).CONNEXION_RAPIDE_DEMO).toBe("non");
  });

  it("base non locale : refus de démarrer avec « oui » (quel que soit NODE_ENV)", () => {
    expect(() => loadConfig({ ...DISTANTE, CONNEXION_RAPIDE_DEMO: "oui" })).toThrow(
      /base distante/,
    );
    expect(() =>
      loadConfig({ NODE_ENV: "development", ...DISTANTE, CONNEXION_RAPIDE_DEMO: "oui" }),
    ).toThrow(/base distante/);
  });

  it("configuration construite sans loadConfig : inactive hors local (garde des routes)", () => {
    const base = loadConfig({ CONNEXION_RAPIDE_DEMO: "oui" });
    expect(connexionRapideDemoActive({ ...base, NODE_ENV: "production" })).toBe(false);
    expect(connexionRapideDemoActive({ ...base, NODE_ENV: "staging" })).toBe(false);
    expect(connexionRapideDemoActive({ ...base, DATABASE_URL: DISTANTE.DATABASE_URL })).toBe(false);
    expect(
      connexionRapideDemoActive({ ...base, DATABASE_OWNER_URL: DISTANTE.DATABASE_OWNER_URL }),
    ).toBe(false);
    expect(connexionRapideDemoActive({ ...base, CONNEXION_RAPIDE_DEMO: "non" })).toBe(false);
  });
});

describe("configuration : stockage des fichiers (SOC-05)", () => {
  it("valeurs par défaut : disque, 15 Mo par fichier, 2 Go par cabinet, dossier hors dépôt", () => {
    const c = loadConfig({ NODE_ENV: "development" });
    expect(c.STORAGE_DRIVER).toBe("disque");
    expect(c.FICHIER_TAILLE_MAX_OCTETS).toBe(15 * 1024 * 1024);
    expect(c.QUOTA_STOCKAGE_CABINET_OCTETS).toBe(2 * 1024 * 1024 * 1024);
    expect(dossierStockage(c)).toBe(path.join(os.homedir(), ".missionpilot", "stockage"));
    expect(dossierStockage({ NODE_ENV: "test" })).toBe(
      path.join(os.tmpdir(), "missionpilot-stockage-test"),
    );
    expect(dossierStockage({ NODE_ENV: "test", STORAGE_DIR: PROD.STORAGE_DIR })).toBe(
      path.resolve(PROD.STORAGE_DIR),
    );
  });

  it("production : STORAGE_DIR obligatoire et absolu ; S3 pas encore disponible ; plafonds bornés", () => {
    expect(loadConfig(PROD).STORAGE_DIR).toBe(PROD.STORAGE_DIR);
    expect(() => loadConfig({ ...PROD, STORAGE_DIR: undefined })).toThrow(/STORAGE_DIR/);
    expect(() => loadConfig({ ...PROD, STORAGE_DIR: "relatif/stockage" })).toThrow(/absolu/);
    expect(() => loadConfig({ ...PROD, STORAGE_DRIVER: "s3" })).toThrow(
      /non implémenté|pas encore/,
    );
    expect(() => loadConfig({ ...PROD, FICHIER_TAILLE_MAX_OCTETS: "10" })).toThrow();
    expect(
      loadConfig({ ...PROD, QUOTA_STOCKAGE_CABINET_OCTETS: "5368709120" })
        .QUOTA_STOCKAGE_CABINET_OCTETS,
    ).toBe(5 * 1024 * 1024 * 1024);
  });
});

describe("configuration : canaux externes SIMULÉS (lot 3c, SPEC-3c §5)", () => {
  const VARIABLES = [
    ["WHATSAPP_FOURNISSEUR", "simule"],
    ["SMS_FOURNISSEUR", "simule"],
    ["TRANSCRIPTION_FOURNISSEUR", "simule"],
    ["SIGNATURE_FOURNISSEUR", "local"],
  ] as const;

  it("par défaut « aucun » partout ; aucun secret exigé", () => {
    const c = loadConfig({});
    expect(c.WHATSAPP_FOURNISSEUR).toBe("aucun");
    expect(c.SMS_FOURNISSEUR).toBe("aucun");
    expect(c.TRANSCRIPTION_FOURNISSEUR).toBe("aucun");
    expect(c.SIGNATURE_FOURNISSEUR).toBe("aucun");
  });

  it("développement local : accepté, avec le secret de développement du webhook", () => {
    for (const [variable, valeur] of VARIABLES) {
      const c = loadConfig({ [variable]: valeur });
      expect(c[variable]).toBe(valeur);
    }
    const c = loadConfig({ WHATSAPP_FOURNISSEUR: "simule" });
    expect(c.WHATSAPP_WEBHOOK_SECRET).toBe("dev-only-whatsapp-webhook-secret-0000");
  });

  it("une valeur autre que « simule » (ou « local ») est refusée : aucun fournisseur réel n'existe", () => {
    expect(() => loadConfig({ WHATSAPP_FOURNISSEUR: "meta" })).toThrow();
    expect(() => loadConfig({ SIGNATURE_FOURNISSEUR: "simule" })).toThrow();
  });

  it("production : un fournisseur simulé présenté comme réel est refusé au démarrage, pour chaque variable", () => {
    for (const [variable, valeur] of VARIABLES) {
      expect(() =>
        loadConfig({
          ...PROD,
          [variable]: valeur,
          WHATSAPP_WEBHOOK_SECRET: "un-secret-de-webhook-de-production-0123456789",
        }),
      ).toThrow(new RegExp(`${variable}=${valeur} est réservé au développement local`));
    }
    // « aucun » partout : démarrage normal, sans secret de webhook.
    expect(() => loadConfig({ ...PROD })).not.toThrow();
  });

  it("base distante hors production : refus (NODE_ENV local avec base non locale)", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "development", ...DISTANTE, WHATSAPP_FOURNISSEUR: "simule" }),
    ).toThrow(/base distante/);
  });

  it("secret du webhook : valeur de développement refusée en production, trop court, égal à un autre secret", () => {
    expect(() =>
      loadConfig({ ...PROD, WHATSAPP_WEBHOOK_SECRET: "dev-only-whatsapp-webhook-secret-0000" }),
    ).toThrow(/valeur de développement hors développement/);
    expect(() =>
      loadConfig({ WHATSAPP_FOURNISSEUR: "simule", WHATSAPP_WEBHOOK_SECRET: "trop-court" }),
    ).toThrow();
    const egal = loadConfig({}).SESSION_SECRET;
    expect(() =>
      loadConfig({ WHATSAPP_FOURNISSEUR: "simule", WHATSAPP_WEBHOOK_SECRET: egal }),
    ).toThrow(/doit différer des autres secrets/);
    expect(() =>
      loadConfig({
        WHATSAPP_FOURNISSEUR: "simule",
        WHATSAPP_WEBHOOK_SECRET: loadConfig({}).TFA_MASTER_KEY,
      }),
    ).toThrow(/doit différer/);
    const secret = "un-secret-de-webhook-local-0123456789abcdef";
    expect(() =>
      loadConfig({
        WHATSAPP_FOURNISSEUR: "simule",
        WHATSAPP_WEBHOOK_SECRET: secret,
        WHATSAPP_WEBHOOK_SECRET_PRECEDENT: secret,
      }),
    ).toThrow(/doit différer/);
    // Aucun message d'erreur ne cite la valeur d'un secret.
    try {
      loadConfig({ WHATSAPP_FOURNISSEUR: "simule", WHATSAPP_WEBHOOK_SECRET: egal });
    } catch (e) {
      expect((e as Error).message).not.toContain(egal);
    }
  });

  it("creerCanaux revérifie le contexte pour une configuration construite sans loadConfig ; « aucun » rend null", async () => {
    const { creerCanaux } = await import("../src/canaux/fabrique.js");
    const base = loadConfig({});
    expect(creerCanaux(base)).toEqual({
      whatsapp: null,
      sms: null,
      transcripteur: null,
      signature: null,
    });
    const tous = {
      ...base,
      WHATSAPP_FOURNISSEUR: "simule",
      SMS_FOURNISSEUR: "simule",
      TRANSCRIPTION_FOURNISSEUR: "simule",
      SIGNATURE_FOURNISSEUR: "local",
    } as const;
    const c = creerCanaux(tous);
    expect([c.whatsapp?.mode, c.sms?.mode, c.transcripteur?.mode, c.signature?.mode]).toEqual([
      "simule",
      "simule",
      "simule",
      "simule",
    ]);
    expect(() => creerCanaux({ ...tous, NODE_ENV: "production" })).toThrow(
      /réservé au développement local/,
    );
    expect(() => creerCanaux({ ...tous, DATABASE_URL: DISTANTE.DATABASE_URL })).toThrow(
      /réservé au développement local/,
    );
  });
});
