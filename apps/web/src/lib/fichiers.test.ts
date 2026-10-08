import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  acceptPour,
  affichableEnLigne,
  controlerFichier,
  empreinteSha256,
  erreurReprenable,
  extensionDe,
  formaterTaille,
  hrefFichier,
  libelleType,
  messageTeleversement,
  nomSansExtension,
  TAILLE_MAX_OCTETS,
  TYPES_JUSTIFICATIF,
} from "./fichiers";
import { lireReponseTeleversement } from "./televersement";

const Mo = 1024 * 1024;

describe("controlerFichier (avant envoi)", () => {
  it("accepte un fichier de la liste blanche sous 15 Mo", () => {
    expect(controlerFichier({ name: "recu-taxi.JPG", size: 2 * Mo })).toEqual({ ok: true });
    expect(controlerFichier({ name: "rapport.docx", size: 1 })).toEqual({ ok: true });
    expect(controlerFichier({ name: "x.pdf", size: TAILLE_MAX_OCTETS })).toEqual({ ok: true });
  });

  it("refuse un fichier vide ou trop volumineux, avec la taille lue", () => {
    expect(controlerFichier({ name: "x.pdf", size: 0 })).toMatchObject({ ok: false });
    const gros = controlerFichier({ name: "x.pdf", size: TAILLE_MAX_OCTETS + 1 });
    expect(gros.ok).toBe(false);
    expect(!gros.ok && gros.message).toContain("15 Mo au plus");
  });

  it("refuse une extension hors liste ou absente (exécutable, archive, HTML, SVG)", () => {
    for (const name of [
      "virus.exe",
      "archive.zip",
      "page.html",
      "logo.svg",
      "sans-extension",
      ".",
    ]) {
      const r = controlerFichier({ name, size: 10 });
      expect(r.ok, name).toBe(false);
      expect(!r.ok && r.message).toContain("Type de fichier non accepté");
    }
  });

  it("restreint aux types demandés (justificatif : photo ou PDF)", () => {
    expect(controlerFichier({ name: "notes.xlsx", size: 10 }, TYPES_JUSTIFICATIF).ok).toBe(false);
    const r = controlerFichier({ name: "notes.xlsx", size: 10 }, TYPES_JUSTIFICATIF);
    expect(!r.ok && r.message).toContain("PDF, PNG, JPG, JPEG ou WebP");
    expect(controlerFichier({ name: "recu.webp", size: 10 }, TYPES_JUSTIFICATIF).ok).toBe(true);
  });
});

describe("noms, types et tailles", () => {
  it("lit l'extension et le nom sans extension", () => {
    expect(extensionDe("Rapport.Final.PDF")).toBe("pdf");
    expect(extensionDe(".bashrc")).toBe("");
    expect(extensionDe("fin.")).toBe("");
    expect(nomSansExtension("Rapport final.pdf")).toBe("Rapport final");
    expect(nomSansExtension("sans")).toBe("sans");
  });

  it("donne un libellé français au type", () => {
    expect(libelleType("application/pdf")).toBe("PDF");
    expect(libelleType("image/jpeg")).toBe("Photo JPEG");
    expect(libelleType("application/octet-stream", "x.heic")).toBe("Fichier HEIC");
    expect(libelleType("", "")).toBe("Fichier");
  });

  it("formate une taille lisible", () => {
    expect(formaterTaille(1)).toBe("1 octet");
    expect(formaterTaille(820)).toBe("820 octets");
    expect(formaterTaille(12 * 1024)).toBe("12 Ko");
    expect(formaterTaille(1.4 * Mo)).toBe("1,4 Mo");
    expect(formaterTaille(-1)).toBe("—");
  });

  it("construit l'attribut accept et le lien authentifié", () => {
    expect(acceptPour(["application/pdf"])).toBe("application/pdf,.pdf");
    expect(hrefFichier("a b")).toBe("/api/fichiers/a%20b?affichage=attachment");
    expect(hrefFichier("id", "inline")).toBe("/api/fichiers/id?affichage=inline");
    expect(affichableEnLigne("application/pdf")).toBe(true);
    expect(affichableEnLigne("text/csv")).toBe(false);
  });
});

describe("erreurs de téléversement", () => {
  const e = (code: string, statut: number) => new ErreurApi(code, "Message serveur.", statut);

  it("traduit chaque code de l'API en message français actionnable", () => {
    expect(messageTeleversement(e("TYPE_FICHIER_REFUSE", 415))).toContain("refusé ce fichier");
    expect(messageTeleversement(e("MULTIPART_ATTENDU", 415))).toContain("mal formé");
    expect(messageTeleversement(e("FICHIER_TROP_VOLUMINEUX", 413))).toContain("15 Mo au plus");
    expect(messageTeleversement(e("QUOTA_STOCKAGE_ATTEINT", 409))).toContain("stockage du cabinet");
    expect(messageTeleversement(e("TELEVERSEMENTS_EN_ATTENTE", 409))).toContain(
      "pas encore rattachés",
    );
    expect(messageTeleversement(e("CONTENU_IDENTIQUE", 409))).toContain("identique à la version");
    expect(messageTeleversement(e("RESEAU_INDISPONIBLE", 0))).toContain("saisies sont conservées");
    expect(messageTeleversement(e("DELAI_DEPASSE", 0))).toContain("réessayez");
  });

  it("traite un 413 du relais (sans enveloppe) comme un fichier trop volumineux", () => {
    expect(messageTeleversement(e("ERREUR_INATTENDUE", 413))).toContain("trop volumineux");
  });

  it("ne propose la reprise telle quelle que pour une coupure ou une panne", () => {
    expect(erreurReprenable(e("RESEAU_INDISPONIBLE", 0))).toBe(true);
    expect(erreurReprenable(e("DELAI_DEPASSE", 0))).toBe(true);
    expect(erreurReprenable(e("SERVICE_INDISPONIBLE", 503))).toBe(true);
    expect(erreurReprenable(e("ANNULE", 0))).toBe(false);
    expect(erreurReprenable(e("TYPE_FICHIER_REFUSE", 415))).toBe(false);
    expect(erreurReprenable(new Error("x"))).toBe(false);
  });

  it("lit la réponse d'un téléversement", () => {
    expect(lireReponseTeleversement(201, '{"id":"f1"}')).toEqual({
      ok: true,
      donnees: { id: "f1" },
    });
    const refus = lireReponseTeleversement(
      415,
      '{"erreur":{"code":"TYPE_FICHIER_REFUSE","message":"Type refusé."}}',
    );
    expect(!refus.ok && refus.erreur.code).toBe("TYPE_FICHIER_REFUSE");
    const coupure = lireReponseTeleversement(0, "");
    expect(!coupure.ok && coupure.erreur.code).toBe("RESEAU_INDISPONIBLE");
    const relais = lireReponseTeleversement(413, "<html>Too large</html>");
    expect(!relais.ok && relais.erreur.statut).toBe(413);
  });
});

describe("empreinteSha256", () => {
  it("calcule l'empreinte hexadécimale du contenu", async () => {
    const h = await empreinteSha256(new TextEncoder().encode("abc").buffer as ArrayBuffer);
    expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
