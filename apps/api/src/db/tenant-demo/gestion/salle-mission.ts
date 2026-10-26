import { ajouterJours } from "@missionpilot/engines";
import type { CleClient } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import {
  CLIENT_DE_MISSION,
  MISSIONS_EN_COURS,
  MISSIONS_TERMINEES,
  type Casting,
  type CleMission,
  type MissionLue,
} from "./casting.js";
import { MODELES_SALLE, SCENARIOS_SALLE, type DemandeSalleDef } from "./donnees-salle.js";
import { ok } from "./outils.js";
import { sessionDe } from "./rapports-outils.js";
import { ouvrirDeposants } from "./salle-comptes.js";
import { amenerPiece, ciblesDuProfil, type EnvPieces, type PieceVue } from "./salle-pieces.js";
import { jourReel, poserEcheance, relancerSiBesoin } from "./salle-relances.js";

/*
 * MODULE SALLE DE MISSION de la phase `gestion` du Tenant démo (CLI-01) : modèles de demandes du
 * cabinet, puis, pour les 5 missions terminées et les 4 en cours, un scénario de demandes de
 * pièces au client. Les demandes sont préparées et envoyées par l'équipe (chef de mission), les
 * pièces déposées par le client avec les sessions du PORTAIL, accusées automatiquement, acceptées
 * ou rejetées par l'équipe, relancées si elles sont en retard.
 *
 *  - missions TERMINÉES : tout est reçu, décidé (acceptée) et la demande close, de sorte que la
 *    clôture de la mission ne trouve aucune pièce en attente ;
 *  - missions EN COURS : un mélange (complètes, partielles, en retard avec 1 à 3 relances, en
 *    attente avec rappel, un brouillon non envoyé).
 *
 * Idempotent : une demande se retrouve par (mission, titre) ; chaque pièce est ramenée à son état
 * cible sans refaire ce qui est fait. Une mission clôturée est sautée (avertissement). LIMITE
 * assumée : les dépôts, accusés et décisions sont en ajout seul (déclencheurs) et gardent la date
 * réelle de l'exécution ; seules l'échéance des demandes et les relances sont à leur jour fictif.
 */

interface DemandeVue {
  id: string;
  statut: string;
  echeance: string | null;
  pieces: PieceVue[];
}

async function assurerModeles(ctx: ContexteTenantDemo): Promise<Map<string, string>> {
  const s = ctx.session("chef.mission");
  const liste = await s.get("/api/salle/modeles?archives=true");
  ok(200, liste, "liste des modèles de demandes");
  const ids = new Map<string, string>(
    (liste.json().elements as { id: string; nom: string }[]).map((m) => [m.nom, m.id]),
  );
  for (const m of MODELES_SALLE) {
    if (ids.has(m.nom)) continue;
    const r = await s.post("/api/salle/modeles", {
      nom: m.nom,
      description: m.description,
      pieces: m.pieces,
    });
    ok(201, r, `modèle « ${m.nom} »`);
    ids.set(m.nom, r.json().id as string);
  }
  return ids;
}

/** Échéance fictive : décalage depuis le début de la mission (terminée) ou depuis aujourd'hui. */
function echeanceCible(ctx: ContexteTenantDemo, m: MissionLue, def: DemandeSalleDef): string {
  const { depuis, jours } = def.echeance;
  if (depuis === "aujourdhui") return ctx.jour(jours);
  return ajouterJours(m.debut ?? ctx.aujourdhui, jours);
}

interface Equipe {
  chef: SessionDemo;
  decideurs: SessionDemo[];
}

function equipeDe(ctx: ContexteTenantDemo, m: MissionLue): Equipe | null {
  const chef = sessionDe(ctx, m.chefId);
  if (!chef) return null;
  const directeur = sessionDe(ctx, m.directeurId);
  return { chef, decideurs: directeur && directeur !== chef ? [chef, directeur] : [chef] };
}

async function lireSalle(chef: SessionDemo, missionId: string) {
  const r = await chef.get(`/api/missions/${missionId}/salle`);
  ok(200, r, "salle de la mission");
  return r.json() as { demandes: { id: string; titre: string; statut: string }[] };
}

/** Retrouve la demande par son titre ou la crée en brouillon (pièces du modèle puis pièces propres). */
async function assurerDemande(
  ctx: ContexteTenantDemo,
  m: MissionLue,
  chef: SessionDemo,
  def: DemandeSalleDef,
  modeles: Map<string, string>,
  existantes: { id: string; titre: string }[],
): Promise<string> {
  const trouvee = existantes.find((d) => d.titre === def.titre);
  if (trouvee) return trouvee.id;
  const modeleId = def.modele ? modeles.get(def.modele) : undefined;
  if (def.modele && !modeleId) throw new Error(`Modèle de demande introuvable : ${def.modele}`);
  const r = await chef.post(`/api/missions/${m.id}/salle/demandes`, {
    titre: def.titre,
    message: def.message,
    echeance: await jourReel(ctx),
    ...(modeleId ? { modele_id: modeleId } : {}),
    ...(def.extras.length > 0 ? { pieces: def.extras } : {}),
  });
  ok(201, r, `demande « ${def.titre} »`);
  return r.json().id as string;
}

async function lireDemande(chef: SessionDemo, missionId: string, id: string): Promise<DemandeVue> {
  const r = await chef.get(`/api/missions/${missionId}/salle/demandes/${id}`);
  ok(200, r, "lecture de la demande");
  return r.json() as DemandeVue;
}

async function jouerDemande(
  ctx: ContexteTenantDemo,
  m: MissionLue,
  equipe: Equipe,
  def: DemandeSalleDef,
  modeles: Map<string, string>,
  deposants: SessionDemo[],
  rang: number,
): Promise<number> {
  const { chef } = equipe;
  const existantes = (await lireSalle(chef, m.id)).demandes;
  const id = await assurerDemande(ctx, m, chef, def, modeles, existantes);
  let vue = await lireDemande(chef, m.id, id);
  if (def.profil === "brouillon") return 0;
  const echeance = echeanceCible(ctx, m, def);
  if (vue.statut === "brouillon") {
    ok(200, await chef.post(`/api/missions/${m.id}/salle/demandes/${id}/envoyer`, {}), "envoi");
    vue = await lireDemande(chef, m.id, id);
  }
  if (vue.statut === "envoyee" && vue.echeance?.slice(0, 10) !== echeance) {
    await poserEcheance(ctx, id, echeance);
  }
  if (vue.statut === "close") return 0;
  const env: EnvPieces = {
    ctx,
    missionId: m.id,
    missionNom: m.nom,
    demandeId: id,
    decideurs: equipe.decideurs,
    deposants,
  };
  const cibles = ciblesDuProfil(def.profil, vue.pieces.length);
  for (const [i, piece] of vue.pieces.entries()) {
    await amenerPiece(env, piece.id, cibles[i] ?? "demandee", rang + i);
  }
  const apres = await lireDemande(chef, m.id, id);
  if (apres.pieces.every((p) => p.statut === "acceptee")) {
    ok(200, await chef.post(`/api/missions/${m.id}/salle/demandes/${id}/cloturer`, {}), "clôture");
    return 0;
  }
  return relancerSiBesoin(ctx, m.id, id, echeance, chef);
}

export async function semerSalleMission(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  ctx.journal("[salle] modèles de demandes…");
  const modeles = await assurerModeles(ctx);
  const deposants = await ouvrirDeposants(ctx, casting);
  const cles: CleMission[] = [...MISSIONS_TERMINEES, ...MISSIONS_EN_COURS];
  let demandes = 0;
  let relances = 0;
  for (const cle of cles) {
    const m = casting.missions[cle];
    const defs = SCENARIOS_SALLE[cle] ?? [];
    if (!m || m.statut === "cloturee") {
      ctx.journal(`  [salle] ${cle} : mission absente ou clôturée, sautée.`);
      continue;
    }
    const equipe = equipeDe(ctx, m);
    const depots = deposants.get(CLIENT_DE_MISSION[cle] as CleClient) ?? [];
    if (!equipe || depots.length === 0) {
      ctx.journal(`  [salle] ${cle} : équipe ou déposant du client introuvable, sautée.`);
      continue;
    }
    for (const [i, def] of defs.entries()) {
      relances += await jouerDemande(ctx, m, equipe, def, modeles, depots, i * 7);
      demandes += 1;
    }
  }
  ctx.journal(`[salle] demandes traitées : ${demandes}, relances posées : ${relances}`);
}
