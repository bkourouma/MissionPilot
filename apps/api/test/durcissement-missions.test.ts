import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MailerJournal } from "../src/notifications/mailer.js";
import { api } from "./api.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import {
  creerMission,
  creerMissionSignee,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";

/*
 * Non-régression de l'audit de sécurité des missions, du budget et des
 * propositions : chaque test rejoue le scénario d'attaque relevé (E = élevé,
 * M = moyen, F = faible) et échouait avant le correctif.
 */

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let autreDirecteur: ApiUtilisateur;

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Durcissement A");
  b = await preparerCabinet(ctx, "Cabinet Durcissement B");
  autreDirecteur = await a.avecRoles(["directeur_mission"]);
});
afterAll(() => ctx.fermer());

type Ligne = Record<string, unknown> & { cle: string; nature: string };

/**
 * Mission budgétée à la main (comme test/budget.test.ts) : 10 j senior + 2 j
 * manager sur « Entretiens », 3 j du senior nommé sur « Analyse ».
 */
async function missionChiffree(c: CabinetMissions): Promise<{ id: string; entretiens: string }> {
  const m = await c.associe.post("/api/missions", {
    intitule: "Audit chiffré",
    client_id: c.clientId,
    mode_facturation: "forfait",
    directeur_id: c.directeur.utilisateurId,
    chef_id: c.chef.utilisateurId,
    date_debut: "2026-11-02",
  });
  const id = m.json().id as string;
  const phase = (await c.chef.post(`/api/missions/${id}/phases`, { libelle: "Diagnostic" })).json();
  const tache = async (libelle: string) =>
    (await c.chef.post(`/api/missions/${id}/taches`, { parent_id: phase.id, libelle })).json()
      .id as string;
  const entretiens = await tache("Entretiens");
  const analyse = await tache("Analyse");
  const budget = (tacheId: string, lignes: unknown[]) =>
    c.chef.put(`/api/missions/${id}/taches/${tacheId}/budget`, { lignes });
  expect(
    (
      await budget(entretiens, [
        { grade_id: c.grades.senior, jours: 10 },
        { grade_id: c.grades.manager, jours: 2 },
      ])
    ).statusCode,
  ).toBe(200);
  expect(
    (await budget(analyse, [{ collaborateur_id: c.collaborateurs.senior, jours: 3 }])).statusCode,
  ).toBe(200);
  return { id, entretiens };
}

/** Signature par un associé (seul à pouvoir saisir de la sous-traitance). */
async function signerParAssocie(c: CabinetMissions, id: string): Promise<{ id: string }> {
  const r = await c.associe.post(`/api/missions/${id}/signer`, { date_signature: "2026-10-01" });
  expect(r.statusCode).toBe(200);
  return r.json().budget_initial;
}

/** Lignes d'une version (vue complète d'un associé) au format de saisie. */
function enSaisie(lignes: Ligne[]): Record<string, unknown>[] {
  return lignes.map((l) => ({
    cle: l.cle,
    libelle: l.libelle,
    nature: l.nature,
    ...(l.grade_code ? { grade_code: l.grade_code } : {}),
    ...(l.jours !== null
      ? { jours: l.jours, prix_journalier: l.prix_journalier }
      : { montant_forfait: l.montant_forfait }),
    refacturable: l.refacturable,
  }));
}

async function lignesReference(c: CabinetMissions, id: string): Promise<Record<string, unknown>[]> {
  const budget = (await c.associe.get(`/api/missions/${id}/budget`)).json();
  const ref = budget.versions.find((v: { id: string }) => v.id === budget.reference_id);
  return enSaisie(ref.lignes);
}

async function opportunite(c: CabinetMissions): Promise<string> {
  const r = await c.chef.post("/api/opportunites", {
    client_id: c.clientId,
    intitule: "Plan stratégique Lagune",
    type_mission_id: c.typePlanId,
    montant_estime: 25_000_000,
  });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

async function proposition(c: CabinetMissions, opportuniteId?: string) {
  const o = opportuniteId ?? (await opportunite(c));
  const r = await c.chef.post(`/api/opportunites/${o}/propositions`, {});
  expect(r.statusCode).toBe(201);
  return r.json();
}

/** Fait avancer une proposition (statuts successifs, chacun par l'acteur autorisé). */
async function avancer(c: CabinetMissions, id: string, statuts: string[]) {
  for (const s of statuts) {
    const par = s === "validee" ? c.associe : c.chef;
    const r = await par.post(`/api/propositions/${id}/statut`, { statut: s });
    expect(r.statusCode, s).toBe(200);
  }
}

describe("E1 : fuite de coût par la comparaison des versions", () => {
  it("clé préfixée par la nature, ligne appariée masquée, message neutre", async () => {
    const { id, entretiens } = await missionChiffree(a);
    const initial = await signerParAssocie(a, id);
    // Le chef retire le manager : la révision recalculée n'a plus de coût « manager ».
    await a.chef.put(`/api/missions/${id}/taches/${entretiens}/budget`, {
      lignes: [{ grade_id: a.grades.senior, jours: 10 }],
    });
    const rev = await a.chef.post(`/api/missions/${id}/budget/revisions`, {
      motif: "Sans manager",
      depuis_decoupage: true,
    });
    expect(rev.statusCode).toBe(201);
    const url = `/api/missions/${id}/budget/versions/${rev.json().id}/lignes`;
    const pirate = (cle: string) =>
      a.chef.put(url, {
        lignes: [
          {
            cle,
            libelle: "Honoraires pirates",
            nature: "honoraires",
            jours: 1,
            prix_journalier: 1,
          },
        ],
      });
    // (a) Une clé « cout_interne:… » sur une ligne d'honoraires est refusée…
    const absente = await pirate("cout_interne:grade:manager");
    const presente = await pirate("cout_interne:grade:senior");
    expect(absente.statusCode).toBe(400);
    expect(presente.statusCode).toBe(400);
    // (c) … avec la même réponse, que la ligne de coût existe ou non.
    expect(presente.json().erreur.message).toBe(absente.json().erreur.message);
    expect(presente.body).not.toMatch(/cout_interne/);

    // (b) Ligne appariée déjà en base (données anciennes) : masquée sans finance.lire.
    await proprietaire((c) =>
      c.query(
        `INSERT INTO budget_lignes (cabinet_id, mission_id, version_id, cle, libelle, nature, jours,
           prix_journalier) VALUES ($1, $2, $3, 'cout_interne:grade:manager', 'Pirate', 'honoraires', 1, 1)`,
        [a.cabinetId, id, rev.json().id],
      ),
    );
    const q = `/api/missions/${id}/budget/comparaison?avant=${initial.id}&apres=${rev.json().id}`;
    const vueChef = (await a.chef.get(q)).json();
    expect(vueChef.lignes.map((l: Ligne) => l.cle)).not.toContain("cout_interne:grade:manager");
    expect(JSON.stringify(vueChef)).not.toMatch(/"montant_avant":300000/);
    const vueAssocie = (await a.associe.get(q)).json();
    expect(
      vueAssocie.lignes.find((l: Ligne) => l.cle === "cout_interne:grade:manager").montant_avant,
    ).toBe(2 * 150_000);
  });
});

describe("E2 : grille de taux de vente réservée à finance.lire", () => {
  it("proposition : ni taux ni prix par grade pour chef et directeur ; visibles de l'associé", async () => {
    const p = await proposition(a);
    // Réponse de génération au chef : déjà masquée.
    expect(p).not.toHaveProperty("taux");
    for (const u of [a.chef, a.directeur]) {
      const d = (await u.get(`/api/propositions/${p.id}`)).json();
      expect(d).not.toHaveProperty("taux");
      expect(d.chiffrage.honoraires_total).toBeGreaterThan(0);
      expect(d.chiffrage.jours_total).toBeGreaterThan(0);
      for (const g of d.chiffrage.par_grade) {
        expect(g).not.toHaveProperty("taux_journalier");
        expect(g).not.toHaveProperty("montant");
        expect(g.jours).toBeGreaterThan(0);
      }
    }
    const complet = (await a.associe.get(`/api/propositions/${p.id}`)).json();
    expect(complet.taux.senior).toBeGreaterThan(0);
    expect(complet.chiffrage.par_grade[0].taux_journalier).toBeGreaterThan(0);
    // Consultant et gestionnaire n'ont pas accès aux propositions (pipeline.gerer).
    for (const roles of [["consultant"], ["gestionnaire"]] as const) {
      const u = await a.avecRoles([...roles]);
      expect((await u.get(`/api/propositions/${p.id}`)).statusCode).toBe(403);
    }
  });

  it("budget : honoraires par grade et par collaborateur sans prix ni montant sans finance.lire", async () => {
    const { id } = await missionChiffree(a);
    const initial = await signerParAssocie(a, id);
    const consultant = await a.avecRoles(["consultant"]);
    await a.chef.post(`/api/missions/${id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    const gestionnaire = await a.avecRoles(["gestionnaire"]);
    for (const [nom, u, voit] of [
      ["chef", a.chef, false],
      ["directeur", a.directeur, false],
      ["consultant", consultant, false],
      ["associe", a.associe, true],
      ["gestionnaire", gestionnaire, true],
    ] as const) {
      const v = (await u.get(`/api/missions/${id}/budget`)).json().versions[0];
      const honoraires = v.lignes.filter((l: Ligne) => l.nature === "honoraires");
      expect(honoraires.length, nom).toBe(3);
      expect(
        honoraires.some((l: Ligne) => l.cle.startsWith("honoraires:collaborateur:")),
        nom,
      ).toBe(true);
      for (const l of honoraires) {
        expect("prix_journalier" in l, `${nom} ${l.cle}`).toBe(voit);
        expect("montant" in l, `${nom} ${l.cle}`).toBe(voit);
      }
    }
    // Le total des honoraires reste visible avec budget.lire_montants.
    const chef = (await a.chef.get(`/api/missions/${id}/budget`)).json().versions[0];
    expect(chef.synthese.honoraires).toBe(2_825_000);
    // Comparaison : pas de montant par ligne d'honoraires au taux d'un grade.
    const rev = (
      await a.chef.post(`/api/missions/${id}/budget/revisions`, { motif: "Reprise" })
    ).json();
    const q = `/api/missions/${id}/budget/comparaison?avant=${initial.id}&apres=${rev.id}`;
    const compChef = (await a.chef.get(q)).json();
    expect(compChef).toHaveProperty("ecart_honoraires");
    for (const l of compChef.lignes) expect(l).not.toHaveProperty("montant_avant");
    const compAssocie = (await a.associe.get(q)).json();
    expect(
      compAssocie.lignes.find((l: Ligne) => l.cle === "honoraires:grade:senior").montant_avant,
    ).toBe(10 * 175_000);
  });
});

describe("E3 : taux de change à la signature", () => {
  it("parité fixe imposée : un autre taux saisi est refusé", async () => {
    const xof = await creerMission(a);
    const r = await a.directeur.post(`/api/missions/${xof.id}/signer`, {
      date_signature: "2026-10-01",
      taux_change: 2,
    });
    expect(r.statusCode).toBe(400);
    const eur = await creerMission(a, { devise: "EUR" });
    const tauxVente = { associe: 90000, manager: 45000, senior: 30000, junior: 15000 };
    const faux = await a.directeur.post(`/api/missions/${eur.id}/signer`, {
      date_signature: "2026-10-01",
      taux_vente: tauxVente,
      taux_change: 700,
    });
    expect(faux.statusCode).toBe(400);
    const ok = await a.directeur.post(`/api/missions/${eur.id}/signer`, {
      date_signature: "2026-10-01",
      taux_vente: tauxVente,
      taux_change: 655.957,
    });
    expect(ok.json().mission.taux_change).toBe(655.957);
  });

  it("devise flottante : taux saisi par un associé, borné, inscrit au journal", async () => {
    const usd = await creerMission(a, { devise: "USD" });
    const url = `/api/missions/${usd.id}/signer`;
    const corps = {
      date_signature: "2026-10-01",
      taux_vente: { associe: 150000, manager: 75000, senior: 50000, junior: 25000 },
    };
    expect((await a.directeur.post(url, { ...corps, taux_change: 600 })).statusCode).toBe(403);
    expect((await a.associe.post(url, { ...corps, taux_change: 0.0000001 })).statusCode).toBe(400);
    const s = await a.associe.post(url, { ...corps, taux_change: 600 });
    expect(s.statusCode).toBe(200);
    expect(s.json().mission).toMatchObject({ devise: "USD", taux_change: 600 });
    const journal = await proprietaire(
      async (c) =>
        (
          await c.query(
            "SELECT details FROM journal_audit WHERE entite_id = $1 AND action = 'signature'",
            [usd.id],
          )
        ).rows,
    );
    expect(journal[0].details).toMatchObject({ taux_change: 600, devise_reference: "XOF" });
  });
});

describe("E4 : validation de révision, directeur désigné et signature", () => {
  it("signature : directeur désigné de la mission ou associé seulement", async () => {
    const m = await creerMission(a);
    const url = `/api/missions/${m.id}/signer`;
    expect((await autreDirecteur.post(url, { date_signature: "2026-10-01" })).statusCode).toBe(403);
    expect((await a.directeur.post(url, { date_signature: "2026-10-01" })).statusCode).toBe(200);
  });

  it("PATCH : seul un associé change le directeur de la mission", async () => {
    const m = await creerMission(a);
    const changer = { directeur_id: autreDirecteur.utilisateurId };
    expect((await a.directeur.patch(`/api/missions/${m.id}`, changer)).statusCode).toBe(403);
    // Renvoyer la même valeur (formulaire complet) reste permis.
    expect(
      (
        await a.directeur.patch(`/api/missions/${m.id}`, {
          directeur_id: a.directeur.utilisateurId,
        })
      ).statusCode,
    ).toBe(200);
    const ok = await a.associe.patch(`/api/missions/${m.id}`, changer);
    expect(ok.json().directeur_id).toBe(autreDirecteur.utilisateurId);
    const signee = await creerMissionSignee(a);
    expect((await a.directeur.patch(`/api/missions/${signee.id}`, changer)).statusCode).toBe(403);
  });

  it("validation : directeur d'une autre mission refusé ; auteur refusé sauf associé", async () => {
    const { id } = await creerMissionSignee(a);
    const revisions = `/api/missions/${id}/budget/revisions`;
    const rev = (await a.chef.post(revisions, { motif: "Ajustement" })).json();
    const valider = (versionId: string) =>
      `/api/missions/${id}/budget/versions/${versionId}/valider`;
    const refus = await autreDirecteur.post(valider(rev.id));
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    expect((await a.directeur.post(valider(rev.id))).statusCode).toBe(200);

    // Le directeur désigné ne valide pas sa propre révision.
    const sienne = (await a.directeur.post(revisions, { motif: "Ma révision" })).json();
    expect((await a.directeur.post(valider(sienne.id))).statusCode).toBe(403);
    expect((await a.associe.post(valider(sienne.id))).json()).toMatchObject({ figee: true });
    // Un associé valide la sienne.
    const parAssocie = (await a.associe.post(revisions, { motif: "Révision associé" })).json();
    expect((await a.associe.post(valider(parAssocie.id))).statusCode).toBe(200);
  });
});

describe("M1 : validation d'une proposition par un associé", () => {
  it("le directeur de mission ne valide plus ; l'associé si", async () => {
    const p = await proposition(a);
    const url = `/api/propositions/${p.id}/statut`;
    expect((await a.chef.post(url, { statut: "a_valider" })).statusCode).toBe(200);
    expect((await a.directeur.post(url, { statut: "validee" })).statusCode).toBe(403);
    expect((await a.directeur.post(url, { statut: "brouillon" })).statusCode).toBe(403);
    expect((await a.associe.post(url, { statut: "validee" })).json()).toMatchObject({
      statut: "validee",
      validee_par: a.associeId,
    });
  });
});

describe("M2 : seuils FIN-15 sur honoraires, coûts et marge, cumulés", () => {
  it("+15 M de sous-traitance à honoraires constants : associé requis", async () => {
    const { id } = await creerMissionSignee(a);
    const rev = await a.associe.post(`/api/missions/${id}/budget/revisions`, {
      motif: "Sous-traitance d'une enquête",
      lignes: [
        ...(await lignesReference(a, id)),
        { libelle: "Enquête nationale", nature: "sous_traitance", montant_forfait: 15_000_000 },
      ],
    });
    expect(rev.statusCode).toBe(201);
    const url = `/api/missions/${id}/budget/versions/${rev.json().id}/valider`;
    const refus = await a.directeur.post(url);
    expect(refus.statusCode).toBe(403);
    expect(refus.json().erreur.code).toBe("APPROBATION_REQUISE");
    expect((await a.associe.post(url)).json()).toMatchObject({ role_approbateur: "associe" });
  });

  it("deux révisions de +6 M : la seconde (+12 M depuis l'initial) exige un associé", async () => {
    const { id } = await creerMissionSignee(a);
    const base = await lignesReference(a, id);
    const reviser = async (montant: number) => {
      const r = await a.associe.post(`/api/missions/${id}/budget/revisions`, {
        motif: `Complément ${montant}`,
        lignes: [
          ...base,
          {
            cle: "honoraires:complement",
            libelle: "Complément",
            nature: "honoraires",
            montant_forfait: montant,
          },
        ],
      });
      expect(r.statusCode).toBe(201);
      return `/api/missions/${id}/budget/versions/${r.json().id}/valider`;
    };
    const premiere = await a.directeur.post(await reviser(6_000_000));
    expect(premiere.json()).toMatchObject({ role_approbateur: "directeur_mission" });
    const seconde = await reviser(12_000_000);
    expect((await a.directeur.post(seconde)).statusCode).toBe(403);
    expect((await a.associe.post(seconde)).json()).toMatchObject({ role_approbateur: "associe" });
  });
});

describe("M3 et F1 : documents de mission", () => {
  it("proposition et lettre : responsables (et mission.signer) ; mission clôturée : refus", async () => {
    const { id } = await creerMissionSignee(a);
    const url = `/api/missions/${id}/documents`;
    const consultant = await a.avecRoles(["consultant"]);
    await a.chef.post(`/api/missions/${id}/equipe`, { utilisateur_id: consultant.utilisateurId });
    const doc = (type: string) => ({ type, nom: `Document ${type}` });
    expect((await consultant.post(url, doc("lettre_de_mission"))).statusCode).toBe(403);
    expect((await consultant.post(url, doc("proposition"))).statusCode).toBe(403);
    expect((await consultant.post(url, doc("livrable"))).statusCode).toBe(201);
    expect((await a.chef.post(url, doc("lettre_de_mission"))).statusCode).toBe(403);
    expect((await a.chef.post(url, doc("proposition"))).statusCode).toBe(201);
    expect((await a.directeur.post(url, doc("lettre_de_mission"))).statusCode).toBe(201);
    // F1 : chemin de stockage libre refusé.
    for (const chemin of ["../../etc/passwd", "/etc/passwd", "file:///etc/passwd", "a\\b"]) {
      expect(
        (await a.chef.post(url, { ...doc("livrable"), chemin_stockage: chemin })).statusCode,
        chemin,
      ).toBe(400);
    }
    for (const s of ["en_cours", "a_cloturer"]) {
      await a.chef.post(`/api/missions/${id}/statut`, { statut: s });
    }
    expect((await a.directeur.post(`/api/missions/${id}/cloturer`)).statusCode).toBe(200);
    expect((await a.associe.post(url, doc("livrable"))).statusCode).toBe(409);
  });
});

describe("M4 et F5 : signature d'une mission issue d'une proposition", () => {
  it("taux divergents de la proposition et sous-traitance sans finance.lire refusés", async () => {
    const p = await proposition(a);
    await avancer(a, p.id, ["a_valider", "validee", "envoyee", "acceptee"]);
    const m = await a.associe.post(`/api/propositions/${p.id}/mission`, {
      directeur_id: a.directeur.utilisateurId,
      chef_id: a.chef.utilisateurId,
      date_debut: "2026-11-02",
    });
    expect(m.statusCode).toBe(201);
    const url = `/api/missions/${m.json().id}/signer`;
    const date = { date_signature: "2026-10-01" };
    expect((await a.directeur.post(url, { ...date, taux_vente: { senior: 1 } })).statusCode).toBe(
      400,
    );
    expect(
      (
        await a.directeur.post(url, {
          ...date,
          lignes_supplementaires: [{ nature: "sous_traitance", libelle: "Enquête", montant: 1 }],
        })
      ).statusCode,
    ).toBe(403);
    expect((await a.directeur.post(url, date)).statusCode).toBe(200);

    // F5 : proposition d'origine et mode de facturation figés après signature.
    const id = m.json().id as string;
    const autre = m.json().mode_facturation === "regie" ? "forfait" : "regie";
    expect(
      (await a.associe.patch(`/api/missions/${id}`, { mode_facturation: autre })).statusCode,
    ).toBe(409);
    for (const sql of [
      "UPDATE missions SET proposition_id = NULL WHERE id = $1",
      `UPDATE missions SET mode_facturation = '${autre}' WHERE id = $1`,
    ]) {
      await expect(
        ctx.db.withTenant(a.cabinetId, (db) => db.query(sql, [id])),
      ).rejects.toMatchObject({ code: "MPF01" });
    }
  });
});

describe("F3 : invitation résolue seulement si l'auteur est un associé actif du même cabinet", () => {
  const boite = () => ctx.app.mailer as MailerJournal;
  const inviter = async () => {
    const email = `durci-${Date.now()}-${Math.random().toString(36).slice(2)}@exemple.test`;
    const r = await a.associe.post("/api/invitations", { email, roles: ["consultant"] });
    expect(r.statusCode).toBe(201);
    const jeton = boite()
      .dernierPour(email)
      ?.texte.match(/#jeton=([\w-]+)/)?.[1];
    return { id: r.json().id as string, jeton };
  };
  const accepter = (jeton: string | undefined) =>
    api(ctx).post("/api/invitations/accepter", {
      jeton,
      nom: "Recrue",
      mot_de_passe: "un-mot-de-passe-long",
    });

  it("auteur absent ou d'un autre cabinet : refus", async () => {
    const sansAuteur = await inviter();
    await proprietaire((c) =>
      c.query("UPDATE invitations SET invite_par = NULL WHERE id = $1", [sansAuteur.id]),
    );
    expect((await accepter(sansAuteur.jeton)).statusCode).toBe(400);
    const etranger = await inviter();
    await proprietaire((c) =>
      c.query("UPDATE invitations SET invite_par = $2 WHERE id = $1", [etranger.id, b.associeId]),
    );
    expect((await accepter(etranger.jeton)).statusCode).toBe(400);
    expect((await accepter((await inviter()).jeton)).statusCode).toBe(201);
  });
});

describe("F4 : une version figée a un valideur", () => {
  it("figer sans valideur est refusé en base", async () => {
    const { id } = await creerMissionSignee(a);
    const rev = (await a.chef.post(`/api/missions/${id}/budget/revisions`, { motif: "X" })).json();
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query(
          "UPDATE budget_versions SET figee = true, date_figeage = current_date WHERE id = $1",
          [rev.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("F6 : utilisateurs inactifs", () => {
  it("ni membre d'une équipe de mission, ni responsable d'opportunité", async () => {
    const inactif = await a.avecRoles(["consultant"]);
    await proprietaire((c) =>
      c.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [inactif.utilisateurId]),
    );
    const m = await creerMission(a);
    expect(
      (await a.chef.post(`/api/missions/${m.id}/equipe`, { utilisateur_id: inactif.utilisateurId }))
        .statusCode,
    ).toBe(400);
    const corps = {
      client_id: a.clientId,
      intitule: "Opportunité",
      montant_estime: 1_000_000,
      responsable_id: inactif.utilisateurId,
    };
    expect((await a.chef.post("/api/opportunites", corps)).statusCode).toBe(400);
    const o = await opportunite(a);
    expect(
      (await a.chef.patch(`/api/opportunites/${o}`, { responsable_id: inactif.utilisateurId }))
        .statusCode,
    ).toBe(400);
  });
});

describe("F7 : acceptation d'une proposition", () => {
  it("opportunité close : refus ; une seule acceptée ; client figé après validation", async () => {
    // Opportunité perdue alors qu'une proposition était envoyée : plus d'acceptation.
    const perdue = await proposition(a);
    await avancer(a, perdue.id, ["a_valider", "validee", "envoyee"]);
    await a.chef.post(`/api/opportunites/${perdue.opportunite_id}/issue`, {
      statut: "perdue",
      motif_perte: "Prix",
    });
    expect(
      (await a.chef.post(`/api/propositions/${perdue.id}/statut`, { statut: "acceptee" }))
        .statusCode,
    ).toBe(409);

    // Deux versions envoyées de la même opportunité.
    const o = await opportunite(a);
    const p1 = await proposition(a, o);
    const p2 = (await a.chef.post(`/api/propositions/${p1.id}/nouvelle-version`)).json();
    await avancer(a, p1.id, ["a_valider", "validee", "envoyee"]);
    await avancer(a, p2.id, ["a_valider", "validee", "envoyee"]);

    // Client figé dès qu'une proposition est validée ou envoyée.
    const autreClient = (
      await a.associe.post("/api/clients", { raison_sociale: "Autre client durci" })
    ).json();
    expect(
      (await a.chef.patch(`/api/opportunites/${o}`, { client_id: autreClient.id })).statusCode,
    ).toBe(409);

    await avancer(a, p1.id, ["acceptee"]);
    // Opportunité rouverte à la main : la seconde acceptation reste refusée (code et base).
    await proprietaire((c) =>
      c.query(
        "UPDATE opportunites SET statut = 'ouverte', cloturee_le = NULL, probabilite = 50 WHERE id = $1",
        [o],
      ),
    );
    expect(
      (await a.chef.post(`/api/propositions/${p2.id}/statut`, { statut: "acceptee" })).statusCode,
    ).toBe(409);
    await expect(
      ctx.db.withTenant(a.cabinetId, (db) =>
        db.query("UPDATE propositions SET statut = 'acceptee' WHERE id = $1", [p2.id]),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("F9 : lire toutes les missions ne donne pas le droit de les modifier", () => {
  it("un chef qui est aussi responsable des ressources ne modifie pas la mission d'un autre", async () => {
    const m = await creerMission(a); // chef : a.chef
    const u = await a.avecRoles(["chef_mission", "ressources"]);
    expect((await u.get(`/api/missions/${m.id}`)).statusCode).toBe(200);
    expect((await u.post(`/api/missions/${m.id}/phases`, { libelle: "Intrus" })).statusCode).toBe(
      403,
    );
    expect((await u.patch(`/api/missions/${m.id}`, { bureau: "Intrus" })).statusCode).toBe(403);
  });
});
