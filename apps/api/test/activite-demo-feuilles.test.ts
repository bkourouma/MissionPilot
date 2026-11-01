import {
  ajouterJours,
  atterrissageDemo,
  capacite,
  listerJoursOuvres,
  lundiDeLaSemaine,
  PARAMETRES_ACTIVITE_DEMO,
  versCentiemes,
} from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lireActeursDemo } from "../src/activite-demo/acteurs.js";
import { contexteActiviteDemo } from "../src/activite-demo/commun.js";
import { maintenirDeriveDemo, missionsPourDeriveDemo } from "../src/activite-demo/derive.js";
import { genererFeuillesSemaineDemo, tachesCapaciteDemo } from "../src/activite-demo/feuilles.js";
import { lireSemaineDemo } from "../src/activite-demo/lecture.js";
import { calculerSuiviMission, evaluerAlertes } from "../src/temps/suivi.js";
import {
  preparerCabinetDemo,
  retirerMarquesDemo,
  type CabinetDemoTest,
} from "./activite-demo-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";
import { preparerCabinet, type CabinetMissions } from "./missions-outils.js";
import { consultantAffecte, missionTemps } from "./temps-outils.js";

/*
 * Tâche « activite_demo », territoire des temps (§2.4, §3, DT5, DT6, DT9) : feuilles écrites,
 * soumises et validées par les fonctions de temps/feuilles.ts et les blocs miroirs des routes,
 * règle de capacité des tâches, feuille d'un visiteur laissée intacte, idempotence, mission tenue
 * dans la bande de dérive, et option `notifier: false` d'`evaluerAlertes`. Les fonctions sont
 * appelées dans la transaction du cabinet (contexte direct, sans worker), avec une horloge passée.
 * Fixture (activite-demo-outils.ts) : consultant et junior affectés à la mission en régie, feuilles
 * validées de L − 56 à L − 42 seulement (la semaine L et la suivante sont libres), aucune
 * déclaration de reste à faire (pas de dérive semée).
 */

const JOB = "00000000-0000-4000-8000-0000000000a4";
/** Mercredi d'un mois passé : la semaine du lundi 26 octobre 2026 est la dernière d'octobre. */
const DATE_REFERENCE = "2026-10-28";
const LUNDI = lundiDeLaSemaine(DATE_REFERENCE);
const SEMAINE = { debut: LUNDI, fin: ajouterJours(LUNDI, 6) };
const SEMAINE_VISITEUR = ajouterJours(LUNDI, 7);
const MAINTENANT = new Date(`${DATE_REFERENCE}T09:30:00Z`);

let ctx: Contexte;
let a: CabinetMissions;
let d: CabinetDemoTest;

const lire = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);
const compter = async (sql: string, params: unknown[]) =>
  ((await lire(sql, params))[0] as { n: number }).n;
const instant = (v: unknown) => (v as Date).toISOString();

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Alertes DT9");
  d = await preparerCabinetDemo(ctx, "Cabinet Feuilles Démo", { dateReference: DATE_REFERENCE });
}, 300_000);
afterAll(async () => {
  await retirerMarquesDemo();
  await ctx.fermer();
});

/** Étape A de la tâche (§2.3) pour la semaine `lundi`, sans mission en dérive. */
function semaine(lundi: string) {
  return ctx.db.withTenant(d.cabinetId, async (db) => {
    const c = await contexteActiviteDemo(db, d.cabinetId, JOB, MAINTENANT, lundi.slice(0, 7));
    const l = await lireSemaineDemo(db, d.cabinetId, lundi, PARAMETRES_ACTIVITE_DEMO);
    const taches = tachesCapaciteDemo(l, null);
    const avant = new Map(taches);
    const r = await genererFeuillesSemaineDemo(c, lundi, l, taches);
    return { ...r, bilan: c.bilan, l, avant, taches };
  });
}

async function idsFeuilles(lundi: string): Promise<string[]> {
  const r = await lire("SELECT id FROM feuilles_temps WHERE cabinet_id = $1 AND semaine = $2", [
    d.cabinetId,
    lundi,
  ]);
  return r.map((f) => f.id as string);
}

interface LigneLue {
  feuille_id: string;
  date: string;
  tache_id: string | null;
  centiemes: number;
}

async function lignesDe(feuilles: readonly string[]): Promise<LigneLue[]> {
  const r = await lire(
    `SELECT feuille_id, date::text AS date, tache_id, centiemes FROM lignes_temps
     WHERE feuille_id = ANY ($1::uuid[])`,
    [feuilles],
  );
  return r as LigneLue[];
}

/** Comptes des écritures du cabinet (idempotence, aucune notification ni e-mail). */
async function comptes(cabinetId: string): Promise<Record<string, number>> {
  const r = await lire(
    `SELECT
       (SELECT count(*)::int FROM feuilles_temps WHERE cabinet_id = $1) AS feuilles,
       (SELECT count(*)::int FROM lignes_temps WHERE cabinet_id = $1) AS lignes,
       (SELECT count(*)::int FROM feuille_validations WHERE cabinet_id = $1) AS validations,
       (SELECT count(*)::int FROM reste_a_faire WHERE cabinet_id = $1) AS restes,
       (SELECT count(*)::int FROM journal_audit
         WHERE cabinet_id = $1 AND action LIKE 'activite\\_demo.%') AS marqueurs,
       (SELECT count(*)::int FROM notifications WHERE cabinet_id = $1) AS notifications,
       (SELECT count(*)::int FROM jobs WHERE cabinet_id = $1 AND type = 'envoyer_email') AS emails`,
    [cabinetId],
  );
  return r[0] as Record<string, number>;
}

describe("feuilles de la semaine (§2.4, D4, DT5, DT7)", () => {
  let premiere: Awaited<ReturnType<typeof semaine>>;
  let nouvelles: string[];

  it("écrit, soumet et valide une feuille complète par collaborateur, sans notification", async () => {
    const avant = await idsFeuilles(LUNDI);
    const comptesAvant = await comptes(d.cabinetId);
    premiere = await semaine(LUNDI);
    nouvelles = (await idsFeuilles(LUNDI)).filter((id) => !avant.includes(id));
    expect(nouvelles.length).toBeGreaterThan(0);
    expect(premiere.bilan.feuilles).toBe(nouvelles.length);
    expect(premiere.l.activiteInterneId).not.toBeNull();

    const feuilles = await lire(
      `SELECT f.id, f.statut, f.cycle, f.auteur_id, f.premiere_soumission_le, f.soumise_le,
         f.validee_le, c.utilisateur_id
       FROM feuilles_temps f JOIN collaborateurs c ON c.id = f.collaborateur_id
       WHERE f.id = ANY ($1::uuid[])`,
      [nouvelles],
    );
    for (const f of feuilles) {
      expect(f).toMatchObject({ statut: "validee", cycle: 1, auteur_id: f.utilisateur_id });
      for (const h of [f.premiere_soumission_le, f.soumise_le, f.validee_le]) {
        expect(instant(h)).toBe(MAINTENANT.toISOString());
      }
    }

    // Chaque partie est validée sur le cycle 1, par un autre que l'auteur, à l'heure de la tâche.
    const validations = await lire(
      `SELECT v.mission_id, v.decide_par, v.decide_le, v.cycle, v.decision, f.auteur_id
       FROM feuille_validations v JOIN feuilles_temps f ON f.id = v.feuille_id
       WHERE v.feuille_id = ANY ($1::uuid[])`,
      [nouvelles],
    );
    for (const v of validations) {
      expect(v).toMatchObject({ cycle: 1, decision: "validee" });
      expect(v.decide_par).not.toBe(v.auteur_id);
      expect(instant(v.decide_le)).toBe(MAINTENANT.toISOString());
    }
    expect(validations.some((v) => v.mission_id === null)).toBe(true);
    expect(validations.some((v) => v.mission_id !== null)).toBe(true);
    const missions = new Set(validations.flatMap((v) => (v.mission_id ? [v.mission_id] : [])));
    expect([...premiere.missionsTouchees].sort()).toEqual([...missions].sort());

    // Un marqueur par feuille, sans utilisateur, rattaché à la tâche.
    const marqueurs = await lire(
      `SELECT entite_id, utilisateur_id, details FROM journal_audit
       WHERE cabinet_id = $1 AND action = 'activite_demo.feuille' AND entite_id = ANY ($2::text[])`,
      [d.cabinetId, nouvelles],
    );
    expect(marqueurs).toHaveLength(nouvelles.length);
    for (const m of marqueurs) {
      expect(m.utilisateur_id).toBeNull();
      expect(m.details).toMatchObject({ job_id: JOB, semaine: LUNDI });
    }

    // Aucune notification ni e-mail : les alertes sont évaluées par la tâche, sans notification.
    const comptesApres = await comptes(d.cabinetId);
    expect(comptesApres.notifications).toBe(comptesAvant.notifications);
    expect(comptesApres.emails).toBe(comptesAvant.emails);
  });

  it("remplit chaque jour ouvré sans dépasser la capacité du jour (DT7)", async () => {
    const l = premiere.l;
    const ouverts = listerJoursOuvres(SEMAINE, l.calendrier);
    const jours = ouverts.filter((j) => !l.moisClotures.includes(j.slice(0, 7)));
    const lignes = await lignesDe(nouvelles);
    expect(lignes.every((x) => jours.includes(x.date))).toBe(true);
    const feuilles = await lire(
      "SELECT id, collaborateur_id FROM feuilles_temps WHERE id = ANY ($1::uuid[])",
      [nouvelles],
    );
    for (const f of feuilles) {
      const col = l.collaborateurs.find((x) => x.id === f.collaborateur_id);
      expect(col).toBeDefined();
      if (!col) continue;
      const absences = l.absences.get(col.id) ?? [];
      for (const jour of jours) {
        const cap = versCentiemes(
          capacite({ debut: jour, fin: jour }, l.calendrier, absences, col.capacitePct),
        );
        const total = lignes
          .filter((x) => x.feuille_id === f.id && x.date === jour)
          .reduce((t, x) => t + x.centiemes, 0);
        expect(total).toBeLessThanOrEqual(cap);
        expect(total % 50).toBe(0);
        if (cap >= 50) expect(total).toBeGreaterThan(0);
      }
    }
  });

  it("ne consomme jamais au-delà du budget libre d'une tâche hors dérive (DT5)", async () => {
    const ajoute = new Map<string, number>();
    for (const x of await lignesDe(nouvelles)) {
      if (x.tache_id) ajoute.set(x.tache_id, (ajoute.get(x.tache_id) ?? 0) + x.centiemes);
    }
    expect(ajoute.size).toBeGreaterThan(0);
    const parMission = new Map<string, number>();
    for (const [tacheId, n] of ajoute) {
      const t = premiere.avant.get(tacheId);
      expect(t).toBeDefined();
      if (!t) continue;
      expect(t.missionEnDerive).toBe(false);
      const libre = Math.max(0, t.budgetCentiemes - t.realiseCentiemes - t.attenteCentiemes);
      expect(n).toBeLessThanOrEqual(libre);
      // L'état de capacité passé en entrée est mis à jour en place.
      expect(premiere.taches.get(tacheId)?.planifieCentiemes).toBe(n);
      parMission.set(t.missionId, (parMission.get(t.missionId) ?? 0) + n);
    }
    // Temps par mission (choix du jalon) : consommations du moteur, égales aux lignes écrites.
    expect(Object.fromEntries(premiere.tempsParMission)).toEqual(Object.fromEntries(parMission));
  });

  it("une seconde exécution de la même semaine n'écrit rien (D4, idempotence)", async () => {
    const avant = await comptes(d.cabinetId);
    const s = await semaine(LUNDI);
    expect(s.bilan.feuilles).toBe(0);
    expect(s.missionsTouchees.size).toBe(0);
    expect(s.tempsParMission.size).toBe(0);
    expect(await comptes(d.cabinetId)).toEqual(avant);
  });

  it("laisse intacte la feuille en brouillon d'un visiteur (D4)", async () => {
    await ctx.db.withTenant(d.cabinetId, (db) =>
      db.query(
        `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
         VALUES ($1, $2, $3, $4) ON CONFLICT (cabinet_id, collaborateur_id, semaine) DO NOTHING`,
        [d.cabinetId, d.junior.collaborateurId, d.junior.utilisateurId, SEMAINE_VISITEUR],
      ),
    );
    const etat = async () => {
      const r = await lire(
        `SELECT f.id, f.statut, f.cycle, f.modifie_le,
           (SELECT count(*)::int FROM lignes_temps l WHERE l.feuille_id = f.id) AS lignes,
           (SELECT count(*)::int FROM feuille_validations v WHERE v.feuille_id = f.id) AS decisions
         FROM feuilles_temps f WHERE f.collaborateur_id = $1 AND f.semaine = $2`,
        [d.junior.collaborateurId, SEMAINE_VISITEUR],
      );
      return r[0];
    };
    const avant = await etat();
    expect(avant).toBeDefined();
    await semaine(SEMAINE_VISITEUR);
    expect(await etat()).toEqual(avant);
    const marqueurs = await compter(
      "SELECT count(*)::int AS n FROM journal_audit WHERE cabinet_id = $1 AND entite_id = $2",
      [d.cabinetId, avant.id],
    );
    expect(marqueurs).toBe(0);
  });
});

describe("mission en dérive (§3, DT6)", () => {
  const ecartPourMille = () =>
    ctx.db.withTenant(d.cabinetId, async (db) => {
      const acteurs = await lireActeursDemo(db, d.cabinetId);
      const l = await lireSemaineDemo(db, d.cabinetId, LUNDI, PARAMETRES_ACTIVITE_DEMO);
      const m = missionsPourDeriveDemo(l, acteurs).find((x) => x.missionId === d.missionRegie.id);
      return m ? atterrissageDemo(m).ecartPourMille : null;
    });

  const deriver = () =>
    ctx.db.withTenant(d.cabinetId, async (db) => {
      const c = await contexteActiviteDemo(db, d.cabinetId, JOB, MAINTENANT, LUNDI.slice(0, 7));
      const l = await lireSemaineDemo(db, d.cabinetId, LUNDI, PARAMETRES_ACTIVITE_DEMO);
      const mission = l.missions.find((m) => m.id === d.missionRegie.id);
      if (!mission) throw new Error("Mission en régie absente des lectures de la semaine.");
      await maintenirDeriveDemo(c, mission, LUNDI);
      return c.bilan;
    });

  const restes = () =>
    lire(
      `SELECT tache_id, collaborateur_id, semaine::text AS semaine, centiemes, declare_par,
         declare_le
       FROM reste_a_faire WHERE mission_id = $1 ORDER BY ordre`,
      [d.missionRegie.id],
    );

  const marqueursDerive = () =>
    compter(
      "SELECT count(*)::int AS n FROM journal_audit WHERE cabinet_id = $1 AND action = 'activite_demo.derive'",
      [d.cabinetId],
    );

  it("déclare le reste à faire de la paire porteuse et marque la mission (bande ]80 ; 160] ‰)", async () => {
    const avant = await restes();
    expect(await ecartPourMille()).not.toBeNull();
    const bilan = await deriver();
    expect(bilan.derive).toBe(d.missionRegie.id);
    const apres = await restes();
    expect(apres).toHaveLength(avant.length + 1);
    const ecrite = apres[apres.length - 1];
    expect(ecrite).toMatchObject({ semaine: LUNDI, declare_par: d.chef.utilisateurId });
    expect(instant(ecrite.declare_le)).toBe(MAINTENANT.toISOString());
    expect(ecrite.centiemes % 50).toBe(0);

    const ecart = (await ecartPourMille()) as number;
    expect(ecart).toBeGreaterThan(80);
    expect(ecart).toBeLessThanOrEqual(160);

    // Le marqueur mémorise la mission et la paire, sans montant ni utilisateur.
    const marque = await lire(
      `SELECT entite, entite_id, utilisateur_id, details FROM journal_audit
       WHERE cabinet_id = $1 AND action = 'activite_demo.derive' ORDER BY id DESC LIMIT 1`,
      [d.cabinetId],
    );
    expect(marque[0]).toMatchObject({
      entite: "mission",
      entite_id: d.missionRegie.id,
      utilisateur_id: null,
      details: {
        semaine: LUNDI,
        tache_id: ecrite.tache_id,
        collaborateur_id: ecrite.collaborateur_id,
        declaration: ecrite.centiemes,
        job_id: JOB,
      },
    });
    expect(JSON.stringify(marque[0].details)).not.toMatch(/montant|honoraires|cout|marge/);

    // Visible par le suivi : écart relatif au-delà de 5 % (badge des « Missions en vol »).
    const suivi = await ctx.db.withTenant(d.cabinetId, (db) =>
      calculerSuiviMission(db, d.cabinetId, d.missionRegie.id),
    );
    expect(suivi.arbre.suivi.ecartRelatif as number).toBeGreaterThan(0.05);
  });

  it("dans la bande, une nouvelle exécution n'écrit rien (état cible)", async () => {
    const avant = await restes();
    const marqueurs = await marqueursDerive();
    await deriver();
    expect(await restes()).toEqual(avant);
    expect(await marqueursDerive()).toBe(marqueurs);
  });
});

describe("evaluerAlertes : option notifier (DT9)", () => {
  const alertesNotifiees = (cabinetId: string) =>
    compter(
      "SELECT count(*)::int AS n FROM notifications WHERE cabinet_id = $1 AND type = 'alerte_suivi_budget'",
      [cabinetId],
    );

  /** Mission de 2 j budgétés, 10 j déclarés SANS la route (qui évaluerait déjà les alertes). */
  async function missionEnDepassement(intitule: string): Promise<string> {
    const m = await missionTemps(a, { Diagnostic: { senior: 2 } }, { intitule });
    const senior = await consultantAffecte(a, m, { Diagnostic: 2 });
    await ctx.db.withTenant(a.cabinetId, (db) =>
      db.query(
        `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine,
           centiemes, declare_par)
         VALUES ($1, $2, $3, $4, $5, 1000, $6)`,
        [
          a.cabinetId,
          m.id,
          m.taches.Diagnostic,
          senior.collaborateurId,
          m.debut,
          senior.utilisateurId,
        ],
      ),
    );
    return m.id;
  }

  it("notifier: false tient l'état des alertes à jour sans aucune notification", async () => {
    const missionId = await missionEnDepassement("Mission alertes sans notification");
    const avant = await alertesNotifiees(a.cabinetId);
    const creees = await ctx.db.withTenant(a.cabinetId, (db) =>
      evaluerAlertes(db, a.cabinetId, missionId, { notifier: false }),
    );
    expect(creees).toEqual([]);
    const alertes = await lire(
      "SELECT niveau, type, active FROM alertes_suivi WHERE mission_id = $1",
      [missionId],
    );
    expect(alertes).toContainEqual({
      niveau: "mission",
      type: "atterrissage_superieur_budget",
      active: true,
    });
    expect(await alertesNotifiees(a.cabinetId)).toBe(avant);
    // Alerte déjà active : une évaluation ultérieure par défaut (validation d'un visiteur) ne la
    // notifie pas, donc aucun e-mail de dérive.
    const ensuite = await ctx.db.withTenant(a.cabinetId, (db) =>
      evaluerAlertes(db, a.cabinetId, missionId),
    );
    expect(ensuite).toEqual([]);
    expect(await alertesNotifiees(a.cabinetId)).toBe(avant);
  });

  it("par défaut, le chef et le directeur sont notifiés avec e-mail (comportement inchangé)", async () => {
    const missionId = await missionEnDepassement("Mission alertes notifiées");
    const avant = await alertesNotifiees(a.cabinetId);
    const creees = await ctx.db.withTenant(a.cabinetId, (db) =>
      evaluerAlertes(db, a.cabinetId, missionId),
    );
    expect(creees.map((n) => n.destinataire_id).sort()).toEqual(
      [a.chef.utilisateurId, a.directeur.utilisateurId].sort(),
    );
    expect(creees.every((n) => n.email !== null)).toBe(true);
    expect(await alertesNotifiees(a.cabinetId)).toBe(avant + 2);
  });
});
