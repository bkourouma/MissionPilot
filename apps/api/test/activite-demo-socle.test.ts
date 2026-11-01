import { randomUUID } from "node:crypto";
import { ajouterJours, ErreurFinance, versCentiemes } from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approbateurFactureDemo,
  auteurAvenantDemo,
  auteurJalonDemo,
  collaborateurAuthDemo,
  declarantMissionDemo,
  emetteurFactureDemo,
  lireActeursDemo,
  valideurPartieDemo,
  valideurRevisionDemo,
  type ActeursDemo,
} from "../src/activite-demo/acteurs.js";
import {
  ACTIONS_ACTIVITE_DEMO,
  bilanVideActiviteDemo,
  contexteActiviteDemo,
  dansPointDeSauvegarde,
  dernierMarqueur,
  estErreurIsolable,
  idsMarques,
  jourReelDemo,
  marqueurExiste,
  poserMarqueur,
  sansContenu,
  type ContexteActiviteDemo,
} from "../src/activite-demo/commun.js";
import {
  derniereEmissionExerciceDemo,
  dernieresFacturesParMissionDemo,
  feuilleExisteDemo,
  joursDecoupageParCleDemo,
  lireCabinetDemo,
  lireFacturesOuvertesDemo,
  lireSemaineDemo,
  lireSuivisTachesDemo,
} from "../src/activite-demo/lecture.js";
import type { Auth } from "../src/auth/contexte.js";
import { brancherDiagnostic } from "../src/automatisation/diagnostic.js";
import type { Db } from "../src/db/pool.js";
import { conflit } from "../src/errors.js";
import { ErreurJobDefinitive } from "../src/jobs/erreurs.js";
import { peutModifierMission, type MissionAcces } from "../src/missions/acces.js";
import { chargerVersions, versionDeReference } from "../src/missions/budget.js";
import { peutDeciderPartie, type FeuilleDb } from "../src/temps/feuilles.js";
import {
  preparerCabinetDemo,
  retirerMarquesDemo,
  type CabinetDemoTest,
} from "./activite-demo-outils.js";
import { attendre } from "./facturation-outils.js";
import { creerCabinet, demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Socle de l'activité de démonstration (job « activite_demo ») : acteurs (§2.7 de la
 * spécification : chaque écriture au nom de qui la route accepterait, jamais l'auteur pour ce
 * qu'il doit valider), erreurs isolables et points de sauvegarde (§2.6), marqueurs d'idempotence
 * (§2.5) et lectures (contrat de lecture.ts) sur la fixture `activite-demo-outils.ts`.
 */

/* ----- Acteurs (fonctions pures) ----- */

const CABINET = randomUUID();
const id = (u: Auth) => u.utilisateurId;

function personne(nom: string, ...roles: Role[]): Auth {
  return {
    utilisateurId: randomUUID(),
    cabinetId: CABINET,
    email: `${nom}@exemple.test`,
    nom,
    roles,
  };
}

const acteurs = (...liste: Auth[]): ActeursDemo => ({
  tous: liste,
  parId: new Map(liste.map((u) => [u.utilisateurId, u])),
});

const associe = personne("associe", "associe");
const associe2 = personne("associe2", "associe");
const directeur = personne("directeur", "directeur_mission");
const chef = personne("chef", "chef_mission");
const consultant = personne("consultant", "consultant");
const gestionnaire = personne("gestionnaire", "gestionnaire");
const ressources = personne("ressources", "ressources");
const client = personne("client", "client_dirigeant");
const tous = acteurs(associe, associe2, directeur, chef, consultant, gestionnaire, ressources);

const mission = { mission_id: randomUUID(), chef_id: id(chef), directeur_id: id(directeur) };
const sansChef = { ...mission, chef_id: null };
const sansResponsable = { ...mission, chef_id: null, directeur_id: null };
const interne = { mission_id: null, chef_id: null, directeur_id: null };

const feuilleDe = (auteur: Auth) => ({ auteur_id: id(auteur) }) as unknown as FeuilleDb;
const acces = (m: { chef_id: string | null; directeur_id: string | null }) =>
  ({ ...m, statut: "en_cours" }) as unknown as MissionAcces;

describe("acteurs : feuilles de temps (§2.7)", () => {
  it("auteur d'une feuille : l'utilisateur actif du collaborateur, jamais un compte du portail", () => {
    expect(collaborateurAuthDemo(tous, id(consultant))).toBe(consultant);
    expect(collaborateurAuthDemo(tous, null)).toBeNull();
    expect(collaborateurAuthDemo(tous, randomUUID())).toBeNull();
    expect(collaborateurAuthDemo(acteurs(client), id(client))).toBeNull();
  });

  it("partie mission : chef ≠ auteur, sinon directeur ≠ auteur, sinon associé ≠ auteur", () => {
    expect(valideurPartieDemo(tous, mission, id(consultant))).toBe(chef);
    expect(valideurPartieDemo(tous, mission, id(chef))).toBe(directeur);
    expect(valideurPartieDemo(tous, sansChef, id(directeur))).toBe(associe);
    expect(valideurPartieDemo(tous, sansResponsable, id(associe))).toBe(associe2);
    expect(valideurPartieDemo(acteurs(associe), sansResponsable, id(associe))).toBeNull();
    // Chef désigné mais inactif (absent des acteurs lus) : le directeur.
    const sansChefActif = acteurs(directeur, consultant);
    expect(valideurPartieDemo(sansChefActif, mission, id(consultant))).toBe(directeur);
  });

  it("partie interne : associé ≠ auteur, sinon validateur qui voit tout le cabinet, jamais le chef", () => {
    expect(valideurPartieDemo(tous, interne, id(consultant))).toBe(associe);
    const encadrement = acteurs(chef, directeur, associe);
    expect(valideurPartieDemo(encadrement, interne, id(associe))).toBe(directeur);
    expect(valideurPartieDemo(acteurs(chef, consultant), interne, id(consultant))).toBeNull();
  });

  it("tout valideur de partie est accepté par peutDeciderPartie et n'est jamais l'auteur", () => {
    for (const p of [mission, sansChef, sansResponsable, interne]) {
      for (const auteur of tous.tous) {
        const v = valideurPartieDemo(tous, p, id(auteur));
        if (!v) continue;
        expect(id(v)).not.toBe(id(auteur));
        expect(peutDeciderPartie(v, feuilleDe(auteur), { ...p, intitule: "Partie" })).toBe(true);
      }
    }
  });
});

describe("acteurs : dérive, jalon, avenant (§2.7)", () => {
  it("déclarant de dérive : chef, sinon directeur, sinon associé qui modifie toutes les missions", () => {
    expect(declarantMissionDemo(tous, mission)).toBe(chef);
    expect(declarantMissionDemo(tous, sansChef)).toBe(directeur);
    expect(declarantMissionDemo(tous, sansResponsable)).toBe(associe);
    expect(declarantMissionDemo(acteurs(consultant, ressources), sansResponsable)).toBeNull();
    // Il peut modifier la mission (routes/suivi-temps.ts : peutModifierMission).
    for (const m of [mission, sansChef, sansResponsable]) {
      const d = declarantMissionDemo(tous, m) as Auth;
      expect(peutModifierMission(d, acces(m))).toBe(true);
    }
  });

  it("auteur du jalon : chef, sinon directeur, jamais un associé", () => {
    expect(auteurJalonDemo(tous, mission)).toBe(chef);
    expect(auteurJalonDemo(tous, sansChef)).toBe(directeur);
    expect(auteurJalonDemo(tous, sansResponsable)).toBeNull();
    // Un « chef » désigné sans mission.planifier (consultant) est sauté.
    expect(auteurJalonDemo(tous, { ...mission, chef_id: id(consultant) })).toBe(directeur);
  });

  it("auteur de l'avenant : chef, sinon directeur, avec les quatre droits de l'avenant", () => {
    expect(auteurAvenantDemo(tous, mission)).toBe(chef);
    expect(auteurAvenantDemo(tous, { ...mission, chef_id: id(consultant) })).toBe(directeur);
    expect(auteurAvenantDemo(tous, sansResponsable)).toBeNull();
  });

  it("valideur de la révision : directeur ≠ auteur qui satisfait le rôle, sinon associé ≠ auteur", () => {
    expect(valideurRevisionDemo(tous, mission, id(chef), "chef_mission")).toBe(directeur);
    expect(valideurRevisionDemo(tous, mission, id(chef), "directeur_mission")).toBe(directeur);
    expect(valideurRevisionDemo(tous, mission, id(chef), "associe")).toBe(associe);
    expect(valideurRevisionDemo(tous, mission, id(directeur), "chef_mission")).toBe(associe);
    expect(valideurRevisionDemo(tous, sansResponsable, id(associe), "associe")).toBe(associe2);
    const seuls = acteurs(associe, directeur);
    expect(valideurRevisionDemo(seuls, mission, id(associe), "associe")).toBeNull();
  });
});

describe("acteurs : facturation (§2.7)", () => {
  it("émetteur des factures et des encaissements : gestionnaire, sinon associé", () => {
    expect(emetteurFactureDemo(tous)).toBe(gestionnaire);
    expect(emetteurFactureDemo(acteurs(associe, chef))).toBe(associe);
    expect(emetteurFactureDemo(acteurs(chef, consultant, ressources))).toBeNull();
  });

  it("approbateur : directeur qui satisfait le rôle, sinon associé ; jamais une personne exclue", () => {
    const g = [id(gestionnaire)];
    expect(approbateurFactureDemo(tous, mission, g, "chef_mission")).toBe(directeur);
    expect(approbateurFactureDemo(tous, mission, g, "directeur_mission")).toBe(directeur);
    expect(approbateurFactureDemo(tous, mission, g, "associe")).toBe(associe);
    const sansDirecteur = [...g, id(directeur)];
    expect(approbateurFactureDemo(tous, mission, sansDirecteur, "chef_mission")).toBe(associe);
    // L'associé n'est pas dispensé : créateur, soumetteur ou modificateur, il n'approuve pas.
    expect(approbateurFactureDemo(tous, mission, [id(associe)], "associe")).toBe(associe2);
    const exclus = [id(associe), id(associe2), id(directeur)];
    expect(approbateurFactureDemo(tous, mission, exclus, "chef_mission")).toBeNull();
  });
});

/* ----- Erreurs (fonctions pures) ----- */

const erreurPg = (code: string, extra: Record<string, string> = {}) =>
  Object.assign(new Error("Erreur PostgreSQL (contenu sensible : 1 500 000 FCFA)"), {
    code,
    ...extra,
  });
const pg = (code: string) => erreurPg(code);

describe("erreurs de l'activité de démonstration (§2.6)", () => {
  it("isolables : règle métier, moteur, données, contraintes, déclencheurs, droits", () => {
    const codes = ["22P02", "23505", "23503", "23514", "P0001", "42501", "MPT03", "MQP02"];
    const isolables: unknown[] = [
      conflit("Règle métier."),
      new ErreurFinance("MONTANT_INVALIDE", "Montant."),
      new RangeError("Hors bornes."),
      ...codes.map(pg),
    ];
    for (const e of isolables) expect(estErreurIsolable(e), String(e)).toBe(true);
  });

  it("relancées : sérialisation, interblocage, verrou, délai, connexion, programmation, définitive", () => {
    const codes = ["40001", "40P01", "55P03", "57014", "08006", "57P01", "42P01", "ECONNRESET"];
    const relancees: unknown[] = [
      ...codes.map(pg),
      new ErreurJobDefinitive("Charge invalide."),
      new TypeError("Programmation."),
      new Error("Connexion perdue."),
      null,
      "texte",
    ];
    for (const e of relancees) expect(estErreurIsolable(e), String(e)).toBe(false);
  });

  it("sansContenu : code, contrainte et table seulement, jamais le message ni le détail", () => {
    const e = erreurPg("23505", { constraint: "factures_uniq", table: "factures", detail: "x=1" });
    const generique = "Échec d'une étape de l'activité de démonstration.";
    expect(sansContenu(e)).toEqual({
      message: generique,
      code: "23505",
      constraint: "factures_uniq",
      table: "factures",
    });
    const metier = sansContenu(conflit("Kora : 1 500 000 FCFA"));
    expect(metier).toEqual({ message: generique, code: "CONFLIT" });
    expect(sansContenu(null)).toEqual({ message: generique });
  });

  it("jour d'exécution : jamais après la date réelle", () => {
    const reel = new Date().toISOString().slice(0, 10);
    expect(jourReelDemo(new Date("2099-06-01T10:00:00Z"))).toBe(reel);
    expect(jourReelDemo(new Date("2026-06-15T23:59:59Z"))).toBe("2026-06-15");
  });
});

/* ----- Base : fixture d'un cabinet de démonstration ----- */

let ctx: Contexte;
let demo: CabinetDemoTest;
let autre: { cabinetId: string; utilisateurId: string };
/** Lundi de la semaine de référence (passée) et son mois. */
const LUNDI = "2026-06-15";
const MOIS = "2026-06";
const PLAFONDS = { collaborateursMax: 60, missionsMax: 50 };
const AJOUT_ACTIVITE = `INSERT INTO activites_internes (cabinet_id, code, libelle)
  VALUES ($1, $2, 'Essai')`;

beforeAll(async () => {
  ctx = await demarrer();
  demo = await preparerCabinetDemo(ctx, "Socle activité démo", { dateReference: LUNDI });
  autre = await creerCabinet(ctx, "Socle activité démo : autre cabinet");
}, 180_000);

afterAll(async () => {
  await retirerMarquesDemo();
  await ctx.fermer();
});

/** Transaction du cabinet de démonstration (RLS posée), comme celle du worker. */
const enCabinet = <T>(f: (db: Db) => Promise<T>): Promise<T> =>
  ctx.db.withTenant(demo.cabinetId, f);

/** Transaction du cabinet avec un contexte du job (horloge : le lundi de référence, 05:00 UTC). */
const dansLeCabinet = <T>(f: (c: ContexteActiviteDemo) => Promise<T>): Promise<T> =>
  enCabinet(async (db) => {
    const maintenant = new Date(`${LUNDI}T05:00:00Z`);
    return f(await contexteActiviteDemo(db, demo.cabinetId, randomUUID(), maintenant, MOIS));
  });

/** Ajoute une activité interne d'essai (code en `zz_` : jamais choisie comme complément). */
const ajouterActivite = (c: ContexteActiviteDemo, code: string) =>
  c.db.query(AJOUT_ACTIVITE, [c.cabinetId, code]);

async function activiteExiste(code: string): Promise<boolean> {
  const sql = "SELECT 1 FROM activites_internes WHERE cabinet_id = $1 AND code = $2";
  const r = await proprietaire((cl) => cl.query(sql, [demo.cabinetId, code]));
  return (r.rowCount ?? 0) > 0;
}

describe("contexte et acteurs lus en base", () => {
  it("contexte : jour J, bilan à zéro, acteurs actifs du seul cabinet, par nom", async () => {
    await dansLeCabinet(async (c) => {
      expect(c.jour).toBe(LUNDI);
      expect(c.bilan).toEqual(bilanVideActiviteDemo(MOIS));
      const ids = c.acteurs.tous.map(id);
      for (const u of [
        demo.chef,
        demo.directeur,
        demo.gestionnaire,
        demo.consultant,
        demo.junior,
      ]) {
        expect(ids).toContain(u.utilisateurId);
      }
      expect(ids).not.toContain(autre.utilisateurId);
      // « Associé Test » (fondateur) avant les « Utilisateur Test » : tri par nom.
      expect(ids[0]).toBe(demo.associeId);
      expect(c.acteurs.parId.get(demo.chef.utilisateurId)?.roles).toEqual(["chef_mission"]);
    });
  });

  it("un utilisateur désactivé n'est plus un acteur", async () => {
    const u = await demo.avecRoles(["chef_mission"]);
    const sql = "UPDATE utilisateurs SET actif = false WHERE id = $1";
    await proprietaire((cl) => cl.query(sql, [u.utilisateurId]));
    const lus = await enCabinet((db) => lireActeursDemo(db, demo.cabinetId));
    expect(lus.parId.has(u.utilisateurId)).toBe(false);
    expect(lus.tous.map(id)).not.toContain(u.utilisateurId);
  });
});

describe("points de sauvegarde (§2.6)", () => {
  it("erreur isolable : null, échec compté, incident sans contenu, transaction utilisable", async () => {
    const incidents: Record<string, unknown>[] = [];
    const debrancher = brancherDiagnostic((entree) => incidents.push(entree));
    const echec = () => Promise.reject(conflit("Facture de Kora : 1 500 000 FCFA refusée."));
    const reperes = { semaine: LUNDI };
    try {
      await dansLeCabinet(async (c) => {
        const r = await dansPointDeSauvegarde(c, "ad_facture", "facture", reperes, echec);
        expect(r).toBeNull();
        expect(c.bilan.echecs).toBe(1);
        expect((await c.db.query("SELECT 1 AS un")).rows).toEqual([{ un: 1 }]);
      });
    } finally {
      debrancher();
    }
    const incident = incidents.find((i) => i.contexte === "activite_demo_facture");
    expect(incident).toMatchObject({
      semaine: LUNDI,
      code: "CONFLIT",
      message: "Échec d'une étape de l'activité de démonstration.",
      job_id: expect.any(String),
    });
    expect(JSON.stringify(incident)).not.toContain("Kora");
    expect(JSON.stringify(incident)).not.toContain("1 500 000");
  });

  it("violation d'unicité (23505) : l'étape entière est annulée, la suivante écrit", async () => {
    await dansLeCabinet(async (c) => {
      const r = await dansPointDeSauvegarde(c, "ad_feuille", "feuille", {}, async () => {
        await ajouterActivite(c, "zz_essai_annule");
        await ajouterActivite(c, "formation"); // activité par défaut du cabinet : doublon
        return "jamais";
      });
      expect(r).toBeNull();
      const sql = "SELECT 1 FROM activites_internes WHERE code = 'zz_essai_annule'";
      expect((await c.db.query(sql)).rowCount).toBe(0);
      const ok = await dansPointDeSauvegarde(c, "ad_jalon", "jalon", {}, async () => {
        await ajouterActivite(c, "zz_essai_garde");
        return "fait";
      });
      expect(ok).toBe("fait");
      expect(c.bilan.echecs).toBe(1);
    });
    expect(await activiteExiste("zz_essai_annule")).toBe(false);
    expect(await activiteExiste("zz_essai_garde")).toBe(true);
  });

  it("interblocage (40P01) : relancé tel quel, toute la transaction du cabinet est annulée", async () => {
    const interblocage = erreurPg("40P01");
    const etape = (c: ContexteActiviteDemo) =>
      dansPointDeSauvegarde(c, "ad_derive", "derive", {}, async () => {
        await ajouterActivite(c, "zz_essai_interblocage");
        throw interblocage;
      });
    await expect(dansLeCabinet(etape)).rejects.toBe(interblocage);
    expect(await activiteExiste("zz_essai_interblocage")).toBe(false);
  });

  it("erreur définitive du job : relancée (le worker passe la tâche en échec)", async () => {
    const definitive = () => Promise.reject(new ErreurJobDefinitive("Charge invalide."));
    const etape = (c: ContexteActiviteDemo) =>
      dansPointDeSauvegarde(c, "ad_encaissement", "encaissement", {}, definitive);
    await expect(dansLeCabinet(etape)).rejects.toBeInstanceOf(ErreurJobDefinitive);
  });
});

describe("marqueurs du journal (§2.5)", () => {
  const e1 = randomUUID();
  const e2 = randomUUID();
  const veille = ajouterJours(LUNDI, -1);
  const suivante = ajouterJours(LUNDI, 7);
  const { encaissement, facture, jalon, prolongation } = ACTIONS_ACTIVITE_DEMO;

  it("pose au nom du job (utilisateur nul, job_id), relue par semaine, mois et entité", async () => {
    await dansLeCabinet(async (c) => {
      await poserMarqueur(c, facture, "facture", e1, { semaine: LUNDI, mission_id: "m" });
      await poserMarqueur(c, facture, "facture", e2, { semaine: suivante });
      await poserMarqueur(c, prolongation, "mission", demo.missionRegie.id, { mois: MOIS });
    });
    await enCabinet(async (db) => {
      const plusTard = ajouterJours(LUNDI, 14);
      const avenant = { entiteId: demo.missionRegie.id, mois: MOIS };
      expect(await marqueurExiste(db, facture, { semaine: LUNDI }, veille)).toBe(true);
      expect(await marqueurExiste(db, facture, { semaine: plusTard }, veille)).toBe(false);
      expect(await marqueurExiste(db, facture, { entiteId: e2 }, veille)).toBe(true);
      expect(await marqueurExiste(db, prolongation, avenant, veille)).toBe(true);
      expect(await marqueurExiste(db, prolongation, { mois: "2026-07" }, veille)).toBe(false);
      expect(await marqueurExiste(db, facture, { semaine: LUNDI }, "2099-01-01")).toBe(false);
    });
    const sql = `SELECT utilisateur_id, details FROM journal_audit
                 WHERE cabinet_id = $1 AND action = $2`;
    const r = await proprietaire((cl) => cl.query(sql, [demo.cabinetId, facture]));
    expect(r.rows).toHaveLength(2);
    for (const l of r.rows) {
      expect(l.utilisateur_id).toBeNull();
      expect(l.details.job_id).toEqual(expect.any(String));
    }
  });

  it("dernier marqueur et identifiants marqués : du plus récent au plus ancien, bornés", async () => {
    await enCabinet(async (db) => {
      expect(await dernierMarqueur(db, facture, veille)).toEqual({
        entiteId: e2,
        details: { semaine: suivante, job_id: expect.any(String) },
      });
      expect(await dernierMarqueur(db, jalon, veille)).toBeNull();
      expect(await idsMarques(db, facture, veille, 10)).toEqual([e2, e1]);
      expect(await idsMarques(db, facture, veille, 1)).toEqual([e2]);
      expect(await idsMarques(db, facture, "2099-01-01", 10)).toEqual([]);
    });
  });

  it("un marqueur ne porte ni montant ni nom ; une action hors du module est refusée", async () => {
    await dansLeCabinet(async (c) => {
      const montant = poserMarqueur(c, encaissement, "facture", e1, { montant: 1000 });
      await expect(montant).rejects.toThrow(RangeError);
      const libelle = poserMarqueur(c, jalon, "mission_jalon", null, { libelle: "x" });
      await expect(libelle).rejects.toThrow(RangeError);
      const etrangere = poserMarqueur(c, "avancement.brouillon_genere", "x", null, {});
      await expect(etrangere).rejects.toThrow(RangeError);
    });
  });
});

describe("lectures (contrat de lecture.ts)", () => {
  const regie = () => demo.missionRegie.id;
  const lireSemaine = (lundi: string, plafonds = PLAFONDS) =>
    enCabinet((db) => lireSemaineDemo(db, demo.cabinetId, lundi, plafonds));

  it("cabinet : démonstration, actif, à la demi-journée ; un autre cabinet est invisible", async () => {
    await enCabinet(async (db) => {
      expect(await lireCabinetDemo(db, demo.cabinetId)).toEqual({
        estDemo: true,
        actif: true,
        granularite: "demi_journee",
        devise: "XOF",
      });
      expect(await lireCabinetDemo(db, autre.cabinetId)).toBeNull();
    });
  });

  it("semaine : collaborateurs rattachés, missions en vol, activité interne, affectations", async () => {
    const l = await lireSemaine(LUNDI);
    expect(l.periode).toEqual({ debut: LUNDI, fin: ajouterJours(LUNDI, 6) });
    expect(l.parametres.granularite).toBe("demi_journee");
    expect(l.moisClotures).toEqual([]);
    expect(l.plafondAtteint).toBe(false);
    const ids = [demo.consultant.collaborateurId, demo.junior.collaborateurId].sort();
    expect(l.collaborateurs.map((c) => c.id).sort()).toEqual(ids);
    expect(l.collaborateurs.find((c) => c.id === demo.consultant.collaborateurId)).toMatchObject({
      utilisateurId: demo.consultant.utilisateurId,
      capacitePct: 100,
      gradeCode: "senior",
    });
    // La mission affectée cette semaine d'abord.
    expect(l.missions.map((m) => m.id)).toEqual([regie(), demo.missionForfait.id]);
    expect(l.missions[0]).toMatchObject({
      statut: "en_cours",
      modeFacturation: "regie",
      clientActif: true,
      chefId: demo.chef.utilisateurId,
      directeurId: demo.directeur.utilisateurId,
      dateDebut: ajouterJours(LUNDI, -56),
    });
    expect(l.missions[1]).toMatchObject({ statut: "signee", modeFacturation: "forfait" });
    const sql = "SELECT id FROM activites_internes WHERE cabinet_id = $1 AND code = $2";
    const administration = await proprietaire((cl) =>
      cl.query(sql, [demo.cabinetId, "administration"]),
    );
    expect(l.activiteInterneId).toBe(administration.rows[0].id);
    const jours = (collaborateurId: string) =>
      (l.affectations.get(collaborateurId) ?? []).map((a) => a.joursAlloues).sort((a, b) => a - b);
    expect(jours(demo.consultant.collaborateurId)).toEqual([12, 20]);
    expect(jours(demo.junior.collaborateurId)).toEqual([16]);
    expect(l.affectations.get(demo.junior.collaborateurId)?.[0]?.missionId).toBe(regie());
    expect(l.absences.get(demo.consultant.collaborateurId)).toEqual([]);
  });

  it("suivi par tâche : budget, réalisé validé, attente et affectés, en centièmes", async () => {
    const l = await lireSemaine(LUNDI);
    const taches = l.suivis.get(regie()) ?? [];
    const { diagnostic: idDiagnostic, orientations: idOrientations } = demo.missionRegie.taches;
    const diagnostic = taches.find((t) => t.tacheId === idDiagnostic);
    const orientations = taches.find((t) => t.tacheId === idOrientations);
    const ids = [demo.consultant.collaborateurId, demo.junior.collaborateurId].sort();
    // 3 semaines validées : 4 j (consultant) + 3 j (junior) par semaine.
    expect(diagnostic).toMatchObject({
      missionId: regie(),
      budgetCentiemes: 3600,
      realiseCentiemes: 2100,
      attenteCentiemes: 0,
      declarations: {},
      affectes: ids,
    });
    expect(diagnostic?.phaseId).toEqual(expect.any(String));
    expect(orientations).toMatchObject({
      budgetCentiemes: 2000,
      realiseCentiemes: 0,
      affectes: [demo.consultant.collaborateurId],
    });
    expect(l.suivis.has(demo.missionForfait.id)).toBe(true);
  });

  it("plafonds : collaborateurs et missions tronqués, plafond signalé ; un mardi est refusé", async () => {
    const l = await lireSemaine(LUNDI, { collaborateursMax: 1, missionsMax: 1 });
    expect(l.collaborateurs).toHaveLength(1);
    expect(l.missions.map((m) => m.id)).toEqual([regie()]);
    expect(l.plafondAtteint).toBe(true);
    await expect(lireSemaine(ajouterJours(LUNDI, 1))).rejects.toThrow(RangeError);
  });

  it("déclarations : la dernière de chaque collaborateur fait foi, zéro compris", async () => {
    const tache = demo.missionRegie.taches.diagnostic;
    const sql = `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id,
                   semaine, centiemes, declare_par)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    const declarer = (collaborateurId: string, centiemes: number) => {
      const valeurs = [demo.cabinetId, regie(), tache, collaborateurId, LUNDI, centiemes];
      return proprietaire((cl) => cl.query(sql, [...valeurs, demo.chef.utilisateurId]));
    };
    await declarer(demo.consultant.collaborateurId, 800);
    await declarer(demo.consultant.collaborateurId, 500);
    await declarer(demo.junior.collaborateurId, 0);
    const doublons = [regie(), regie()];
    const suivis = await enCabinet((db) => lireSuivisTachesDemo(db, demo.cabinetId, doublons));
    const diagnostic = (suivis.get(regie()) ?? []).find((t) => t.tacheId === tache);
    expect(diagnostic?.declarations).toEqual({
      [demo.consultant.collaborateurId]: 500,
      [demo.junior.collaborateurId]: 0,
    });
    const aucun = await enCabinet((db) => lireSuivisTachesDemo(db, demo.cabinetId, []));
    expect(aucun.size).toBe(0);
  });

  it("découpage par clé : cohérent avec les honoraires en jours de la référence (DT12)", async () => {
    const { decoupage, reference } = await enCabinet(async (db) => ({
      decoupage: await joursDecoupageParCleDemo(db, regie()),
      reference: versionDeReference(await chargerVersions(db, regie())),
    }));
    const trier = (l: { cle: string; centiemes: number }[]) =>
      [...l].sort((a, b) => a.cle.localeCompare(b.cle));
    expect(trier(decoupage)).toEqual([
      { cle: "grade:junior", centiemes: 1600 },
      { cle: "grade:manager", centiemes: 800 },
      { cle: "grade:senior", centiemes: 3200 },
    ]);
    const honoraires = (reference?.lignes ?? [])
      .filter((l) => l.nature === "honoraires" && l.jours !== null)
      .map((l) => ({
        cle: l.cle.replace(/^honoraires:/, ""),
        centiemes: versCentiemes(l.jours ?? 0),
      }));
    expect(trier(honoraires)).toEqual(trier(decoupage));
  });

  it("feuilles existantes : semaines saisies par la fixture seulement", async () => {
    const premiere = ajouterJours(LUNDI, -56);
    const troisieme = ajouterJours(premiere, 14);
    await enCabinet(async (db) => {
      expect(await feuilleExisteDemo(db, demo.consultant.collaborateurId, premiere)).toBe(true);
      expect(await feuilleExisteDemo(db, demo.junior.collaborateurId, troisieme)).toBe(true);
      expect(await feuilleExisteDemo(db, demo.consultant.collaborateurId, LUNDI)).toBe(false);
    });
  });

  it("factures : ouverte avec son solde, dernières émissions ; soldée, elle est écartée", async () => {
    const emission = ajouterJours(LUNDI, -45);
    const forfait = demo.missionForfait.id;
    await enCabinet(async (db) => {
      const ouvertes = await lireFacturesOuvertesDemo(db, LUNDI, 10);
      expect(ouvertes.map((o) => o.facture.id)).toEqual([demo.factureAncienneId]);
      expect(ouvertes[0]?.facture.date_emission).toBe(emission);
      expect(ouvertes[0]?.solde.devise).toBe("XOF");
      expect(ouvertes[0]?.solde.valeur).toBeGreaterThan(0);
      expect(await lireFacturesOuvertesDemo(db, emission, 10)).toEqual([]);
      expect(await derniereEmissionExerciceDemo(db, Number(emission.slice(0, 4)))).toBe(emission);
      expect(await derniereEmissionExerciceDemo(db, 2099)).toBeNull();
      const dernieres = await dernieresFacturesParMissionDemo(db, [forfait, regie()]);
      expect(dernieres).toEqual({ [forfait]: emission });
      expect(await dernieresFacturesParMissionDemo(db, [])).toEqual({});
    });
    const lue = await demo.gestionnaire.get(`/api/factures/${demo.factureAncienneId}`);
    const net = lue.json().net_a_payer as number;
    const reglement = await demo.gestionnaire.post("/api/finance/encaissements", {
      client_id: lue.json().client_id,
      date: ajouterJours(emission, 10),
      montant: net,
      mode: "virement",
      reference: "VIR-TEST-SOCLE",
      imputations: [{ facture_id: demo.factureAncienneId, montant: net }],
    });
    attendre(201, reglement, "encaissement intégral");
    expect(await enCabinet((db) => lireFacturesOuvertesDemo(db, LUNDI, 10))).toEqual([]);
  });
});
