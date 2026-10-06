import { afterEach, describe, expect, it, vi } from "vitest";
import { ErreurApi, MESSAGE_RESEAU, MESSAGE_TFA_A_CONFIGURER } from "./api";
import {
  annonceImport,
  cheminImport,
  compte,
  controlerFichierImport,
  envoyerImport,
  erreurImport,
  erreursVisibles,
  ERREURS_AFFICHEES_MAX,
  ETAT_INITIAL,
  formatDe,
  IMPORT_EXCEL_MAX_OCTETS,
  lireRapport,
  peutDemanderImport,
  peutSimuler,
  preparerSource,
  questionConfirmation,
  reduireImport,
  resumeRapport,
  sourceModifiable,
  telechargerModele,
  TYPES_IMPORT,
  type ActionImport,
  type EtatImport,
  type RapportImport,
} from "./import-temps";

/** Espace fine insécable des milliers (Intl fr-FR). */
const FINE = " ";
const ENTETE = "Collaborateur;Mission;Tâche;Date;Jours";

const simulation = (r: Partial<RapportImport> = {}): RapportImport => ({
  simulation: true,
  executee: false,
  lignes_lues: 12,
  lignes_valides: 12,
  feuilles: 3,
  jours_total: 8.5,
  erreurs: [],
  avertissements: [],
  ...r,
});
const execution = (r: Partial<RapportImport> = {}) =>
  simulation({ simulation: false, executee: true, ...r });

const fichier = (nom: string, contenu: BlobPart = "x") =>
  new File([contenu], nom, { type: "application/octet-stream" });

/** Applique une suite d'actions depuis l'état initial. */
const suite = (...actions: ActionImport[]) => actions.reduce(reduireImport, ETAT_INITIAL);
const ERREUR = { titre: "T", message: "M" };

describe("contrôle local du fichier", () => {
  it("accepte un classeur .xlsx jusqu'à 2 Mio et un CSV jusqu'à 1 Mo", () => {
    expect(
      controlerFichierImport({ name: "Historique.XLSX", size: IMPORT_EXCEL_MAX_OCTETS }),
    ).toEqual({ ok: true, format: "xlsx" });
    expect(controlerFichierImport({ name: "temps.csv", size: 1_000_000 })).toEqual({
      ok: true,
      format: "csv",
    });
    expect(formatDe("archive.tar.csv")).toBe("csv");
    expect(formatDe("sans-extension")).toBeNull();
  });

  it("refuse un fichier trop gros selon son format, avec la marche à suivre", () => {
    const xlsx = controlerFichierImport({ name: "h.xlsx", size: IMPORT_EXCEL_MAX_OCTETS + 1 });
    expect(xlsx.ok).toBe(false);
    if (!xlsx.ok) {
      expect(xlsx.message).toMatch(
        /^Fichier trop volumineux \(.+\) : 2 Mo au plus pour un classeur Excel\./,
      );
      expect(xlsx.message).toMatch(/Découpez l'historique/);
    }
    const csv = controlerFichierImport({ name: "h.csv", size: 1_000_001 });
    expect(csv.ok).toBe(false);
    if (!csv.ok) expect(csv.message).toMatch(/1 Mo au plus pour un fichier CSV/);
  });

  it("refuse un fichier vide ou d'un autre format, en expliquant les formats voisins", () => {
    const vide = controlerFichierImport({ name: "h.xlsx", size: 0 });
    expect(vide).toEqual({ ok: false, message: "Ce fichier est vide : choisissez-en un autre." });
    const xls = controlerFichierImport({ name: "ancien.xls", size: 10 });
    expect(!xls.ok && xls.message).toMatch(
      /Ancien format Excel \(\.xls\).*Classeur Excel \(\.xlsx\)/,
    );
    const xlsm = controlerFichierImport({ name: "macros.xlsm", size: 10 });
    expect(!xlsm.ok && xlsm.message).toMatch(/macros/);
    for (const nom of ["photo.pdf", "sans-extension", "x.constructor", "x.__proto__"]) {
      const r = controlerFichierImport({ name: nom, size: 10 });
      expect(r).toEqual({
        ok: false,
        message:
          "Format non accepté : choisissez un classeur Excel (.xlsx) ou un fichier CSV (.csv).",
      });
    }
  });

  it("propose au choix de fichier les seuls types classeur et CSV", () => {
    expect(TYPES_IMPORT).toEqual([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ]);
  });
});

describe("source de l'import", () => {
  it("fige le classeur en mémoire et lit le CSV en texte", async () => {
    const xlsx = await preparerSource(fichier("h.xlsx", new Uint8Array([0x50, 0x4b, 3, 4])), "");
    expect(xlsx.ok).toBe(true);
    if (xlsx.ok && xlsx.source.format === "xlsx") {
      expect(new Uint8Array(await xlsx.source.contenu.arrayBuffer())).toEqual(
        new Uint8Array([0x50, 0x4b, 3, 4]),
      );
      expect(xlsx.source.contenu.type).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    }
    const csv = await preparerSource(fichier("h.csv", `${ENTETE}\nA;B;C;01/09/2026;1`), "ignoré");
    expect(csv).toEqual({
      ok: true,
      source: { format: "csv", csv: `${ENTETE}\nA;B;C;01/09/2026;1` },
    });
  });

  it("le fichier choisi prime sur le CSV collé ; sans fichier, le CSV collé est la source", async () => {
    expect(await preparerSource(null, `${ENTETE}\nA;B;C;01/09/2026;1`)).toMatchObject({
      ok: true,
      source: { format: "csv" },
    });
    expect(await preparerSource(null, "  ")).toEqual({
      ok: false,
      champ: "fichier",
      message: "Choisissez un fichier .xlsx ou .csv, ou collez le contenu d'un CSV.",
    });
    expect(await preparerSource(null, "nom;date\n")).toMatchObject({ ok: false, champ: "csv" });
  });

  it("refuse un CSV sans les colonnes attendues et un fichier illisible", async () => {
    const r = await preparerSource(fichier("h.csv", "nom;mission;date\n"), "");
    expect(r).toMatchObject({ ok: false, champ: "fichier" });
    if (!r.ok) expect(r.message).toMatch(/colonne\(s\) collaborateur, tache, jours manquante/);
    const illisible = Object.assign(new Blob(["x"]), {
      name: "h.xlsx",
      arrayBuffer: () => Promise.reject(new DOMException("modifié", "NotReadableError")),
    });
    expect(await preparerSource(illisible, "")).toMatchObject({
      ok: false,
      champ: "fichier",
      message: expect.stringMatching(/Lecture du fichier impossible/),
    });
    expect(await preparerSource(fichier("h.ods"), "")).toMatchObject({
      ok: false,
      champ: "fichier",
    });
  });

  it("vise la bonne route, simulation toujours explicite", () => {
    expect(cheminImport("xlsx", true)).toBe("/api/temps/import/excel?simulation=true");
    expect(cheminImport("xlsx", false)).toBe("/api/temps/import/excel?simulation=false");
    expect(cheminImport("csv", true)).toBe("/api/temps/import?simulation=true");
    expect(cheminImport("csv", false)).toBe("/api/temps/import?simulation=false");
  });
});

describe("rapport de l'API", () => {
  it("vérifie la forme du rapport et complète les avertissements absents", () => {
    expect(lireRapport(simulation())).toEqual(simulation());
    const sansAvertissements: Partial<RapportImport> = simulation();
    delete sansAvertissements.avertissements;
    expect(lireRapport(sansAvertissements)?.avertissements).toEqual([]);
    expect(lireRapport(null)).toBeNull();
    expect(lireRapport("<html>")).toBeNull();
    expect(lireRapport({ ...simulation(), lignes_lues: -1 })).toBeNull();
    expect(lireRapport({ ...simulation(), jours_total: Number.NaN })).toBeNull();
    expect(lireRapport({ ...simulation(), erreurs: undefined })).toBeNull();
    expect(lireRapport({ ...simulation(), erreurs: [{ ligne: "2", message: "x" }] })).toBeNull();
  });

  describe("envoi", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("envoie le CSV en JSON sur la route CSV et rend le rapport", async () => {
      const appel = vi.fn().mockResolvedValue(new Response(JSON.stringify(simulation())));
      vi.stubGlobal("fetch", appel);
      const r = await envoyerImport({ format: "csv", csv: `${ENTETE}\n` }, true);
      expect(r).toEqual(simulation());
      expect(appel).toHaveBeenCalledWith(
        "/api/temps/import?simulation=true",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ csv: `${ENTETE}\n` }) }),
      );
    });

    it("relaie l'erreur de l'API et refuse une réponse qui n'est pas un rapport", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              erreur: {
                code: "IMPORT_INVALIDE",
                message: "2 ligne(s) en erreur : rien n'a été importé.",
              },
              rapport: simulation({ simulation: false }),
            }),
            { status: 400 },
          ),
        ),
      );
      const e = await envoyerImport({ format: "csv", csv: ENTETE }, false).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErreurApi);
      expect((e as ErreurApi).code).toBe("IMPORT_INVALIDE");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
      const inattendu = await envoyerImport({ format: "csv", csv: ENTETE }, true).catch(
        (x: unknown) => x,
      );
      expect((inattendu as ErreurApi).code).toBe("REPONSE_INVALIDE");
    });
  });
});

describe("modèle Excel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("télécharge le modèle par un appel authentifié de même origine", async () => {
    const appel = vi.fn().mockResolvedValue(new Response(new Uint8Array([0x50, 0x4b])));
    vi.stubGlobal("fetch", appel);
    const blob = await telechargerModele();
    expect(blob.size).toBe(2);
    expect(appel).toHaveBeenCalledWith(
      "/api/temps/import/modele.xlsx",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("transforme un refus ou une coupure en erreur affichable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ erreur: { code: "INTERDIT", message: "x" } }), {
          status: 403,
        }),
      ),
    );
    expect(await telechargerModele().catch((e: ErreurApi) => e.statut)).toBe(403);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const e = await telechargerModele().catch((x: unknown) => x);
    expect((e as ErreurApi).message).toBe(MESSAGE_RESEAU);
  });
});

describe("étapes de l'écran", () => {
  it("parcours nominal : simulation, confirmation, exécution", () => {
    let s: EtatImport = ETAT_INITIAL;
    expect(peutSimuler(s)).toBe(true);
    expect(peutDemanderImport(s)).toBe(false);
    s = reduireImport(s, { type: "simulation_lancee" });
    expect(s.etape).toBe("simulation");
    expect(sourceModifiable(s)).toBe(false);
    s = reduireImport(s, { type: "simulation_terminee", rapport: simulation() });
    expect(s).toEqual({ etape: "simule", rapport: simulation(), erreur: null });
    expect(peutDemanderImport(s)).toBe(true);
    s = reduireImport(s, { type: "confirmation_demandee" });
    expect(s.etape).toBe("confirmation");
    s = reduireImport(s, { type: "execution_lancee" });
    expect(s.etape).toBe("execution");
    s = reduireImport(s, { type: "execution_terminee", rapport: execution() });
    expect(s).toEqual({ etape: "importe", rapport: execution(), erreur: null });
    expect(peutSimuler(s)).toBe(false);
    expect(reduireImport(s, { type: "source_modifiee" })).toEqual(ETAT_INITIAL);
  });

  it("n'exécute jamais sans simulation réussie puis confirmation", () => {
    expect(reduireImport(ETAT_INITIAL, { type: "execution_lancee" })).toBe(ETAT_INITIAL);
    expect(reduireImport(ETAT_INITIAL, { type: "confirmation_demandee" })).toBe(ETAT_INITIAL);
    const simule = suite(
      { type: "simulation_lancee" },
      { type: "simulation_terminee", rapport: simulation() },
    );
    // Sans confirmation, l'exécution est ignorée.
    expect(reduireImport(simule, { type: "execution_lancee" })).toBe(simule);
    // Simulation en erreur ou sans ligne : pas de confirmation possible.
    for (const rapport of [
      simulation({ lignes_valides: 11, erreurs: [{ ligne: 4, message: "Date invalide" }] }),
      simulation({ lignes_lues: 0, lignes_valides: 0, feuilles: 0, jours_total: 0 }),
    ]) {
      const s = suite({ type: "simulation_lancee" }, { type: "simulation_terminee", rapport });
      expect(peutDemanderImport(s)).toBe(false);
      expect(reduireImport(s, { type: "confirmation_demandee" })).toBe(s);
    }
  });

  it("annuler la confirmation revient au rapport ; changer de fichier périme la simulation", () => {
    const confirmation = suite(
      { type: "simulation_lancee" },
      { type: "simulation_terminee", rapport: simulation() },
      { type: "confirmation_demandee" },
    );
    expect(reduireImport(confirmation, { type: "confirmation_annulee" })).toMatchObject({
      etape: "simule",
      rapport: simulation(),
    });
    expect(reduireImport(confirmation, { type: "source_modifiee" })).toEqual(ETAT_INITIAL);
  });

  it("ignore les doubles envois et tout changement de source pendant un appel", () => {
    const enCours = suite({ type: "simulation_lancee" });
    expect(reduireImport(enCours, { type: "simulation_lancee" })).toBe(enCours);
    expect(reduireImport(enCours, { type: "source_modifiee" })).toBe(enCours);
    expect(reduireImport(enCours, { type: "preparation_refusee" })).toEqual(ETAT_INITIAL);
    const execution = suite(
      { type: "simulation_lancee" },
      { type: "simulation_terminee", rapport: simulation() },
      { type: "confirmation_demandee" },
      { type: "execution_lancee" },
    );
    expect(reduireImport(execution, { type: "execution_lancee" })).toBe(execution);
    expect(reduireImport(execution, { type: "confirmation_annulee" })).toBe(execution);
    expect(reduireImport(execution, { type: "source_modifiee" })).toBe(execution);
    // Réponse tardive hors de son étape : ignorée.
    expect(
      reduireImport(ETAT_INITIAL, { type: "simulation_terminee", rapport: simulation() }),
    ).toBe(ETAT_INITIAL);
    expect(reduireImport(ETAT_INITIAL, { type: "echec", erreur: ERREUR })).toBe(ETAT_INITIAL);
  });

  it("un échec, même à l'exécution, exige une nouvelle simulation", () => {
    const echecSimulation = suite({ type: "simulation_lancee" }, { type: "echec", erreur: ERREUR });
    expect(echecSimulation).toEqual({ etape: "choix", rapport: null, erreur: ERREUR });
    const echecExecution = suite(
      { type: "simulation_lancee" },
      { type: "simulation_terminee", rapport: simulation() },
      { type: "confirmation_demandee" },
      { type: "execution_lancee" },
      { type: "echec", erreur: ERREUR },
    );
    expect(echecExecution).toEqual({ etape: "choix", rapport: null, erreur: ERREUR });
    expect(peutDemanderImport(echecExecution)).toBe(false);
    // Rapport d'exécution sans import (réponse anormale) : pas de nouvel essai direct.
    const nonExecute = suite(
      { type: "simulation_lancee" },
      { type: "simulation_terminee", rapport: simulation() },
      { type: "confirmation_demandee" },
      { type: "execution_lancee" },
      { type: "execution_terminee", rapport: simulation({ simulation: false }) },
    );
    expect(nonExecute.etape).toBe("simule");
    expect(peutDemanderImport(nonExecute)).toBe(false);
  });
});

describe("messages d'erreur de l'API", () => {
  const api = (code: string, message: string, statut: number) =>
    new ErreurApi(code, message, statut);

  it("reprend les messages métier ligne par ligne ou cellule par cellule", () => {
    const e = api(
      "EXCEL_INVALIDE",
      "Classeur protégé : retirez la protection puis réessayez.",
      400,
    );
    expect(erreurImport(e, "simulation", "xlsx")).toEqual({
      titre: "Classeur Excel refusé",
      message: "Classeur protégé : retirez la protection puis réessayez.",
      rappel: "Classeur refusé par le serveur.",
    });
    const colonnes = api("REQUETE_INVALIDE", "Colonnes manquantes dans l'en-tête : jours.", 400);
    expect(erreurImport(colonnes, "simulation", "xlsx")).toEqual({
      titre: "Simulation impossible",
      message: "Colonnes manquantes dans l'en-tête : jours.",
    });
  });

  it("explique les réponses génériques 400, 403, 413 et 415", () => {
    expect(
      erreurImport(api("REQUETE_INVALIDE", "Requête invalide.", 400), "simulation", "csv").message,
    ).toMatch(/^Le serveur n'a pas pu lire le CSV/);
    expect(erreurImport(api("INTERDIT", "x", 403), "simulation", "xlsx").message).toBe(
      "Votre rôle ne vous permet pas d'importer l'historique des temps.",
    );
    const tfa = api("TFA_A_CONFIGURER", "x", 403);
    expect(erreurImport(tfa, "simulation", "xlsx").message).toBe(MESSAGE_TFA_A_CONFIGURER);
    const gros = erreurImport(
      api("FICHIER_TROP_VOLUMINEUX", "Fichier trop volumineux : 2 Mo au plus.", 413),
      "simulation",
      "xlsx",
    );
    expect(gros).toMatchObject({
      titre: "Fichier trop volumineux",
      rappel: "Fichier trop volumineux : 2 Mo au plus pour un classeur Excel.",
    });
    expect(
      erreurImport(api("REQUETE_INVALIDE", "Requête invalide.", 413), "simulation", "csv").message,
    ).toMatch(/1 Mo au plus pour un fichier CSV/);
    expect(
      erreurImport(
        api("MULTIPART_ATTENDU", "Téléversement multipart/form-data attendu.", 415),
        "simulation",
        "xlsx",
      ).message,
    ).toMatch(/^Le serveur n'a pas reconnu l'envoi du fichier/);
    expect(
      erreurImport(api("NON_AUTHENTIFIE", "Connexion requise.", 401), "simulation", "csv").message,
    ).toMatch(/session a expiré/);
  });

  it("refus d'origine, import concurrent, serveur occupé : rien d'importé, jamais « rôle » ni « inconnu »", () => {
    for (const phase of ["simulation", "execution"] as const) {
      const origine = erreurImport(
        api("ORIGINE_REFUSEE", "Requête refusée : origine non autorisée.", 403),
        phase,
        "xlsx",
      );
      expect(origine.titre).toBe(
        phase === "simulation" ? "Simulation impossible" : "Import non réalisé",
      );
      expect(origine.message).toMatch(/^Le serveur a refusé l'envoi.*Rien n'a été importé/);
      expect(origine.message).not.toMatch(/rôle/);
      const occupe = erreurImport(
        api(
          "IMPORT_EXCEL_OCCUPE",
          "Trop d'imports Excel en cours : réessayer dans quelques instants.",
          503,
        ),
        phase,
        "xlsx",
      );
      expect(occupe.titre).not.toBe("Résultat de l'import inconnu");
      expect(occupe.message).toMatch(/réessayez dans un instant/);
      expect(occupe.message).not.toMatch(/Relancez la simulation avant de réessayer/);
    }
    expect(erreurImport(api("IMPORT_EXCEL_OCCUPE", "x", 503), "execution", "xlsx").message).toMatch(
      /n'a rien importé/,
    );
    const concurrent = erreurImport(
      api(
        "IMPORT_CONCURRENT",
        "Une feuille de temps a été créée pendant l'import pour l'une de ces semaines : rien n'a été importé, relancer la simulation.",
        409,
      ),
      "execution",
      "csv",
    );
    expect(concurrent).toEqual({
      titre: "Import refusé : rien n'a été importé",
      message:
        "Une feuille de temps a été saisie pendant l'import pour l'une de ces semaines. Relancez la simulation pour voir les feuilles concernées.",
    });
    // Un autre 403 reste un refus de droits.
    expect(erreurImport(api("INTERDIT", "x", 403), "execution", "csv").message).toMatch(/rôle/);
  });

  it("à l'exécution : données changées depuis la simulation, ou résultat incertain", () => {
    const refus = erreurImport(
      api("IMPORT_INVALIDE", "2 ligne(s) en erreur : rien n'a été importé.", 400),
      "execution",
      "xlsx",
    );
    expect(refus.titre).toBe("Import refusé : rien n'a été importé");
    expect(refus.message).toMatch(/^2 ligne\(s\) en erreur.*relancez la simulation/);
    for (const e of [
      api("RESEAU_INDISPONIBLE", MESSAGE_RESEAU, 0),
      api("ERREUR_INTERNE", "Erreur interne.", 500),
      new Error("x"),
    ]) {
      const r = erreurImport(e, "execution", "csv");
      expect(r.titre).toBe("Résultat de l'import inconnu");
      expect(r.message).toMatch(/Relancez la simulation avant de réessayer/);
    }
    expect(
      erreurImport(api("RESEAU_INDISPONIBLE", MESSAGE_RESEAU, 0), "simulation", "csv"),
    ).toEqual({
      titre: "Simulation impossible",
      message: MESSAGE_RESEAU,
    });
  });
});

describe("résumé du rapport", () => {
  it("accorde les nombres en français", () => {
    expect(compte(0, "ligne lue", "lignes lues")).toBe("0 ligne lue");
    expect(compte(1, "ligne lue", "lignes lues")).toBe("1 ligne lue");
    expect(compte(1200, "ligne lue", "lignes lues")).toBe(`1${FINE}200 lignes lues`);
  });

  it("simulation réussie, en erreur, vide, puis import réalisé", () => {
    expect(resumeRapport(simulation())).toEqual({
      tonalite: "succes",
      titre: "Simulation réussie : rien n'est encore importé",
      detail:
        "12 lignes valides, 3 feuilles de temps à créer, 8,5 j au total. Vérifiez ce résumé puis lancez l'import.",
    });
    const enErreur = resumeRapport(
      simulation({
        lignes_valides: 10,
        erreurs: [
          { ligne: 4, message: "Date invalide : « 32/07/2025 »." },
          { ligne: 4, message: "Capacité dépassée." },
          { ligne: 9, message: "Jours invalides : « abc »." },
        ],
      }),
    );
    expect(enErreur.tonalite).toBe("danger");
    expect(enErreur.titre).toBe("Simulation : 2 lignes en erreur, rien ne sera importé");
    expect(enErreur.detail).toMatch(/^12 lignes lues, dont 10 valides\. L'import est tout ou rien/);
    expect(
      resumeRapport(simulation({ lignes_lues: 0, lignes_valides: 0, feuilles: 0, jours_total: 0 }))
        .titre,
    ).toBe("Aucune ligne de temps à importer");
    expect(
      resumeRapport(
        execution({
          lignes_valides: 1,
          feuilles: 1,
          jours_total: 1,
          avertissements: [{ ligne: 2, message: "Capacité" }],
        }),
      ),
    ).toEqual({
      tonalite: "succes",
      titre: "Import réalisé",
      detail:
        "1 ligne importée, 1 feuille de temps validée, 1 j au total. 1 avertissement : les lignes concernées ont été importées quand même.",
    });
  });

  it("annonce l'étape en cours et le résumé aux lecteurs d'écran", () => {
    expect(annonceImport(ETAT_INITIAL)).toBe("");
    expect(annonceImport(suite({ type: "simulation_lancee" }))).toMatch(/^Simulation en cours/);
    const simule = suite(
      { type: "simulation_lancee" },
      { type: "simulation_terminee", rapport: simulation() },
    );
    expect(annonceImport(simule)).toMatch(
      /^Simulation réussie : rien n'est encore importé\. 12 lignes valides/,
    );
    expect(annonceImport(reduireImport(simule, { type: "confirmation_demandee" }))).toBe("");
    expect(
      annonceImport(
        suite(
          { type: "simulation_lancee" },
          { type: "simulation_terminee", rapport: simulation() },
          { type: "confirmation_demandee" },
          { type: "execution_lancee" },
        ),
      ),
    ).toBe("Import en cours…");
  });

  it("formule la confirmation avec ce qui va être créé", () => {
    expect(questionConfirmation(simulation())).toBe(
      "Importer 12 lignes (3 feuilles de temps, 8,5 j) ?",
    );
    expect(
      questionConfirmation(simulation({ lignes_valides: 1, feuilles: 1, jours_total: 0.5 })),
    ).toBe("Importer 1 ligne (1 feuille de temps, 0,5 j) ?");
  });

  it("replie une longue liste d'erreurs", () => {
    const liste = Array.from({ length: ERREURS_AFFICHEES_MAX + 5 }, (_, i) => i);
    expect(erreursVisibles(liste, false)).toEqual({
      visibles: liste.slice(0, ERREURS_AFFICHEES_MAX),
      masquees: 5,
    });
    expect(erreursVisibles(liste, true)).toEqual({ visibles: liste, masquees: 0 });
    expect(erreursVisibles([1, 2], false)).toEqual({ visibles: [1, 2], masquees: 0 });
  });
});
