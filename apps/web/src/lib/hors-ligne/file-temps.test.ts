import { describe, expect, it, vi } from "vitest";
import { ErreurApi } from "../api";
import {
  abandonner,
  casesRemplies,
  classer,
  correctionPossible,
  creerRejoueur,
  decisionAuChargement,
  delaiReprise,
  estSaisie,
  libelleMotif,
  lister,
  mettreEnFile,
  nouvelleCle,
  purger,
  purgerAutresUtilisateurs,
  renvoyer,
  type Magasin,
  type NouvelleSaisie,
  type SaisieEnAttente,
  type Verrou,
} from "./file-temps";
import { magasinIndexedDb, magasinMemoire, NOM_BASE, TABLE } from "./magasins";
import { IdbSimule } from "./test/idb-simule";

const MOI = "u-moi";
const sansVerrou: Verrou = (fn) => fn();

let n = 0;
function saisie(feuilleId: string, o: Partial<NouvelleSaisie> = {}): NouvelleSaisie {
  n++;
  return {
    cle: `cle-${n}`,
    utilisateurId: MOI,
    feuilleId,
    semaine: "2026-10-05",
    unite: "demi_journee",
    creeLe: 1_000 + n,
    rangees: ["t:tache-1"],
    valeurs: { "t:tache-1|2026-10-05": "1" },
    charge: { lignes: [{ date: "2026-10-05", tache_id: "tache-1", jours: 1 }] },
    ...o,
  };
}

const reseau = () => new ErreurApi("RESEAU_INDISPONIBLE", "Connexion impossible.", 0);
const conflit = (code = "CONFLIT") => new ErreurApi(code, "Message de l'API.", 409);

/** Les deux magasins réels testés : mémoire et IndexedDB simulé. */
const magasins: [string, () => Magasin][] = [
  ["mémoire", () => magasinMemoire()],
  ["IndexedDB simulé", () => magasinIndexedDb(new IdbSimule().fabrique)],
];

describe.each(magasins)("file des saisies (%s)", (_nom, creer) => {
  it("garde une seule entrée par feuille : la dernière saisie, en fin de file", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1", { valeurs: { a: "1" } }));
    await mettreEnFile(m, saisie("f2"));
    const derniere = await mettreEnFile(m, saisie("f1", { valeurs: { a: "2" } }));
    const file = await lister(m, MOI);
    expect(file.map((e) => e.feuilleId)).toEqual(["f2", "f1"]);
    expect(file[1]).toMatchObject({ cle: derniere.cle, valeurs: { a: "2" }, etat: "en_attente" });
  });

  it("rejoue dans l'ordre de saisie et vide la file", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1"));
    await mettreEnFile(m, saisie("f2"));
    await mettreEnFile(m, saisie("f3"));
    const vus: string[] = [];
    const bilan = await creerRejoueur(sansVerrou)({
      magasin: m,
      utilisateurId: MOI,
      envoyer: async (e) => void vus.push(e.feuilleId),
    });
    expect(vus).toEqual(["f1", "f2", "f3"]);
    expect(bilan.arret).toBeNull();
    expect(bilan.envoyes.map((e) => e.feuilleId)).toEqual(["f1", "f2", "f3"]);
    expect(await lister(m, MOI)).toEqual([]);
  });

  it("s'arrête à la première coupure sans rien envoyer hors ordre, puis reprend", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1"));
    await mettreEnFile(m, saisie("f2"));
    const envoyer = vi.fn().mockRejectedValueOnce(reseau()).mockResolvedValue({});
    const rejouer = creerRejoueur(sansVerrou);
    const b1 = await rejouer({ magasin: m, utilisateurId: MOI, envoyer });
    expect(b1.arret).toBe("reseau");
    expect(envoyer).toHaveBeenCalledTimes(1);
    const file = await lister(m, MOI);
    expect(file.map((e) => [e.feuilleId, e.tentatives])).toEqual([
      ["f1", 1],
      ["f2", 0],
    ]);
    const b2 = await rejouer({ magasin: m, utilisateurId: MOI, envoyer });
    expect(b2.arret).toBeNull();
    expect(envoyer.mock.calls.map(([e]) => e.feuilleId)).toEqual(["f1", "f1", "f2"]);
    expect(await lister(m, MOI)).toEqual([]);
  });

  it("met de côté une saisie en conflit (période clôturée) sans la perdre et continue", async () => {
    const m = creer();
    const s1 = await mettreEnFile(m, saisie("f1"));
    await mettreEnFile(m, saisie("f2"));
    const envoyer = vi
      .fn()
      .mockRejectedValueOnce(conflit("PERIODE_CLOTUREE"))
      .mockResolvedValueOnce({});
    const bilan = await creerRejoueur(sansVerrou)({ magasin: m, utilisateurId: MOI, envoyer });
    expect(bilan.arret).toBeNull();
    expect(bilan.misDeCote.map((e) => e.cle)).toEqual([s1.cle]);
    const [reste] = await lister(m, MOI);
    expect(reste).toMatchObject({ cle: s1.cle, etat: "conflit" });
    expect(reste?.motif?.code).toBe("PERIODE_CLOTUREE");
    expect(reste?.valeurs).toEqual(s1.valeurs);
    expect(correctionPossible(reste?.motif)).toBe(true);
    // Une saisie de côté n'est plus rejouée sans décision.
    envoyer.mockClear();
    await creerRejoueur(sansVerrou)({ magasin: m, utilisateurId: MOI, envoyer });
    expect(envoyer).not.toHaveBeenCalled();
  });

  it("semaine validée entre-temps : conflit ; « Renvoyer » la remet en fin de file", async () => {
    const m = creer();
    const s1 = await mettreEnFile(m, saisie("f1"));
    const rejouer = creerRejoueur(sansVerrou);
    await rejouer({
      magasin: m,
      utilisateurId: MOI,
      envoyer: () => Promise.reject(conflit("CONFLIT")),
    });
    const [enConflit] = await lister(m, MOI);
    expect(enConflit?.etat).toBe("conflit");
    expect(libelleMotif(enConflit?.motif)).toMatch(/soumise ou validée entre-temps/);
    await mettreEnFile(m, saisie("f2"));
    await renvoyer(m, s1.cle);
    const file = await lister(m, MOI);
    expect(file.map((e) => [e.feuilleId, e.etat])).toEqual([
      ["f2", "en_attente"],
      ["f1", "en_attente"],
    ]);
    expect(file[1]?.motif).toBeUndefined();
  });

  it("refus de l'API (400) : mis de côté comme « refusé »", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1"));
    const bilan = await creerRejoueur(sansVerrou)({
      magasin: m,
      utilisateurId: MOI,
      envoyer: () => Promise.reject(new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400)),
    });
    expect(bilan.misDeCote[0]?.etat).toBe("refuse");
  });

  it("session expirée : arrêt, la saisie attend la reconnexion", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1"));
    const bilan = await creerRejoueur(sansVerrou)({
      magasin: m,
      utilisateurId: MOI,
      envoyer: () => Promise.reject(new ErreurApi("NON_AUTHENTIFIE", "Session expirée.", 401)),
    });
    expect(bilan.arret).toBe("session");
    expect((await lister(m, MOI))[0]?.etat).toBe("en_attente");
  });

  it("saisie illisible : gardée « à corriger », jamais envoyée", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1", { charge: null, valeurs: { x: "abc" } }));
    const envoyer = vi.fn();
    await creerRejoueur(sansVerrou)({ magasin: m, utilisateurId: MOI, envoyer });
    expect(envoyer).not.toHaveBeenCalled();
    expect((await lister(m, MOI))[0]?.etat).toBe("a_corriger");
  });

  it("idempotence : deux rejeux simultanés n'envoient chaque clé qu'une fois", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1"));
    await mettreEnFile(m, saisie("f2"));
    const cles: string[] = [];
    const rejouer = creerRejoueur(sansVerrou);
    const envoyer = async (e: SaisieEnAttente) => {
      cles.push(e.cle);
      await new Promise((r) => setTimeout(r, 5));
    };
    await Promise.all([
      rejouer({ magasin: m, utilisateurId: MOI, envoyer }),
      rejouer({ magasin: m, utilisateurId: MOI, envoyer }),
      rejouer({ magasin: m, utilisateurId: MOI, envoyer }),
    ]);
    expect(cles).toHaveLength(2);
    expect(new Set(cles).size).toBe(2);
  });

  it("une saisie faite pendant l'envoi n'est pas effacée par la confirmation et part ensuite", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1", { valeurs: { a: "1" } }));
    const rejouer = creerRejoueur(sansVerrou);
    const envoyes: string[] = [];
    let plus: SaisieEnAttente | null = null;
    const envoyer = async (e: SaisieEnAttente) => {
      envoyes.push(e.valeurs.a ?? "");
      if (!plus) plus = await mettreEnFile(m, saisie("f1", { valeurs: { a: "2" } }));
    };
    await rejouer({ magasin: m, utilisateurId: MOI, envoyer });
    expect((await lister(m, MOI)).map((e) => e.valeurs.a)).toEqual(["2"]);
    await rejouer({ magasin: m, utilisateurId: MOI, envoyer });
    expect(envoyes).toEqual(["1", "2"]);
    expect(await lister(m, MOI)).toEqual([]);
  });

  it("n'affiche ni ne rejoue les saisies d'un autre compte ; purge à la déconnexion", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1"));
    await mettreEnFile(m, saisie("f9", { utilisateurId: "u-autre" }));
    const envoyer = vi.fn().mockResolvedValue({});
    await creerRejoueur(sansVerrou)({ magasin: m, utilisateurId: "u-autre", envoyer });
    expect(envoyer.mock.calls.map(([e]) => e.feuilleId)).toEqual(["f9"]);
    await mettreEnFile(m, saisie("f8", { utilisateurId: "u-autre" }));
    await purgerAutresUtilisateurs(m, MOI);
    expect((await m.tout()).map((e) => e.utilisateurId)).toEqual([MOI]);
    await purger(m);
    expect(await m.tout()).toEqual([]);
  });

  it("abandonner retire seulement l'entrée choisie", async () => {
    const m = creer();
    const s1 = await mettreEnFile(m, saisie("f1"));
    await mettreEnFile(m, saisie("f2"));
    await abandonner(m, s1.cle);
    expect((await lister(m, MOI)).map((e) => e.feuilleId)).toEqual(["f2"]);
  });

  it("ne garde aucun jeton ni secret : seulement identifiants et valeurs", async () => {
    const m = creer();
    await mettreEnFile(m, saisie("f1"));
    const [e] = await m.tout();
    expect(Object.keys(e ?? {}).sort()).toEqual(
      [
        "charge",
        "cle",
        "creeLe",
        "etat",
        "feuilleId",
        "rangees",
        "semaine",
        "sequence",
        "tentatives",
        "unite",
        "utilisateurId",
        "valeurs",
      ].sort(),
    );
  });
});

describe("rejoueur et verrou", () => {
  it("passe par le verrou fourni (entre onglets)", async () => {
    const m = magasinMemoire();
    await mettreEnFile(m, saisie("f1"));
    let appels = 0;
    const verrou: Verrou = (fn) => {
      appels++;
      return fn();
    };
    await creerRejoueur(verrou)({ magasin: m, utilisateurId: MOI, envoyer: async () => ({}) });
    expect(appels).toBe(1);
  });

  it("une erreur du magasin ne bloque pas les rejeux suivants", async () => {
    const idb = new IdbSimule();
    const m = magasinIndexedDb(idb.fabrique);
    await mettreEnFile(m, saisie("f1"));
    idb.echouerEcritures = true;
    const rejouer = creerRejoueur(sansVerrou);
    await expect(
      rejouer({ magasin: m, utilisateurId: MOI, envoyer: async () => ({}) }),
    ).rejects.toThrow();
    idb.echouerEcritures = false;
    const b = await rejouer({ magasin: m, utilisateurId: MOI, envoyer: async () => ({}) });
    expect(b.envoyes).toHaveLength(1);
    expect(idb.lignes(NOM_BASE, TABLE)).toEqual([]);
  });
});

describe("décision à l'ouverture de la feuille", () => {
  const e = (o: Partial<SaisieEnAttente> = {}): SaisieEnAttente => ({
    ...saisie("f1", { creeLe: Date.parse("2026-10-06T10:00:00Z") }),
    sequence: 1,
    etat: "en_attente",
    tentatives: 0,
    ...o,
  });
  const avant = "2026-10-06T09:00:00Z";
  const apres = "2026-10-06T11:00:00Z";

  it("rien à faire sans saisie locale", () => {
    expect(decisionAuChargement(undefined, { modifiable: true, modifieLe: avant })).toBe("aucune");
  });
  it("restaure une saisie plus récente que le serveur", () => {
    expect(decisionAuChargement(e(), { modifiable: true, modifieLe: avant })).toBe("restaurer");
    expect(
      decisionAuChargement(e({ etat: "a_corriger" }), { modifiable: true, modifieLe: apres }),
    ).toBe("restaurer");
  });
  it("feuille soumise ou validée entre-temps : non modifiable, la saisie est gardée", () => {
    expect(decisionAuChargement(e(), { modifiable: false, modifieLe: avant })).toBe(
      "non_modifiable",
    );
  });
  it("feuille modifiée ailleurs après la saisie : décision de l'utilisateur", () => {
    expect(decisionAuChargement(e(), { modifiable: true, modifieLe: apres })).toBe(
      "modifiee_ailleurs",
    );
  });
  it("saisie déjà de côté : décision", () => {
    expect(
      decisionAuChargement(e({ etat: "conflit" }), { modifiable: true, modifieLe: avant }),
    ).toBe("decision");
  });
});

describe("outils", () => {
  it("classe les erreurs", () => {
    expect(classer(reseau())).toBe("reseau");
    expect(classer(new ErreurApi("SERVICE_INDISPONIBLE", "x", 503))).toBe("reseau");
    expect(classer(new ErreurApi("TROP", "x", 429))).toBe("reseau");
    expect(classer(new ErreurApi("NON_AUTHENTIFIE", "x", 401))).toBe("session");
    expect(classer(new ErreurApi("TFA_A_CONFIGURER", "x", 403))).toBe("session");
    expect(classer(conflit())).toBe("conflit");
    expect(classer(new ErreurApi("INTROUVABLE", "x", 404))).toBe("conflit");
    expect(classer(new ErreurApi("INTERDIT", "x", 403))).toBe("conflit");
    expect(classer(new ErreurApi("REQUETE_INVALIDE", "x", 400))).toBe("refuse");
    expect(classer(new Error("bogue"))).toBe("refuse");
  });

  it("libellés de conflit en français, message de l'API en repli", () => {
    expect(libelleMotif({ code: "PERIODE_CLOTUREE", message: "x" })).toMatch(/clôturée/);
    expect(libelleMotif({ code: "AUTRE", message: "Message de l'API." })).toBe("Message de l'API.");
    expect(libelleMotif(undefined)).toBe("");
  });

  it("génère des clés distinctes au format UUID", () => {
    const a = nouvelleCle();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(nouvelleCle()).not.toBe(a);
  });

  it("repli de clé sans crypto.randomUUID", () => {
    const origine = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      expect(nouvelleCle(() => 0.5)).toMatch(/^8{8}-8{4}-48{3}-a8{3}-8{12}$/);
    } finally {
      vi.stubGlobal("crypto", origine);
    }
  });

  it("refuse une entrée relue mal formée", () => {
    expect(estSaisie({ cle: "x" })).toBe(false);
    expect(estSaisie(null)).toBe(false);
    expect(estSaisie({ ...saisie("f1"), sequence: 1, etat: "inconnu", tentatives: 0 })).toBe(false);
    expect(estSaisie({ ...saisie("f1"), sequence: 1, etat: "en_attente", tentatives: 0 })).toBe(
      true,
    );
  });

  it("délai de reprise exponentiel plafonné", () => {
    expect(delaiReprise(0)).toBe(2_000);
    expect(delaiReprise(2)).toBe(8_000);
    expect(delaiReprise(50)).toBe(30_000);
  });

  it("liste les cases remplies par date", () => {
    expect(
      casesRemplies({
        valeurs: { "t:b|2026-10-06": "0,5", "t:a|2026-10-05": " 1 ", "t:a|2026-10-07": "" },
      }),
    ).toEqual([
      { cle: "t:a|2026-10-05", date: "2026-10-05", valeur: "1" },
      { cle: "t:b|2026-10-06", date: "2026-10-06", valeur: "0,5" },
    ]);
  });
});
