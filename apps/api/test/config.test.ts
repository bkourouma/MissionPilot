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
