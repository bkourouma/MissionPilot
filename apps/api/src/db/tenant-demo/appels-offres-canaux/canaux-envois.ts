import { ajouterJours } from "@missionpilot/engines";
import { LIEN_ALERTE_KPI } from "../../../canaux/alertes-kpi.js";
import { mettreEnFileEnvoi, type DemandeEnvoi } from "../../../canaux/envois.js";
import { apercuSynthese, nomDuCabinet, variablesSynthese } from "../../../canaux/synthese.js";
import type { CleCompte } from "../cles.js";
import { corps, executerTaches, type ContexteCanaux } from "./canaux-contexte.js";
import type { Destinataires } from "./canaux-comptes.js";
import type { QuestionnairePret } from "./canaux-kpi.js";
import { lundiDe } from "../horloge.js";
import { sql } from "./outils.js";

/*
 * Journal d'envois du module « canaux » : relances de questionnaire, synthèses hebdomadaires du
 * dirigeant, statuts de remise, envois refusés. Tout passe par `mettreEnFileEnvoi` (consentement,
 * numéro vérifié, plafonds, coupe-circuit) puis par le handler `canal_envoi` exécuté ici contre le
 * simulateur : AUCUN envoi réel. Un envoi mis en file est ramené à sa date fictive tant qu'il est
 * « reserve » (le déclencheur MPH03 interdit toute modification d'un envoi terminé) et son
 * handler s'exécute à cette date : `accepte_le` / `termine_le` suivent. Les statuts « livré » et
 * « lu » arrivent par la route du simulateur (événement signé du webhook) : datés d'exécution.
 */

export interface EnvoiPlanifie {
  dest: CleCompte;
  /** Jour fictif voulu (ramené entre le jour d'envoi du questionnaire et aujourd'hui). */
  jour: string;
  heure: string;
  cle: string;
  gabarit: DemandeEnvoi["gabarit"];
  variables: readonly string[];
  objetType: DemandeEnvoi["objetType"];
  objetId: string;
  /** Statut de remise rapporté ensuite par le fournisseur simulé. */
  remise?: "livre" | "lu";
}

/** Met un envoi en file à sa date fictive. Renvoie l'envoi (null : aucun compte ou destinataire). */
export async function planifierEnvoi(cc: ContexteCanaux, dests: Destinataires, e: EnvoiPlanifie) {
  const destinataireId = dests.get(e.dest);
  if (!destinataireId) throw new Error(`Destinataire « ${e.dest} » absent.`);
  const jour = e.jour > cc.ctx.aujourdhui ? cc.ctx.aujourdhui : e.jour;
  const maintenant = new Date(`${jour}T${e.heure}Z`);
  const r = await cc.database.withTenant(cc.ctx.cabinetId, (db) =>
    mettreEnFileEnvoi(db, cc.trousseau, {
      cabinetId: cc.ctx.cabinetId,
      canal: "whatsapp",
      destinataireId,
      gabarit: e.gabarit,
      variables: e.variables,
      objetType: e.objetType,
      objetId: e.objetId,
      cle: e.cle,
      maintenant,
    }),
  );
  if (r && !r.existant && r.statut === "reserve") {
    await cc.ctx.proprietaire.query(
      "UPDATE canaux_envois SET cree_le = $1::timestamptz WHERE id = $2 AND statut = 'reserve'",
      [maintenant.toISOString(), r.id],
    );
  }
  return r;
}

/** Fait rapporter par le simulateur un statut de remise d'un envoi accepté (une seule fois). */
export async function rapporterRemise(
  cc: ContexteCanaux,
  cle: string,
  statut: "livre" | "lu",
): Promise<void> {
  const r = await sql<{ statut: string; id_externe: string | null }>(
    cc.ctx,
    "SELECT statut, id_externe FROM canaux_envois WHERE cabinet_id = $1 AND cle = $2",
    [cc.ctx.cabinetId, cle],
  );
  const e = r[0];
  if (!e?.id_externe) return;
  const attendu = statut === "lu" ? ["accepte", "livre"] : ["accepte"];
  if (!attendu.includes(e.statut)) return;
  corps(
    200,
    await cc.appel("associe", "POST", "/api/canaux/simulateur/entrant", {
      type: "statut",
      id_externe: e.id_externe,
      statut,
    }),
    `statut ${statut} de l'envoi ${cle}`,
  );
}

const jourMax = (a: string, b: string) => (a > b ? a : b);

/** Relances J+10 du questionnaire et synthèses hebdomadaires du dirigeant. */
export async function semerEnvoisHistoriques(
  cc: ContexteCanaux,
  dests: Destinataires,
  q: QuestionnairePret,
): Promise<void> {
  const cabinetId = cc.ctx.cabinetId;
  const nom = await cc.database.withTenant(cabinetId, (db) => nomDuCabinet(db, cabinetId));
  const planifies: EnvoiPlanifie[] = [];

  // Relances J+10 du questionnaire (SICAFÉ) : lecture par le dirigeant, simple remise pour l'autre.
  for (const [dest, remise] of [
    ["dirigeant.client", "lu"],
    ["contributeur.client", "livre"],
  ] as const) {
    const utilisateurId = cc.ctx.utilisateurs[dest] as string;
    planifies.push({
      dest,
      jour: jourMax("2026-09-21", q.envoyeLe),
      heure: "08:30:00",
      cle: `demo-canaux:relance:${q.id}:${utilisateurId}`,
      gabarit: "relance_questionnaire_j10",
      variables: [nom, `/portail/questionnaires/${q.id}`],
      objetType: "questionnaire_envoi",
      objetId: q.id,
      remise,
    });
  }

  // Synthèses hebdomadaires du dirigeant : message calculé par le moteur (deux nombres et un lien),
  // seulement si la synthèse n’est pas vide. Huit lundis étalés sur les six derniers mois.
  const dernierLundi = lundiDe(cc.ctx.aujourdhui);
  const lundis = [23, 19, 15, 11, 7, 3, 1, 0].map((n) => ajouterJours(dernierLundi, -7 * n));
  for (const dest of ["dirigeant.client", "dirigeant.client.2"] as const) {
    const utilisateurId = cc.ctx.utilisateurs[dest] as string;
    const client = await sql<{ client_id: string }>(
      cc.ctx,
      "SELECT client_id FROM utilisateurs_portail WHERE utilisateur_id = $1",
      [utilisateurId],
    );
    const clientId = client[0]?.client_id;
    if (!clientId) continue;
    // La série hebdomadaire n'est écrite qu'UNE fois (rejeu sans doublon, même si le contenu de la
    // synthèse change entre-temps) et seulement pour un consentement accordé, comme le job du lundi.
    const destId = dests.get(dest) as string;
    const serie = await sql(
      cc.ctx,
      "SELECT 1 FROM canaux_envois WHERE destinataire_id = $1 AND gabarit = 'synthese_hebdo' LIMIT 1",
      [destId],
    );
    const consent = await sql<{ statut: string }>(
      cc.ctx,
      "SELECT statut FROM canaux_consentements WHERE destinataire_id = $1 ORDER BY id DESC LIMIT 1",
      [destId],
    );
    if (serie.length > 0 || consent[0]?.statut !== "accorde") continue;
    const synthese = await cc.database.withTenant(cabinetId, (db) =>
      apercuSynthese(cc.database, db, {
        cabinetId,
        clientId,
        utilisateurId,
        date: cc.ctx.aujourdhui,
        origineWeb: new URL(cc.cfg.WEB_ORIGIN).origin,
      }),
    );
    if (synthese.synthese.vide) {
      cc.ctx.journal(`  canaux : synthèse de ${dest} vide, aucun message hebdomadaire.`);
      continue;
    }
    for (const [i, lundi] of lundis.entries()) {
      planifies.push({
        dest,
        jour: lundi,
        heure: "07:30:00",
        cle: `demo-canaux:synthese:${lundi}:${utilisateurId}`,
        gabarit: "synthese_hebdo",
        variables: variablesSynthese(nom, synthese.synthese),
        objetType: "synthese",
        objetId: dests.get(dest) as string,
        // Statuts de remise variés : lu, livré, ou simplement accepté par le fournisseur.
        ...(i % 3 === 2 ? {} : { remise: i % 3 === 0 ? ("lu" as const) : ("livre" as const) }),
      });
    }
  }

  planifies.sort((a, b) => `${a.jour}T${a.heure}`.localeCompare(`${b.jour}T${b.heure}`));
  // Chaque envoi est mené à son terme avant le suivant : les plafonds (3 par destinataire et par 24 h)
  // se comptent sur les lignes déjà inscrites, qui ne doivent donc être que plus anciennes.
  for (const e of planifies) {
    await planifierEnvoi(cc, dests, e);
    await executerTaches(cc);
  }
  for (const e of planifies) if (e.remise) await rapporterRemise(cc, e.cle, e.remise);
}

/**
 * Envois REFUSÉS en amont (journal « bloqué » avec son motif) : relance vers une personne qui a
 * retiré son consentement (STOP), alerte de KPI vers un responsable dont le numéro n'est pas vérifié.
 * À appeler après le STOP.
 */
export async function semerEnvoisBloques(
  cc: ContexteCanaux,
  dests: Destinataires,
  q: QuestionnairePret,
): Promise<void> {
  const cabinetId = cc.ctx.cabinetId;
  const nom = await cc.database.withTenant(cabinetId, (db) => nomDuCabinet(db, cabinetId));
  const maintenant = cc.ctx.aujourdhui;
  const alerte = await sql<{ id: string }>(
    cc.ctx,
    "SELECT id FROM kpi_alertes WHERE cabinet_id = $1 ORDER BY detectee_le DESC, id LIMIT 1",
    [cabinetId],
  );
  const dirigeant2 = cc.ctx.utilisateurs["dirigeant.client.2"] as string;
  const junior = cc.ctx.utilisateurs["consultant.junior"] as string;
  await planifierEnvoi(cc, dests, {
    dest: "dirigeant.client.2",
    jour: maintenant,
    heure: "09:00:00",
    cle: `demo-canaux:relance-apres-stop:${q.id}:${dirigeant2}`,
    gabarit: "relance_questionnaire_j10",
    variables: [nom, `/portail/questionnaires/${q.id}`],
    objetType: "questionnaire_envoi",
    objetId: q.id,
  });
  await planifierEnvoi(cc, dests, {
    dest: "consultant.junior",
    jour: maintenant,
    heure: "09:10:00",
    cle: `demo-canaux:alerte-numero-non-verifie:${junior}`,
    gabarit: "alerte_kpi",
    variables: [nom, LIEN_ALERTE_KPI],
    objetType: "kpi_alerte",
    objetId: alerte[0]?.id ?? q.id,
  });
}
