import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerCanalAlertesKpi } from "../src/canaux/alertes-kpi.js";
import { creerRegistre } from "../src/jobs/registre.js";
import { WorkerJobs } from "../src/jobs/worker.js";
import {
  creerHandlerSuiviKpi,
  planifierSuiviKpi,
  suivreKpis,
  TYPE_JOB_SUIVI_KPI,
} from "../src/kpi/suivi.js";
import { MailerJournal } from "../src/notifications/mailer.js";
import { MOT_DE_PASSE_TEST, proprietaire } from "./helpers.js";
import { creerKpi, mesurer } from "./kpi-outils.js";
import { attendre, inviterClient } from "./portail-outils.js";
import { destinataireInterne } from "./canaux-internes-outils.js";
import {
  demarrerCanaux,
  destinataireVerifie,
  entrant,
  executerJobs,
  preparerCabinetCanaux,
  type CabinetCanaux,
  type ContexteCanaux,
} from "./canaux-outils.js";

/*
 * Lot 3c, O-26 : (a) une valeur reçue par messagerie puis REPRISE par le cabinet est comptée par le
 * suivi des KPI comme n'importe quelle mesure (seuil, « MESURE_EN_RETARD », rappel), avec sa
 * provenance lisible à part ; (b) alertes de KPI SORTANTES par WhatsApp vers les responsables internes
 * (gabarit `alerte_kpi`, sans valeur chiffrée, désactivées par défaut, jamais bloquantes).
 * Fournisseurs simulés : la boîte du simulateur est la seule sortie.
 */

const HISTORIQUE = [50, 56, 45, 58, 48, 54, 47, 55];
const DELAI = {
  unite: "jours",
  perspective: "clients",
  sens: "plus_bas_mieux",
  nature: "stock",
  alerte_haut: 60,
  cible: 45,
} as const;

/*
 * Dates dérivées de l'horloge (le déclencheur de 0160_kpi.sql refuse une mesure datée du futur) :
 * le mois de référence est le mois PRÉCÉDENT (« septembre » dans la lecture historique du test), le
 * jour de suivi est le 15 du mois courant ; l'historique couvre les huit mois qui précèdent.
 */
const MAINTENANT = new Date();
function mois(decalage: number): { cle: string; premier: string; dernier: string } {
  const d = new Date(Date.UTC(MAINTENANT.getUTCFullYear(), MAINTENANT.getUTCMonth() + decalage, 1));
  const cle = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return { cle, premier: `${cle}-01`, dernier: `${cle}-${String(fin).padStart(2, "0")}` };
}
const REF = mois(-1);
const CLE_REF = REF.cle;
const FIN_REF = REF.dernier;
const JOUR_SUIVI = `${mois(0).cle}-15`;

let ctx: ContexteCanaux;
let a: CabinetCanaux;
let b: CabinetCanaux;
const mailer = new MailerJournal();

beforeAll(async () => {
  ctx = await demarrerCanaux();
  a = await preparerCabinetCanaux(ctx, "Suivi KPI reçu");
  b = await preparerCabinetCanaux(ctx, "Alertes KPI sortantes");
}, 300_000);
afterAll(() => ctx.fermer());

/** KPI mensuel du cabinet, huit mesures mensuelles (le mois de référence n'est pas mesuré). */
async function kpiAvecHistorique(c: CabinetCanaux, libelle: string) {
  const k = await creerKpi(c.chef, c.missionId, {
    ...DELAI,
    libelle,
    proprietaire_id: c.chef.utilisateurId,
    frequence: "mensuelle",
    debut_suivi: mois(-1 - HISTORIQUE.length).premier,
  });
  for (const [i, v] of HISTORIQUE.entries()) {
    await mesurer(c.chef, k.id, `${mois(i - 1 - HISTORIQUE.length).cle}-28`, v);
  }
  return k.id;
}

const lignes = (sql: string, params: unknown[]) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);
const alertesDe = (kpiId: string) =>
  lignes("SELECT code, periode_cle FROM kpi_alertes WHERE kpi_id = $1 ORDER BY code, periode_cle", [
    kpiId,
  ]);
const rappelsDe = (kpiId: string) =>
  lignes("SELECT periode_cle FROM kpi_rappels WHERE kpi_id = $1", [kpiId]);
const notificationsDe = (utilisateurId: string, type: string) =>
  lignes("SELECT titre FROM notifications WHERE destinataire_id = $1 AND type = $2", [
    utilisateurId,
    type,
  ]);

async function executerSuivi(iso: string) {
  const maintenant = new Date(iso);
  await planifierSuiviKpi(ctx.db, maintenant);
  const worker = new WorkerJobs(ctx.db, {
    mailer,
    registre: creerRegistre({
      [TYPE_JOB_SUIVI_KPI]: creerHandlerSuiviKpi(() => ({ config: ctx.config })),
    }),
    horloge: () => maintenant,
  });
  for (let r = await worker.traiterUn(); r; r = await worker.traiterUn());
}

describe("(a) valeur reçue par messagerie, reprise par le cabinet : comptée comme toute saisie", () => {
  let recu: string;
  let temoin: string;
  let mesureRepriseId: string;

  it("la reprise lève le seuil, supprime le retard et le rappel ; le témoin non repris reste en retard", async () => {
    recu = await kpiAvecHistorique(a, "Délai reçu par message");
    temoin = await kpiAvecHistorique(a, "Délai témoin sans message");
    const contributeur = await inviterClient(ctx, a.associe, a.clientId, ["client_contributeur"]);
    const numero = "+2250000000071";
    const dest = await destinataireVerifie(ctx, a, contributeur.utilisateurId, "whatsapp", numero);
    attendre(
      200,
      await a.chef.put(`/api/kpi/${recu}/contributeurs`, {
        utilisateurs: [contributeur.utilisateurId],
      }),
      "contributeurs",
    );
    // Septembre : 65 jours, reçu par WhatsApp, confirmé par OUI, puis repris par le chef de mission.
    for (const texte of ["delai recu 65", "OUI"]) {
      attendre(200, await entrant(ctx, a.compteWhatsapp, numero, texte), "entrant");
      await executerJobs(ctx);
    }
    const prop = (
      await lignes(
        "SELECT id, statut FROM canaux_saisies_kpi WHERE destinataire_id = $1 ORDER BY cree_le DESC LIMIT 1",
        [dest],
      )
    )[0] as { id: string; statut: string };
    expect(prop.statut).toBe("confirmee");
    // Avant la reprise, rien n'est compté : aucune mesure de septembre.
    expect(await alertesDe(recu)).toEqual([]);
    const rep = await a.chef.post(`/api/canaux/saisies-kpi/${prop.id}/reprendre`, {
      date_mesure: FIN_REF,
    });
    attendre(200, rep, "reprise");
    mesureRepriseId = rep.json().mesure_id as string;
    // L'évaluation qui suit la reprise (apresSaisie) lève le seuil haut de septembre.
    expect(await alertesDe(recu)).toEqual([{ code: "SEUIL_HAUT", periode_cle: CLE_REF }]);

    // Tâche quotidienne : le KPI repris n'est pas en retard, n'a pas de rappel ; le témoin si.
    await executerSuivi(`${JOUR_SUIVI}T08:00:00Z`);
    expect(await alertesDe(recu)).toEqual([{ code: "SEUIL_HAUT", periode_cle: CLE_REF }]);
    expect(await rappelsDe(recu)).toEqual([]);
    expect(await alertesDe(temoin)).toEqual([{ code: "MESURE_EN_RETARD", periode_cle: CLE_REF }]);
    expect(await rappelsDe(temoin)).toEqual([{ periode_cle: CLE_REF }]);
    const rappels = await notificationsDe(a.chef.utilisateurId, "kpi_rappel_mesure");
    expect(rappels.map((n) => n.titre)).toEqual([
      `Mesure attendue pour le KPI « Délai témoin sans message » (${CLE_REF})`,
    ]);
  }, 90_000);

  it("appel direct de suivreKpis : même résultat, rien de recréé (idempotent)", async () => {
    const creees = await ctx.db.withTenant(a.cabinetId, (db) =>
      suivreKpis(db, a.cabinetId, JOUR_SUIVI, { kpiIds: [recu, temoin] }),
    );
    expect(creees).toEqual([]);
    expect(await alertesDe(recu)).toHaveLength(1);
  });

  it("provenance : la mesure reprise est d'origine « cabinet » et indique la saisie par texte", async () => {
    const m = await lignes("SELECT origine, commentaire FROM kpi_mesures WHERE id = $1", [
      mesureRepriseId,
    ]);
    expect(m[0]).toMatchObject({ origine: "cabinet" });
    expect(String(m[0]?.commentaire)).toContain("Reçu par WhatsApp");
    // Jointure de provenance : la mesure reprise est liée à sa saisie par texte, les autres non.
    const prov = await lignes(
      "SELECT m.id, s.origine FROM kpi_mesures m LEFT JOIN canaux_saisies_kpi s ON s.mesure_id = m.id AND s.statut = 'reprise' WHERE m.kpi_id = $1 ORDER BY m.date_mesure",
      [recu],
    );
    expect(prov.filter((l) => l.origine !== null)).toEqual([
      { id: mesureRepriseId, origine: "texte" },
    ]);
    expect(prov.length).toBe(HISTORIQUE.length + 1);
  });
});

describe("(b) alertes de KPI par WhatsApp vers les responsables internes", () => {
  let chefDest: string;
  const canal = () => creerCanalAlertesKpi(() => ({ config: ctx.config }));
  const boite = () =>
    ctx.whatsapp.boite.filter((m) => m.gabarit === "alerte_kpi" && m.numero === "+2250000000072");
  const envois = (destinataire: string) =>
    lignes(
      "SELECT gabarit, categorie, objet_type, statut, motif_blocage, cle FROM canaux_envois WHERE destinataire_id = $1 ORDER BY cree_le, id",
      [destinataire],
    );

  beforeAll(async () => {
    chefDest = await destinataireInterne(ctx, b, b.chef.utilisateurId, "+2250000000072");
  });

  it("option désactivée par défaut : une alerte est notifiée mais aucun message n'est mis en file", async () => {
    const k = await kpiAvecHistorique(b, "Délai option off");
    await mesurer(b.chef, k, FIN_REF, 66);
    expect(await alertesDe(k)).toEqual([{ code: "SEUIL_HAUT", periode_cle: CLE_REF }]);
    expect(await notificationsDe(b.chef.utilisateurId, "kpi_alerte")).toHaveLength(1);
    expect(await envois(chefDest)).toEqual([]);
    const comptes = await b.associe.get("/api/canaux/comptes");
    expect(comptes.json().elements[0].alerte_kpi).toBe(false);
  });

  it("option activée : alerte après saisie, message au responsable consentant, sans valeur ni libellé", async () => {
    attendre(
      200,
      await b.associe.put("/api/canaux/comptes/whatsapp", {
        alerte_kpi: true,
        mot_de_passe: MOT_DE_PASSE_TEST,
      }),
      "option",
    );
    const k = await kpiAvecHistorique(b, "Délai option on");
    // Directeur avec numéro vérifié mais sans consentement : rien pour lui.
    const sansConsentement = await destinataireInterne(
      ctx,
      b,
      b.directeur.utilisateurId,
      "+2250000000073",
      { consentement: false },
    );
    await mesurer(b.chef, k, FIN_REF, 67);
    const lignesEnvoi = await envois(chefDest);
    expect(lignesEnvoi).toHaveLength(1);
    expect(lignesEnvoi[0]).toMatchObject({
      gabarit: "alerte_kpi",
      categorie: "alerte",
      objet_type: "kpi_alerte",
      statut: "reserve",
    });
    expect(lignesEnvoi[0]?.cle).toMatch(/^kpi_alerte:[0-9a-f-]{36}:[0-9a-f-]{36}$/);
    expect(await envois(sansConsentement)).toEqual([]);
    await executerJobs(ctx);
    const recus = boite();
    expect(recus).toHaveLength(1);
    const texte = recus[0]?.texte ?? "";
    expect(texte).toContain("un indicateur de votre tableau de bord demande votre attention");
    expect(texte).toContain("/portail/");
    expect(texte).not.toMatch(/6[0-9]|option on|Délai/);
    expect((await envois(chefDest))[0]?.statut).toBe("accepte");
  });

  it("rejeu : la tâche quotidienne et un second passage n'envoient rien de plus", async () => {
    await executerSuivi(`${JOUR_SUIVI}T09:00:00Z`);
    await ctx.db.withTenant(b.cabinetId, (db) =>
      suivreKpis(db, b.cabinetId, JOUR_SUIVI, {
        canal: canal(),
        maintenant: new Date(`${JOUR_SUIVI}T09:30:00Z`),
      }),
    );
    await executerJobs(ctx);
    const apres = await envois(chefDest);
    // Une alerte de seuil (saisie) ; les KPI de septembre non mesurés ont chacun UN rappel.
    expect(apres.filter((e) => String(e.cle).startsWith("kpi_alerte:"))).toHaveLength(1);
    const encore = apres.length;
    await ctx.db.withTenant(b.cabinetId, (db) =>
      suivreKpis(db, b.cabinetId, JOUR_SUIVI, { canal: canal() }),
    );
    expect((await envois(chefDest)).length).toBe(encore);
  });

  it("rappel de mesure : un message au propriétaire interne, l'alerte de retard seule n'en ajoute pas", async () => {
    const k = await kpiAvecHistorique(b, "Délai rappel");
    const avant = (await envois(chefDest)).length;
    await ctx.db.withTenant(b.cabinetId, (db) =>
      suivreKpis(db, b.cabinetId, JOUR_SUIVI, {
        kpiIds: [k],
        canal: canal(),
        maintenant: new Date(`${JOUR_SUIVI}T10:00:00Z`),
      }),
    );
    expect(await alertesDe(k)).toEqual([{ code: "MESURE_EN_RETARD", periode_cle: CLE_REF }]);
    const nouveaux = (await envois(chefDest)).slice(avant);
    expect(nouveaux).toHaveLength(1);
    expect(nouveaux[0]?.cle).toMatch(/^kpi_rappel:/);
    expect(nouveaux[0]).toMatchObject({ gabarit: "alerte_kpi", categorie: "alerte" });
  });

  it("sans canal injecté, suivreKpis ne touche à aucun canal ; compte coupé : rien", async () => {
    const k = await kpiAvecHistorique(b, "Délai sans canal");
    const avant = (await envois(chefDest)).length;
    await ctx.db.withTenant(b.cabinetId, (db) =>
      suivreKpis(db, b.cabinetId, JOUR_SUIVI, { kpiIds: [k] }),
    );
    expect(await alertesDe(k)).toHaveLength(1);
    expect((await envois(chefDest)).length).toBe(avant);
    attendre(200, await b.associe.put("/api/canaux/comptes/whatsapp", { actif: false }), "coupure");
    const k2 = await kpiAvecHistorique(b, "Délai compte coupé");
    await ctx.db.withTenant(b.cabinetId, (db) =>
      suivreKpis(db, b.cabinetId, JOUR_SUIVI, { kpiIds: [k2], canal: canal() }),
    );
    expect(await alertesDe(k2)).toHaveLength(1);
    expect((await envois(chefDest)).length).toBe(avant);
  });

  it("le bloc canal ne fait jamais échouer le suivi : erreur applicative et erreur SQL absorbées", async () => {
    const k = await kpiAvecHistorique(b, "Délai erreur canal");
    const notifications = await ctx.db.withTenant(b.cabinetId, (db) =>
      suivreKpis(db, b.cabinetId, JOUR_SUIVI, {
        kpiIds: [k],
        canal: creerCanalAlertesKpi(() => {
          throw new Error("configuration indisponible");
        }),
      }),
    );
    expect(notifications.length).toBeGreaterThan(0);
    expect(await alertesDe(k)).toHaveLength(1);
    // Erreur SQL dans la transaction : le point de sauvegarde protège la suite.
    attendre(
      200,
      await b.associe.put("/api/canaux/comptes/whatsapp", {
        actif: true,
        mot_de_passe: MOT_DE_PASSE_TEST,
      }),
      "réactivation",
    );
    const suite = await ctx.db.withTenant(b.cabinetId, async (db) => {
      const n = await canal().alerter(db, {
        cabinetId: b.cabinetId,
        objetId: "pas-un-uuid",
        nature: "alerte",
        utilisateurIds: [b.chef.utilisateurId],
        maintenant: new Date(),
      });
      const ok = await db.query("SELECT 1 AS un");
      return { n, un: ok.rows[0].un as number };
    });
    expect(suite).toEqual({ n: 0, un: 1 });
  });
});
