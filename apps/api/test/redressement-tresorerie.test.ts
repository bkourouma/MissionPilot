import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import {
  erreur,
  INCONNU,
  ouvrirDossierRed,
  preparerRed,
  type ScenarioRed,
} from "./redressement-outils.js";

/*
 * Trésorerie à 13 semaines et point mort (routes 18 à 22) : cas T1, T2, T3 de SPEC-3a §6.6 PAR
 * L'API (prévision seule, réalisé sans puis avec solde constaté), contiguïté (409), corrections
 * (12e ligne : 409), fenêtre glissante, import des échéances d'accords, point mort T8, plafond de
 * débit (429). Tous les chiffres sortent du moteur.
 */

let ctx: Contexte;
let s: ScenarioRed;
let dossierId: string;

const M = 1_000_000;
const DEBUT = "2026-10-12";
const urlD = (suffixe: string, id = dossierId) => `/api/redressement/dossiers/${id}${suffixe}`;

const ligne = (semaine: number, sens: string, categorie: string, montant: number) => ({
  semaine,
  sens,
  categorie,
  montant,
});

/** Lignes des cas T1 à T3 : S1 +30 −40 −25 ; S2 +20 −30 ; S3 +15 −35 (millions). */
const LIGNES = [
  ligne(1, "encaissement", "clients", 30 * M),
  ligne(1, "decaissement", "fournisseurs", 40 * M),
  ligne(1, "decaissement", "salaires", 25 * M),
  ligne(2, "encaissement", "clients", 20 * M),
  ligne(2, "decaissement", "fournisseurs", 30 * M),
  ligne(3, "encaissement", "clients", 15 * M),
  ligne(3, "decaissement", "fournisseurs", 35 * M),
];

const version = (extra: Record<string, unknown> = {}) => ({
  date_debut: DEBUT,
  solde_initial: 50 * M,
  seuil_tension: 10 * M,
  lignes: LIGNES,
  motif: "Prévision initiale",
  ...extra,
});

const realise = (semaineDebut: string, extra: Record<string, unknown> = {}) => ({
  semaine_debut: semaineDebut,
  flux: {
    encaissement: { clients: 28 * M },
    decaissement: { fournisseurs: 41 * M, salaires: 25 * M },
  },
  ...extra,
});

beforeAll(async () => {
  ctx = await demarrer();
  s = await preparerRed(ctx, "RED tresorerie");
  dossierId = (await ouvrirDossierRed(s)).id;
}, 120_000);

afterAll(async () => {
  await ctx.fermer();
});

describe("accès (routes 18 à 22)", () => {
  it("401, 403, 404, autre cabinet pour chaque route", async () => {
    const appels: [string, () => Promise<{ statusCode: number }>, "lecture" | "ecriture"][] = [];
    const defs = [
      ["GET", urlD("/tresorerie"), undefined, "lecture"],
      ["POST", urlD("/tresorerie/versions"), version(), "ecriture"],
      ["POST", urlD("/tresorerie/realises"), realise(DEBUT), "ecriture"],
      ["GET", urlD("/tresorerie/echeances-accords"), undefined, "lecture"],
      [
        "POST",
        urlD("/point-mort"),
        { chiffre_affaires: 10, charges_variables: 5, charges_fixes: 1 },
        "lecture",
      ],
    ] as const;
    const appeler = (par: ReturnType<typeof api>, d: (typeof defs)[number]) =>
      d[0] === "GET" ? par.get(d[1]) : par.post(d[1], d[2]);
    for (const d of defs) appels.push([`${d[0]} ${d[1]}`, () => appeler(api(ctx), d), d[3]]);
    for (const [nom, f] of appels) expect((await f()).statusCode, `401 ${nom}`).toBe(401);
    for (const d of defs) {
      for (const u of [s.gestionnaire, s.ressources, s.expertExterne]) {
        expect((await appeler(u, d)).statusCode, `403 ${d[1]}`).toBe(403);
      }
      if (d[3] === "ecriture")
        expect((await appeler(s.expert, d)).statusCode, `403 expert ${d[1]}`).toBe(403);
      expect((await appeler(s.consultantHors, d)).statusCode, `404 ${d[1]}`).toBe(404);
      expect((await appeler(s.b.associe, d)).statusCode, `404 autre cabinet ${d[1]}`).toBe(404);
    }
    expect((await s.a.associe.get(urlD("/tresorerie", INCONNU))).statusCode).toBe(404);
  });

  it("sans version : lecture vide ; réalisé et échéances d'accords refusés (409 RED_TRESORERIE_ABSENTE)", async () => {
    const r = (await s.a.chef.get(urlD("/tresorerie"))).json();
    expect(r).toEqual({
      version: null,
      realises: [],
      realises_hors_fenetre: 0,
      projection: null,
      historique: [],
    });
    const reel = await s.a.chef.post(urlD("/tresorerie/realises"), realise(DEBUT));
    expect(reel.statusCode).toBe(409);
    expect(erreur(reel)).toBe("RED_TRESORERIE_ABSENTE");
    const ech = await s.a.chef.get(urlD("/tresorerie/echeances-accords"));
    expect(ech.statusCode).toBe(409);
    expect(erreur(ech)).toBe("RED_TRESORERIE_ABSENTE");
  });
});

describe("versions de prévision (route 19) : cas T1", () => {
  it("corps invalide : date non lundi, catégorie hors du sens, montant nul ou décimal, semaine 14, champ inconnu", async () => {
    const url = urlD("/tresorerie/versions");
    const cas: Record<string, unknown>[] = [
      version({ date_debut: "2026-10-13" }),
      version({ lignes: [ligne(1, "encaissement", "salaires", M)] }),
      version({ lignes: [ligne(1, "encaissement", "clients", 0)] }),
      version({ lignes: [ligne(1, "encaissement", "clients", 1.5)] }),
      version({ lignes: [ligne(14, "encaissement", "clients", M)] }),
      version({ exces: 1 }),
      version({ seuil_tension: -1 }),
      version({
        lignes: [{ ...ligne(1, "decaissement", "fournisseurs", M), echeance_id: INCONNU }],
      }),
    ];
    for (const c of cas)
      expect((await s.a.chef.post(url, c)).statusCode, JSON.stringify(c).slice(0, 80)).toBe(400);
  });

  it("T1 : soldes 15, 5, −15 M ; tension de la semaine 2 à 13 ; minimum −15 M à la semaine 3 ; besoin 25 M", async () => {
    const r = await s.consultantEquipe.post(urlD("/tresorerie/versions"), version());
    attendre(201, r, "version 1");
    const t = r.json();
    expect(t.version).toMatchObject({
      version: 1,
      date_debut: DEBUT,
      solde_initial: 50 * M,
      seuil_tension: 10 * M,
    });
    expect(t.version.lignes).toHaveLength(7);
    expect(t.version.lignes[0]).toMatchObject({
      rang: 1,
      semaine: 1,
      sens: "encaissement",
      categorie: "clients",
      montant: 30 * M,
    });
    const p = t.projection;
    expect(p.semaines).toHaveLength(13);
    expect(
      p.semaines.slice(0, 4).map((x: { solde_cloture_retenu: number }) => x.solde_cloture_retenu),
    ).toEqual([15 * M, 5 * M, -15 * M, -15 * M]);
    expect(p.semaines[0]).toMatchObject({
      debut: DEBUT,
      fin: "2026-10-18",
      flux_net_prevu: -35 * M,
      tension: false,
    });
    expect(p.semaines_tension).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(p.premiere_semaine_tension).toBe(2);
    expect(p.solde_minimum).toEqual({ semaine: 3, montant: -15 * M });
    expect(p.besoin_financement).toBe(25 * M);
    expect(p.derniere_semaine_realisee).toBeNull();
    expect(p.totaux).toEqual({
      encaissements_prevus: 65 * M,
      decaissements_prevus: 130 * M,
      flux_net_prevu: -65 * M,
    });
    expect(t.historique).toHaveLength(1);
    // Le dossier en montre le résumé.
    const d = (await s.a.chef.get(`/api/redressement/dossiers/${dossierId}`)).json();
    expect(d.tresorerie).toMatchObject({
      version: 1,
      premiere_semaine_tension: 2,
      besoin_financement: 25 * M,
      derniere_semaine_realisee: null,
      solde_minimum: { semaine: 3, montant: -15 * M },
    });
    // Journal : identifiants et comptes seulement.
    const j = await proprietaire((c) =>
      c.query(
        "SELECT details FROM journal_audit WHERE entite = 'red_tresorerie' AND action = 'tresorerie_version' LIMIT 1",
      ),
    );
    expect(Object.keys(j.rows[0].details).sort()).toEqual([
      "dossier_id",
      "nombre_lignes",
      "version",
    ]);
  });

  it("sans tension : solde initial 100 M, minimum 35 M, besoin nul (T4) ; version 2 puis retour à la version 1", async () => {
    const d2 = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "T4" })).id)).id;
    const r = await s.a.chef.post(
      urlD("/tresorerie/versions", d2),
      version({ solde_initial: 100 * M }),
    );
    attendre(201, r, "T4");
    const p = r.json().projection;
    expect(p.solde_minimum).toEqual({ semaine: 3, montant: 35 * M });
    expect(p.semaines_tension).toEqual([]);
    expect(p.premiere_semaine_tension).toBeNull();
    expect(p.besoin_financement).toBe(0);
    // Solde égal au seuil : pas de tension.
    const egal = await s.a.chef.post(
      urlD("/tresorerie/versions", d2),
      version({ solde_initial: 100 * M, seuil_tension: 35 * M }),
    );
    expect(egal.json().projection.semaines_tension).toEqual([]);
    expect(egal.json().version.version).toBe(2);
    // Découvert admis.
    const decouvert = await s.a.chef.post(
      urlD("/tresorerie/versions", d2),
      version({ solde_initial: -5 * M }),
    );
    expect(decouvert.statusCode).toBe(201);
  });
});

describe("réalisé hebdomadaire (route 20) : cas T2 et T3", () => {
  it("contiguïté : la semaine 3 sans la semaine 2 est refusée (409) ; semaine hors fenêtre ou non lundi : 400", async () => {
    const url = urlD("/tresorerie/realises");
    const trou = await s.a.chef.post(url, realise("2026-10-26"));
    expect(trou.statusCode).toBe(409);
    expect(erreur(trou)).toBe("RED_SEMAINE_PRECEDENTE_MANQUANTE");
    expect((await s.a.chef.post(url, realise("2027-02-01"))).statusCode).toBe(400);
    expect((await s.a.chef.post(url, realise("2026-10-05"))).statusCode).toBe(400);
    expect((await s.a.chef.post(url, realise("2026-10-13"))).statusCode).toBe(400);
    expect(
      (await s.a.chef.post(url, { ...realise(DEBUT), flux: { encaissement: { inconnue: 1 } } }))
        .statusCode,
    ).toBe(400);
    expect((await s.a.chef.post(url, { ...realise(DEBUT), exces: 1 })).statusCode).toBe(400);
  });

  it("T2 : réalisé S1 sans solde constaté : flux net −38 M, solde retenu 12 M, écart net −3 M, besoin 28 M", async () => {
    const r = await s.consultantEquipe.post(
      urlD("/tresorerie/realises"),
      realise(DEBUT, { commentaire: "Relevé de la semaine" }),
    );
    attendre(201, r, "réalisé");
    const t = r.json();
    expect(t.realises).toHaveLength(1);
    expect(t.realises[0]).toMatchObject({
      semaine: 1,
      semaine_debut: DEBUT,
      solde_constate: null,
      corrections: 0,
    });
    const p = t.projection;
    const s1 = p.semaines[0];
    expect(s1.realise).toMatchObject({
      encaissements: 28 * M,
      decaissements: 66 * M,
      flux_net: -38 * M,
      solde_constate: null,
    });
    expect(s1).toMatchObject({
      solde_cloture_retenu: 12 * M,
      ecart_encaissements: -2 * M,
      ecart_decaissements: 1 * M,
      ecart_flux_net: -3 * M,
      ecart_rapprochement: null,
    });
    expect(
      s1.par_categorie.find((c: { categorie: string }) => c.categorie === "fournisseurs"),
    ).toMatchObject({
      prevu: 40 * M,
      realise: 41 * M,
      ecart: 1 * M,
    });
    expect(p.semaines[1].solde_ouverture_retenu).toBe(12 * M);
    expect(
      p.semaines.slice(1, 3).map((x: { solde_cloture_retenu: number }) => x.solde_cloture_retenu),
    ).toEqual([2 * M, -18 * M]);
    expect(p.solde_minimum).toEqual({ semaine: 3, montant: -18 * M });
    expect(p.besoin_financement).toBe(28 * M);
    expect(p.semaines_tension).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(p.ecart_cumule_flux_net).toBe(-3 * M);
    expect(p.derniere_semaine_realisee).toBe(1);
  });

  it("T3 : même réalisé avec un solde constaté de 11 M : rapprochement −1 M, besoin 29 M ; la correction remplace", async () => {
    const r = await s.a.chef.post(
      urlD("/tresorerie/realises"),
      realise(DEBUT, { solde_constate: 11 * M }),
    );
    attendre(201, r, "correction");
    const t = r.json();
    expect(t.realises).toHaveLength(1);
    expect(t.realises[0]).toMatchObject({ solde_constate: 11 * M, corrections: 1 });
    const s1 = t.projection.semaines[0];
    expect(s1.ecart_rapprochement).toBe(-1 * M);
    expect(s1.solde_cloture_retenu).toBe(11 * M);
    expect(
      t.projection.semaines
        .slice(1, 3)
        .map((x: { solde_cloture_retenu: number }) => x.solde_cloture_retenu),
    ).toEqual([1 * M, -19 * M]);
    expect(t.projection.besoin_financement).toBe(29 * M);
    // Les réalisés précédents restent en base (ajout seul) : deux lignes pour la semaine.
    const n = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM red_tresorerie_realises WHERE dossier_id = $1", [
        dossierId,
      ]),
    );
    expect(n.rows[0].n).toBe(2);
  });

  it("la 12e ligne d'une semaine est refusée (409 RED_TROP_DE_CORRECTIONS)", async () => {
    for (let i = 0; i < 9; i += 1) {
      attendre(
        201,
        await s.a.chef.post(
          urlD("/tresorerie/realises"),
          realise(DEBUT, { solde_constate: 11 * M + i }),
        ),
        `correction ${i}`,
      );
    }
    const trop = await s.a.chef.post(urlD("/tresorerie/realises"), realise(DEBUT));
    expect(trop.statusCode).toBe(409);
    expect(erreur(trop)).toBe("RED_TROP_DE_CORRECTIONS");
  });

  it("la semaine suivante se saisit dans l'ordre ; la projection suit le solde constaté", async () => {
    const r = await s.a.chef.post(urlD("/tresorerie/realises"), {
      semaine_debut: "2026-10-19",
      flux: { encaissement: { clients: 20 * M }, decaissement: { fournisseurs: 30 * M } },
      solde_constate: 5 * M,
    });
    attendre(201, r, "semaine 2");
    expect(r.json().projection.derniere_semaine_realisee).toBe(2);
    expect(r.json().realises).toHaveLength(2);
  });
});

describe("fenêtre glissante, échéances d'accords et plafonds", () => {
  it("nouvelle version à date_debut + 7 jours : le réalisé de la semaine écoulée sort de la fenêtre", async () => {
    const r = await s.a.chef.post(
      urlD("/tresorerie/versions"),
      version({
        date_debut: "2026-10-19",
        solde_initial: 5 * M,
        lignes: [ligne(1, "decaissement", "loyers_charges", 2 * M)],
      }),
    );
    attendre(201, r, "version 2");
    const t = r.json();
    expect(t.version.version).toBe(2);
    // Semaine du 12 : hors fenêtre ; semaine du 19 : semaine 1 de la nouvelle fenêtre, réalisée.
    expect(t.realises_hors_fenetre).toBe(1);
    expect(t.realises.map((x: { semaine: number }) => x.semaine)).toEqual([1]);
    expect(t.projection.derniere_semaine_realisee).toBe(1);
    expect(t.historique.map((h: { version: number }) => h.version)).toEqual([2, 1]);
  });

  it("une nouvelle fenêtre qui laisse un trou dans les réalisés est refusée (409 RED_REALISE_NON_CONTIGU)", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Trou" })).id)).id;
    attendre(201, await s.a.chef.post(urlD("/tresorerie/versions", d), version()), "v1");
    attendre(201, await s.a.chef.post(urlD("/tresorerie/realises", d), realise(DEBUT)), "r1");
    attendre(
      201,
      await s.a.chef.post(urlD("/tresorerie/realises", d), realise("2026-10-19")),
      "r2",
    );
    // Fenêtre débutant avant le réalisé : semaines 2 et 3 réalisées, pas la 1.
    const trou = await s.a.chef.post(
      urlD("/tresorerie/versions", d),
      version({ date_debut: "2026-10-05" }),
    );
    expect(trou.statusCode).toBe(409);
    expect(erreur(trou)).toBe("RED_REALISE_NON_CONTIGU");
  });

  it("échéances d'accords : lignes proposées (rien n'est écrit), rattachement par créancier et échéance", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Accords" })).id)).id;
    const cr = await s.a.chef.post(urlD("/creanciers", d), {
      nom: "Banque de développement",
      categorie: "banque",
      principal: 90 * M,
      interets: 10 * M,
      date_arrete: "2026-10-01",
      echeance_initiale: "2026-09-30",
    });
    attendre(201, cr, "créancier");
    const creancier = cr.json().id as string;
    const accord = await s.a.chef.post(`/api/redressement/creanciers/${creancier}/evenements`, {
      type: "accord",
      date_evenement: "2026-10-10",
      montant: 80 * M,
      echeancier: {
        mode: "regulier",
        nombre_echeances: 4,
        date_premiere: "2026-11-15",
        periodicite_mois: 1,
      },
    });
    attendre(201, accord, "accord");
    attendre(201, await s.a.chef.post(urlD("/tresorerie/versions", d), version()), "version");
    const p = await s.a.chef.get(urlD("/tresorerie/echeances-accords", d));
    attendre(200, p, "proposition");
    const prop = p.json();
    // 2026-11-15 : 34 jours après le 12 octobre (semaine 5) ; 2026-12-15 : 64 jours (semaine 10) ; les deux
    // suivantes dépassent la semaine 13.
    expect(prop.lignes).toHaveLength(2);
    expect(prop.lignes[0]).toMatchObject({
      semaine: 5,
      sens: "decaissement",
      categorie: "service_dette",
      montant: 20 * M,
      creancier_id: creancier,
    });
    expect(prop.lignes[1]).toMatchObject({ semaine: 10, montant: 20 * M });
    expect(prop.anterieures).toBe(0);
    expect(prop.ulterieures).toBe(2);
    // Rien n'a été écrit.
    const v = (await s.a.chef.get(urlD("/tresorerie", d))).json();
    expect(v.version.lignes).toHaveLength(7);
    // Rattachement : la version reprend créancier et échéance proposés.
    const reprise = await s.a.chef.post(
      urlD("/tresorerie/versions", d),
      version({
        lignes: prop.lignes.map((l: Record<string, unknown>) => ({
          ...l,
          libelle: "Accord bancaire",
        })),
      }),
    );
    attendre(201, reprise, "version avec rattachements");
    expect(reprise.json().version.lignes[0]).toMatchObject({
      creancier_id: creancier,
      libelle: "Accord bancaire",
    });
    expect(reprise.json().version.lignes[0].echeance_id).toBe(prop.lignes[0].echeance_id);
    // Échéance rattachée à un autre créancier du dossier : 400 ; créancier d'un autre dossier : 400.
    const autreCr = await s.a.chef.post(urlD("/creanciers", d), {
      nom: "Fournisseur Alpha",
      categorie: "fournisseur",
      principal: 10 * M,
      date_arrete: "2026-10-01",
    });
    const incoherent = await s.a.chef.post(
      urlD("/tresorerie/versions", d),
      version({ lignes: [{ ...prop.lignes[0], creancier_id: autreCr.json().id }] }),
    );
    expect(incoherent.statusCode).toBe(400);
    expect(erreur(incoherent)).toBe("RED_RATTACHEMENT_INCOHERENT");
    const autreDossier = await s.a.chef.post(
      urlD("/tresorerie/versions", dossierId),
      version({ lignes: [prop.lignes[0]] }),
    );
    expect(autreDossier.statusCode).toBe(400);
  });

  it("volume : 600 lignes passent, 601 sont refusées par le schéma (400)", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Volume" })).id)).id;
    const lignes = (n: number) =>
      Array.from({ length: n }, (_, i) => ligne((i % 13) + 1, "encaissement", "clients", 1000));
    const debut = Date.now();
    const ok = await s.a.chef.post(
      urlD("/tresorerie/versions", d),
      version({ lignes: lignes(600) }),
    );
    attendre(201, ok, "600 lignes");
    expect(ok.json().version.lignes).toHaveLength(600);
    expect(Date.now() - debut).toBeLessThan(10_000);
    expect(
      (await s.a.chef.post(urlD("/tresorerie/versions", d), version({ lignes: lignes(601) })))
        .statusCode,
    ).toBe(400);
  });

  it("débit : 60 versions par utilisateur et par 10 minutes (429)", async () => {
    const d = (await ouvrirDossierRed(s, (await creerMission(s.a, { intitule: "Débit" })).id)).id;
    const u = s.associe2;
    for (let i = 0; i < 60; i += 1) {
      attendre(
        201,
        await u.post(urlD("/tresorerie/versions", d), version({ lignes: [] })),
        `version ${i}`,
      );
    }
    const trop = await u.post(urlD("/tresorerie/versions", d), version({ lignes: [] }));
    expect(trop.statusCode).toBe(429);
    expect(erreur(trop)).toBe("RED_TROP_DE_VERSIONS_TRESORERIE");
  });
});

describe("point mort (route 22) : cas T8", () => {
  const pm = (corps: Record<string, unknown>) => s.a.chef.post(urlD("/point-mort"), corps);

  it("bénéficiaire : seuil 857 142 858, marge de sécurité 342 857 142, 257 jours", async () => {
    const r = await pm({
      chiffre_affaires: 1200 * M,
      charges_variables: 780 * M,
      charges_fixes: 300 * M,
    });
    attendre(200, r, "point mort");
    expect(r.json()).toEqual({
      statut: "beneficiaire",
      periode_jours: 360,
      marge_cout_variable: 420 * M,
      taux_marge_cout_variable_pb: 3500,
      resultat_exploitation: 120 * M,
      seuil_rentabilite: 857_142_858,
      marge_securite: 342_857_142,
      marge_securite_pb: 2857,
      point_mort_jours: 257,
    });
  });

  it("déficitaire, équilibre, impossible, non calculable ; période 366 ; entrées invalides", async () => {
    const def = (
      await pm({ chiffre_affaires: 1200 * M, charges_variables: 780 * M, charges_fixes: 500 * M })
    ).json();
    expect(def).toMatchObject({
      statut: "deficitaire",
      resultat_exploitation: -80 * M,
      seuil_rentabilite: 1_428_571_429,
      marge_securite: -228_571_429,
      marge_securite_pb: -1905,
      point_mort_jours: 429,
    });
    const eq = (
      await pm({ chiffre_affaires: 1200 * M, charges_variables: 780 * M, charges_fixes: 420 * M })
    ).json();
    expect(eq).toMatchObject({
      statut: "equilibre",
      seuil_rentabilite: 1200 * M,
      marge_securite: 0,
      marge_securite_pb: 0,
      point_mort_jours: 360,
    });
    expect(
      (await pm({ chiffre_affaires: 1000, charges_variables: 1000, charges_fixes: 10 })).json()
        .statut,
    ).toBe("impossible");
    expect(
      (await pm({ chiffre_affaires: 0, charges_variables: 0, charges_fixes: 10 })).json(),
    ).toMatchObject({
      statut: "non_calculable",
      seuil_rentabilite: null,
    });
    const long = (
      await pm({
        chiffre_affaires: 1200 * M,
        charges_variables: 780 * M,
        charges_fixes: 300 * M,
        periode_jours: 366,
      })
    ).json();
    expect(long.periode_jours).toBe(366);
    expect(long.point_mort_jours).toBe(261);
    for (const c of [
      { chiffre_affaires: 1, charges_variables: 1, charges_fixes: 1, periode_jours: 0 },
      { chiffre_affaires: 1, charges_variables: 1, charges_fixes: 1, periode_jours: 367 },
      { chiffre_affaires: -1, charges_variables: 1, charges_fixes: 1 },
      { chiffre_affaires: 1.5, charges_variables: 1, charges_fixes: 1 },
      { chiffre_affaires: 1, charges_variables: 1 },
    ]) {
      expect((await pm(c)).statusCode, JSON.stringify(c)).toBe(400);
    }
  });

  it("aucune écriture, aucun journal", async () => {
    const avant = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM journal_audit"),
    );
    await pm({ chiffre_affaires: 10, charges_variables: 5, charges_fixes: 1 });
    const apres = await proprietaire((c) =>
      c.query("SELECT count(*)::int AS n FROM journal_audit"),
    );
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
  });
});
