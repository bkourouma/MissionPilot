import { ajouterJours } from "@missionpilot/engines";
import type { TacheIa } from "@missionpilot/shared";
import { enregistrerConsommation } from "../../../ia/couts.js";
import { genererContenu } from "../../../ia/orchestrateur.js";
import { lireParametres, modeleDe } from "../../../ia/parametres.js";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { estWeekEnd, type Alea } from "../horloge.js";
import { CASTING, CLES_MISSIONS, type CleMission, type MissionLot } from "./commun.js";
import { acteursMission, authDe, depsIa, instant, nomClient } from "./ia-aide.js";
import { TEXTES_ESSAI, TEXTES_MISSION } from "./ia-donnees.js";

/*
 * Historique des demandes de génération (octobre 2024 à il y a trois semaines) du module « ia ».
 *
 * Chaque demande passe par l'ORCHESTRATEUR (`genererContenu`, le code des services), avec une
 * horloge fixée au jour fictif : la demande, sa version 1 « brouillon IA » et son horodatage
 * sont ceux du jour. Sans clé fournisseur, l'orchestrateur retombe sur le gabarit déterministe
 * (aucun appel réseau). Aucun contenu historique n'est modifié ni validé ici : seules les
 * relectures récentes (ia.ts) le sont, par les routes.
 *
 * COÛTS SIMULÉS DE DÉMONSTRATION — AUCUN APPEL RÉEL. Le cabinet n'a aucune clé fournisseur : toutes
 * les générations sont des gabarits (fournisseur « gabarit », coût 0 dans ia_generations, table en
 * ajout seul). Pour que l'écran des coûts soit renseigné, une consommation SIMULÉE (jetons tirés
 * à graine fixe, coût calculé au tarif connu du modèle routé par ia/modeles.ts) est inscrite par
 * `enregistrerConsommation` à la date de la demande, comme le ferait l'orchestrateur avec une clé
 * du cabinet. Règles : exactement UNE consommation par demande terminée (même mission, modèle de
 * la tâche, issue « succes » ou « sortie_invalide », cette dernière étant précisément le cas où le
 * gabarit prend le relais en comptant l'appel) ; les consommations « test » n'ont pas de demande ;
 * chaque mois civil reste sous 80 % du plafond mensuel (aucune alerte de plafond n'est semée) ;
 * aucune ligne ne dépasse la date de fin de sa mission (clôture simulée à fin + 6 jours).
 */

const PROMPTS_MISSION = [
  "synthese_comite",
  "compte_rendu_reunion",
  "analyse_risques",
  "reponse_demande_client",
  "classement_piece",
];
const PROMPTS_ESSAI = ["resume_neutre", "reformulation", "classification_tonalite"];
const AUTEURS_ESSAI: readonly CleCompte[] = [
  "consultant",
  "consultant.2",
  "consultant.junior",
  "consultant.junior.2",
  "expert.metier",
  "chef.mission.2",
  "directeur.mission.2",
];

const TACHE_PROMPT: Record<string, TacheIa> = {
  synthese_comite: "redaction",
  compte_rendu_reunion: "redaction",
  analyse_risques: "analyse",
  reponse_demande_client: "redaction",
  classement_piece: "classification",
  resume_neutre: "redaction",
  reformulation: "redaction",
  classification_tonalite: "classification",
};

interface Scenario {
  mission: MissionLot | null;
  prompt: string;
  acteur: CleCompte;
  jour: string;
  heure: number;
  minute: number;
  texte: string;
  tokensEntree: number;
  tokensSortie: number;
  dureeMs: number;
  issue: "succes" | "sortie_invalide";
}

const ouvre = (j: string): string => (estWeekEnd(j) ? ouvre(ajouterJours(j, 1)) : j);

function tirages(alea: Alea, prompt: string, essai: boolean) {
  const tache = TACHE_PROMPT[prompt] ?? "redaction";
  const grand = !essai && tache !== "classification";
  return {
    heure: alea.entier(7, 17),
    minute: alea.entier(0, 59),
    tokensEntree: essai
      ? alea.entier(500, 2400)
      : grand
        ? alea.entier(8000, 38000)
        : alea.entier(1500, 6000),
    tokensSortie: essai
      ? alea.entier(120, 600)
      : tache === "classification"
        ? alea.entier(60, 250)
        : alea.entier(800, 3200),
    dureeMs: alea.entier(1800, 16000),
    issue: alea.proba(0.1) ? ("sortie_invalide" as const) : ("succes" as const),
  };
}

/** Demandes rattachées aux missions du casting (hors missions pas encore démarrées). */
async function scenariosMissions(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
  alea: Alea,
): Promise<Scenario[]> {
  const sortie: Scenario[] = [];
  for (const cle of CLES_MISSIONS) {
    const m = missions[cle];
    const c = CASTING[cle];
    if (!m || c.etat === "signee" || c.etat === "preparation") continue;
    const acteurs = await acteursMission(ctx, m);
    if (!acteurs) continue;
    const client = await nomClient(ctx, m.clientId);
    const debut = ajouterJours(m.debut ?? c.debut, 4);
    const finMission = m.fin ?? c.fin;
    const fin = finMission < ctx.jour(-23) ? finMission : ctx.jour(-23);
    const duree = Math.max(1, Math.round((Date.parse(fin) - Date.parse(debut)) / 86_400_000));
    const n = Math.min(14, Math.max(5, Math.round(duree / 22)));
    for (let i = 0; i < n; i++) {
      const base = ajouterJours(debut, Math.round((duree * (i + 0.5)) / n) + alea.entier(-5, 5));
      const jour = ouvre(base > fin ? fin : base);
      const prompt = alea.choisir(PROMPTS_MISSION);
      const textes = TEXTES_MISSION[prompt]!;
      const acteur = alea.choisir([
        acteurs.chef,
        acteurs.chef,
        acteurs.chef,
        acteurs.directeur,
        "associe" as const,
      ]);
      sortie.push({
        mission: m,
        prompt,
        acteur,
        jour,
        texte: alea.choisir(textes).replaceAll("{client}", client),
        ...tirages(alea, prompt, false),
      });
    }
  }
  return sortie;
}

/** Essais des consultants avec les prompts « exemple » (sans mission), sur toute la période. */
function scenariosEssais(ctx: ContexteTenantDemo, alea: Alea): Scenario[] {
  const sortie: Scenario[] = [];
  const debut = "2024-11-18";
  const fin = ctx.jour(-23);
  const duree = Math.round((Date.parse(fin) - Date.parse(debut)) / 86_400_000);
  for (let i = 0; i < 24; i++) {
    const prompt = alea.choisir(PROMPTS_ESSAI);
    sortie.push({
      mission: null,
      prompt,
      acteur: alea.choisir(AUTEURS_ESSAI),
      jour: ouvre(ajouterJours(debut, Math.round((duree * (i + 0.5)) / 24) + alea.entier(-6, 6))),
      texte: alea.choisir(TEXTES_ESSAI),
      ...tirages(alea, prompt, true),
    });
  }
  return sortie;
}

/** Sème l'historique ; renvoie le nombre de demandes et de consommations créées. */
export async function semerHistorique(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
): Promise<{ demandes: number; consommations: number }> {
  const alea = ctx.alea.deriver("ia");
  const scenarios = [
    ...(await scenariosMissions(ctx, missions, alea)),
    ...scenariosEssais(ctx, alea),
  ];
  scenarios.sort(
    (a, b) => a.jour.localeCompare(b.jour) || a.heure - b.heure || a.minute - b.minute,
  );
  const params = await ctx.database.withTenant(ctx.cabinetId, (db) => lireParametres(db));
  let demandes = 0;
  let consommations = 0;
  for (const s of scenarios) {
    const quand = instant(s.jour, s.heure, s.minute);
    const auth = authDe(ctx, s.acteur);
    const deja = await ctx.proprietaire.query<{ id: string }>(
      `SELECT id FROM ia_demandes WHERE cabinet_id = $1 AND prompt_nom = $2 AND demandeur_id = $3
         AND cree_le = $4 AND mission_id IS NOT DISTINCT FROM $5`,
      [ctx.cabinetId, s.prompt, auth.utilisateurId, quand, s.mission?.id ?? null],
    );
    let demandeId = deja.rows[0]?.id;
    if (!demandeId) {
      const essai = s.mission === null;
      const r = await genererContenu(ctx.database, depsIa(ctx, quand), {
        promptNom: s.prompt,
        variables: { texte: s.texte },
        utilisateur: auth,
        ...(essai ? { exempleSeulement: true } : { entite: { missionId: s.mission!.id } }),
      });
      if (r.resultat.statut !== "terminee") {
        throw new Error(
          `Génération historique « ${s.prompt} » du ${s.jour} : ${r.resultat.statut}.`,
        );
      }
      demandeId = r.demandeId;
      demandes += 1;
    }
    const conso = await ctx.proprietaire.query(
      "SELECT 1 FROM ia_consommations WHERE cabinet_id = $1 AND demande_id = $2",
      [ctx.cabinetId, demandeId],
    );
    if ((conso.rowCount ?? 0) > 0) continue;
    const tache = TACHE_PROMPT[s.prompt] ?? "redaction";
    await ctx.database.withTenant(ctx.cabinetId, (db) =>
      enregistrerConsommation(
        db,
        {
          cabinetId: ctx.cabinetId,
          demandeId: demandeId!,
          missionId: s.mission?.id ?? null,
          tache,
          modele: modeleDe(params, tache),
          issue: s.issue,
          sourceCle: "cabinet",
          tokensEntree: s.tokensEntree,
          tokensSortie: s.tokensSortie,
          dureeMs: s.dureeMs,
        },
        params.plafond_mensuel_micro_usd,
        new Date(quand),
      ),
    );
    consommations += 1;
  }
  return { demandes, consommations };
}

/**
 * Complète les consommations SIMULÉES manquantes : une par demande terminée sans consommation
 * (relectures récentes, essais par les routes, exécutions d'agents). Appelée par les modules « ia »
 * et « agents ». Échoue si un mois dépasse 80 % du plafond mensuel du cabinet.
 */
export async function completerConsommations(ctx: ContexteTenantDemo): Promise<number> {
  const alea = ctx.alea.deriver("ia-conso");
  const params = await ctx.database.withTenant(ctx.cabinetId, (db) => lireParametres(db));
  const r = await ctx.proprietaire.query<{
    id: string;
    mission_id: string | null;
    tache: TacheIa;
    cree_le: Date;
  }>(
    `SELECT d.id, d.mission_id, d.tache, d.cree_le FROM ia_demandes d
      WHERE d.cabinet_id = $1 AND d.statut = 'terminee'
        AND NOT EXISTS (SELECT 1 FROM ia_consommations c WHERE c.demande_id = d.id)
      ORDER BY d.cree_le, d.id`,
    [ctx.cabinetId],
  );
  for (const d of r.rows) {
    const classification = d.tache === "classification";
    const tokensEntree = d.mission_id ? alea.entier(3000, 9000) : alea.entier(500, 2400);
    const tokensSortie = classification ? alea.entier(60, 250) : alea.entier(400, 1200);
    const dureeMs = alea.entier(1800, 16000);
    await ctx.database.withTenant(ctx.cabinetId, (db) =>
      enregistrerConsommation(
        db,
        {
          cabinetId: ctx.cabinetId,
          demandeId: d.id,
          missionId: d.mission_id,
          tache: d.tache,
          modele: modeleDe(params, d.tache),
          issue: "succes",
          sourceCle: "cabinet",
          tokensEntree,
          tokensSortie,
          dureeMs,
        },
        params.plafond_mensuel_micro_usd,
        d.cree_le,
      ),
    );
  }
  const mois = await ctx.proprietaire.query<{ m: string; total: string }>(
    `SELECT to_char(cree_le AT TIME ZONE 'UTC', 'YYYY-MM') AS m, sum(cout_micro_usd)::text AS total
       FROM ia_consommations WHERE cabinet_id = $1 GROUP BY 1`,
    [ctx.cabinetId],
  );
  for (const x of mois.rows) {
    if (Number(x.total) * 100 > params.plafond_mensuel_micro_usd * 80) {
      throw new Error(`Consommations simulées de ${x.m} au-dessus de 80 % du plafond mensuel.`);
    }
  }
  return r.rows.length;
}
