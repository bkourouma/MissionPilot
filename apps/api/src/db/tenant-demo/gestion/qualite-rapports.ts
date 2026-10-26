import { gardesRequises, type ClasseRisque, type EtapeGarde } from "@missionpilot/engines";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { acteurDe, type Acteur } from "../ia-qualite-standard/qualite-outils.js";
import type { Casting, MissionLue } from "./casting.js";
import { choisirActeurs, equipeDe, type Faites } from "./qualite-rapports-acteurs.js";
import {
  antidaterSuivi,
  decaler,
  fenetreDe,
  Fil,
  releveVide,
  type Releve,
} from "./qualite-rapports-dates.js";

/*
 * Signature des rapports des missions TERMINÉES (phase `gestion`, lot 2b) : chaque rapport généré
 * ouvre un suivi qualité de classe R2 resté au brouillon, ce qui bloque la clôture du contrôle
 * « Livrables signés ». Ce module mène chaque suivi de RAPPORT non signé (classe R2/R3) des missions
 * terminées jusqu'à la signature, par les VRAIES routes du circuit (`/api/qualite/**`) : vérification
 * de la définition de terminé, attestation de l'item manuel, parcours de revue de chaque acteur,
 * validations par étape, signature. Séparation des tâches jugée par le moteur de garde
 * (`choisirActeurs`). Les suivis des missions en cours ne sont pas touchés.
 *
 * Écart assumé : un rapport généré est toujours « brouillon » et aucune route ne le valide, alors
 * que la définition de terminé exige un contenu « valide » ; le statut du rapport est donc passé à
 * « valide » par SQL du propriétaire, juste avant la vérification (la revue qualité vaut validation).
 *
 * Reprise : un suivi signé est ignoré ; un suivi à moitié mené reprend là où il en est (l'état est
 * relu avant chaque étape). Dates : remontées à quelques jours ouvrés après la date du rapport,
 * avant la clôture fictive (fin de mission + 6 jours).
 */

interface SuiviLu {
  id: string;
  libelle: string;
  classe: ClasseRisque;
  statut: string;
  auteur_id: string | null;
  type_livrable: string;
  livrable_id: string;
  genere_le: Date | null;
}

interface Detail {
  suivi: { statut: string };
  elements: { id: string; vu_par_moi: boolean }[];
  definition: {
    satisfaite: boolean;
    bloquants: string[];
    items: { id: string; code: string; controle: string; statut: string }[];
  };
  validations: { etape: EtapeGarde; acteur_id: string }[];
}

const COMMENTAIRES_REVUE: Partial<Record<EtapeGarde, string>> = {
  validation_consultant: "Rapport relu, conforme aux travaux réalisés pendant la mission.",
  relecture_chef_mission: "Relecture du chef de mission : cohérence avec le périmètre vérifiée.",
  revue_second_expert: "Revue indépendante : chiffres rapprochés des sources.",
};
const ATTESTATION_IA =
  "Mention de contribution de l'IA conforme à la politique du cabinet (relue avant diffusion).";

async function lire(ctx: ContexteTenantDemo, cle: Acteur, id: string): Promise<Detail> {
  const r = await ctx.session(cle.cle).get(`/api/qualite/suivis/${id}`);
  attendre(200, r, "lecture du suivi qualité");
  return r.json() as Detail;
}

/** Parcours de revue d'un acteur (session + éléments vus), noté dans le relevé. Renvoie la fin. */
async function parcourir(
  ctx: ContexteTenantDemo,
  a: Acteur,
  suiviId: string,
  debut: string,
  releve: Releve,
  minutesParElement: number,
): Promise<string> {
  const s = ctx.session(a.cle);
  const restants = (await lire(ctx, a, suiviId)).elements.filter((e) => !e.vu_par_moi);
  if (restants.length === 0) return debut;
  const ouverte = await s.post(`/api/qualite/suivis/${suiviId}/sessions`);
  attendre(200, ouverte, "session de revue");
  const sessionId = (ouverte.json() as { session: { id: string } }).session.id;
  const duree = Math.max(12, Math.round(6 + restants.length * minutesParElement));
  for (const [k, e] of restants.entries()) {
    attendre(200, await s.post(`/api/qualite/suivis/${suiviId}/elements/${e.id}/vu`), "élément vu");
    releve.vus.push({
      element: e.id,
      utilisateur: a.id,
      le: decaler(debut, Math.floor(((k + 1) * duree) / (restants.length + 1))),
    });
  }
  attendre(200, await s.post(`/api/qualite/sessions/${sessionId}/terminer`), "fin de session");
  const fin = decaler(debut, duree);
  releve.sessions.push({ utilisateur: a.id, debut, fin, duree: duree * 60 });
  return fin;
}

async function mener(
  ctx: ContexteTenantDemo,
  mission: MissionLue,
  suivi: SuiviLu,
  indice: number,
): Promise<void> {
  const alea = ctx.alea.deriver(`gestion-qualite-rapports:${mission.cle}:${suivi.id}`);
  const eq = await equipeDe(ctx, mission.id);
  const fenetre = fenetreDe(
    suivi.genere_le ?? new Date(`${mission.fin}T09:00:00Z`),
    mission.fin ?? ctx.aujourdhui,
  );
  if (fenetre.rapportTardif) {
    ctx.journal(
      `  « ${suivi.libelle} » (${mission.nom}) : rapport daté après la clôture fictive, circuit ramené avant elle.`,
    );
  }
  const garde = gardesRequises(suivi.classe);
  const nbEtapes = garde.etapes.length;
  const fil = new Fil(fenetre, alea, 4 + nbEtapes);
  const ouverture = fil.ouverture();
  const releve = releveVide();
  const debutReel = (await ctx.proprietaire.query<{ t: Date }>("SELECT clock_timestamp() AS t"))
    .rows[0]!.t;

  let d = await lire(ctx, eq.chef, suivi.id);
  const faites: Faites = {};
  for (const v of d.validations) faites[v.etape] = v.acteur_id;
  const roles = choisirActeurs(ctx, eq, suivi.classe, suivi.auteur_id, faites, fenetre.jours[0]!);
  const relecteur =
    roles.relecture_chef_mission ?? acteurDe(ctx, faites.relecture_chef_mission ?? null) ?? eq.chef;

  // 1. Contenu validé (écart assumé, voir l'en-tête), puis vérification de la définition de terminé.
  if (suivi.type_livrable === "rapport" && d.suivi.statut !== "valide") {
    await ctx.proprietaire.query(
      "UPDATE rapports_mission SET statut = 'valide' WHERE id = $1 AND statut = 'brouillon'",
      [suivi.livrable_id],
    );
  }
  const sRel = ctx.session(relecteur.cle);
  if (
    d.suivi.statut === "brouillon" ||
    (d.suivi.statut === "en_revue" && !d.definition.satisfaite)
  ) {
    releve.verification = fil.suivant();
    attendre(200, await sRel.post(`/api/qualite/suivis/${suivi.id}/verification`), "vérification");
    d = await lire(ctx, relecteur, suivi.id);
  }
  // 2. Attestation des items manuels par un relecteur qui n'est pas l'auteur.
  if (d.suivi.statut === "en_revue") {
    for (const item of d.definition.items.filter(
      (i) =>
        (i.controle === "manuel" || i.statut === "non_evaluable") &&
        i.statut !== "atteste" &&
        i.statut !== "conforme",
    )) {
      const le = fil.suivant();
      const r = await sRel.post(
        `/api/qualite/suivis/${suivi.id}/verification/${item.id}/attestation`,
        { commentaire: ATTESTATION_IA },
      );
      attendre(200, r, `attestation ${item.code}`);
      releve.attestations.push({ item: item.id, le });
    }
    d = await lire(ctx, relecteur, suivi.id);
    if (!d.definition.satisfaite) {
      throw new Error(
        `« ${suivi.libelle} » : définition de terminé non satisfaite (${d.definition.bloquants.join(", ")}).`,
      );
    }
  }
  // 3. Étapes humaines de la garde (hors signature), chacune après le parcours complet de l'acteur.
  const parElement = 1 + alea.suivant();
  for (const etape of garde.etapes) {
    if (etape === "signature_directeur_mission") continue;
    const a = roles[etape];
    if (!a || faites[etape]) continue;
    const debut = fil.suivant();
    const fin = await parcourir(ctx, a, suivi.id, debut, releve, parElement);
    const le = decaler(fin, 3 + alea.entier(0, 6));
    const r = await ctx.session(a.cle).post(`/api/qualite/suivis/${suivi.id}/validations`, {
      etape,
      commentaire: COMMENTAIRES_REVUE[etape] ?? "Étape validée.",
    });
    attendre(200, r, `validation ${etape} par ${a.cle}`);
    releve.validations.push({ etape, le });
    fil.apres(le);
    releve.validationComplete = le;
  }
  d = await lire(ctx, relecteur, suivi.id);
  if (d.suivi.statut === "valide") {
    const sig = roles.signature_directeur_mission;
    if (!sig) throw new Error(`« ${suivi.libelle} » : pas de signataire.`);
    const debut = fil.suivant();
    const fin = await parcourir(ctx, sig, suivi.id, debut, releve, parElement);
    const le = decaler(fin, 4 + alea.entier(0, 8));
    const r = await ctx.session(sig.cle).post(`/api/qualite/suivis/${suivi.id}/signature`, {
      commentaire: "Rapport validé, signé avant remise au client.",
    });
    attendre(200, r, `signature par ${sig.cle}`);
    releve.signature = le;
    if (
      releve.validations.length > 0 &&
      Date.parse(le) <= Date.parse(releve.validations.at(-1)!.le)
    )
      throw new Error("Chronologie incohérente : signature avant validation.");
  }
  const finReel = (await ctx.proprietaire.query<{ t: Date }>("SELECT clock_timestamp() AS t"))
    .rows[0]!.t;
  await antidaterSuivi(ctx, suivi.id, releve, ouverture, debutReel, finReel);
  const dernier = releve.signature ?? releve.validationComplete ?? "";
  if (dernier && dernier.slice(0, 10) > fenetre.limite) {
    ctx.journal(
      `  « ${suivi.libelle} » : dernier acte le ${dernier} après la limite ${fenetre.limite}.`,
    );
  }
  ctx.journal(`  mission « ${mission.nom} » : « ${suivi.libelle} » signé (n°${indice}).`);
}

/** Mène à la signature les suivis R2/R3 non signés des 5 missions terminées. */
export async function signerRapportsTerminees(
  ctx: ContexteTenantDemo,
  casting: Casting,
): Promise<void> {
  for (const mission of Object.values(casting.missions)) {
    if (!mission?.terminee) continue;
    if (mission.statut === "cloturee") {
      ctx.journal(
        `  mission « ${mission.nom} » déjà clôturée : suivis qualité laissés tels quels.`,
      );
      continue;
    }
    const r = await ctx.proprietaire.query<SuiviLu>(
      `SELECT q.id, q.libelle, q.classe, q.statut, q.auteur_id, q.type_livrable, q.livrable_id,
              rm.genere_le
         FROM qualite_suivis q
         LEFT JOIN rapports_mission rm ON q.type_livrable = 'rapport' AND rm.id = q.livrable_id
        WHERE q.cabinet_id = $1 AND q.mission_id = $2 AND q.classe IN ('R2', 'R3')
          AND q.type_livrable = 'rapport'
          AND q.statut <> 'signe'
        ORDER BY rm.genere_le NULLS FIRST, q.ouvert_le, q.id`,
      [ctx.cabinetId, mission.id],
    );
    let n = 0;
    for (const suivi of r.rows) await mener(ctx, mission, suivi, ++n);
  }
}
