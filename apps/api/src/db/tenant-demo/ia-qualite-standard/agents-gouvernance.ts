import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleCompte } from "../cles.js";
import { SCENARIOS_EXECUTION } from "./agents-scenarios.js";
import type { CleMission, MissionLot } from "./commun.js";
import { acteursMission } from "./ia-aide.js";

/*
 * Gouvernance du module « agents » : incidents d'autonomie signalés après les exécutions,
 * décisions d'un associé sur le niveau accordé, plafonds de coût IA par mission.
 *
 * Niveaux : une brique naît à N2 au plus (ou à son maximum si plus bas). Une promotion en N3
 * exige 50 exécutions NON dégradées acceptées (agents/autonomie.ts) : sans clé fournisseur,
 * toute exécution est en mode dégradé (gabarit), aucune brique n'est donc éligible et AUCUNE
 * promotion N3 n'est semée (on ne forge ni exécution « openrouter » ni événement). Les
 * décisions semées sont des abaissements et des remontées jusqu'à N2, par la route de décision.
 * Un incident majeur sur une brique N2 ne rétrograde pas (la rétrogradation automatique ne
 * vise que N3 et N4) : l'associé abaisse alors le niveau lui-même.
 */

type Auteur = "chef" | "directeur" | "associe" | "expert.metier";

interface IncidentSemis {
  brique: string;
  gravite: "mineur" | "majeur";
  par: Auteur;
  /** Exécution citée (identifiant de scénario), le cas échéant. */
  execution?: string;
  description: string;
}

const INCIDENTS: readonly IncidentSemis[] = [
  {
    brique: "section_rapport",
    gravite: "mineur",
    par: "directeur",
    execution: "red-gabon",
    description:
      "Ton trop promotionnel dans le brouillon et recommandations sans lien avec les constats du plan de trésorerie.",
  },
  {
    brique: "rapport_avancement",
    gravite: "mineur",
    par: "chef",
    execution: "avanc-teranga",
    description: "Le commentaire reprenait l'avancement de la semaine précédente.",
  },
  {
    brique: "lettre_mission",
    gravite: "majeur",
    par: "associe",
    execution: "lettre-sahel",
    description:
      "Une clause de limitation de responsabilité proposée ne correspondait pas au mandat : risque de reprise d'un modèle d'un autre dossier.",
  },
  {
    brique: "controle_qualite",
    gravite: "mineur",
    par: "chef",
    execution: "qual-baobab",
    description: "Contrôle lancé sur un livrable qui n'existait pas encore.",
  },
  {
    brique: "presentation",
    gravite: "majeur",
    par: "expert.metier",
    description:
      "Le gabarit de présentation reprenait un élément d'identité visuelle d'un autre client lors d'un essai interne.",
  },
];

const DECISIONS: readonly { brique: string; niveau: "N1" | "N2"; motif: string }[] = [
  {
    brique: "section_rapport",
    niveau: "N1",
    motif:
      "Deux retours négatifs de chefs de mission sur le ton des sections : retour à la suggestion à la demande le temps de reprendre le gabarit.",
  },
  {
    brique: "lettre_mission",
    niveau: "N1",
    motif:
      "Incident majeur sur une clause de limitation de responsabilité : suggestion à la demande seulement jusqu'à la révision des modèles de lettre.",
  },
  {
    brique: "section_rapport",
    niveau: "N2",
    motif:
      "Gabarit corrigé et échantillon de sections relu sans écart : retour au brouillon automatique, validation humaine obligatoire.",
  },
];

/** Compte qui signale : chef ou directeur de la mission de l'exécution citée, sinon le rôle nommé. */
async function auteur(
  ctx: ContexteTenantDemo,
  par: Auteur,
  mission: MissionLot | undefined,
): Promise<CleCompte> {
  if (par === "associe" || par === "expert.metier") return par;
  const acteurs = mission ? await acteursMission(ctx, mission) : null;
  if (!acteurs) throw new Error("Chef et directeur de la mission introuvables.");
  return par === "chef" ? acteurs.chef : acteurs.directeur;
}

async function incidents(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
  executions: Record<string, string>,
): Promise<void> {
  for (const i of INCIDENTS) {
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM autonomie_incidents WHERE cabinet_id = $1 AND description = $2",
      [ctx.cabinetId, i.description],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const scenario = SCENARIOS_EXECUTION.find((s) => s.id === i.execution);
    const executionId = i.execution ? executions[i.execution] : undefined;
    if (i.execution && !executionId) continue;
    const cle = await auteur(ctx, i.par, scenario ? missions[scenario.mission] : undefined);
    attendre(
      201,
      await ctx.session(cle).post(`/api/agents/briques/${i.brique}/incidents`, {
        gravite: i.gravite,
        description: i.description,
        ...(executionId ? { execution_id: executionId } : {}),
      }),
      `incident ${i.brique}`,
    );
  }
}

async function decisions(ctx: ContexteTenantDemo): Promise<void> {
  for (const d of DECISIONS) {
    const deja = await ctx.proprietaire.query(
      `SELECT 1 FROM autonomie_evenements e JOIN agents_briques b ON b.id = e.brique_id
        WHERE e.cabinet_id = $1 AND b.brique_code = $2 AND e.motif = $3`,
      [ctx.cabinetId, d.brique, d.motif],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    attendre(
      200,
      await ctx.session("associe").post(`/api/agents/briques/${d.brique}/decisions`, {
        niveau: d.niveau,
        motif: d.motif,
      }),
      `décision d'autonomie ${d.brique}`,
    );
  }
}

/**
 * Plafond de coût IA par mission (PUT par l'associé) : 1,8 fois le coût déjà constaté, arrondi
 * au dixième de dollar (jamais sous 0,6 USD), donc sous le seuil d'alerte de 80 %. Mission signée
 * non démarrée : plafond fixé à la signature. `modifie_le` est ramené au premier usage.
 */
async function plafonds(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
): Promise<void> {
  const associe = ctx.session("associe");
  for (const cle of Object.keys(missions) as CleMission[]) {
    const m = missions[cle]!;
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM agents_plafonds_mission WHERE mission_id = $1",
      [m.id],
    );
    if ((deja.rowCount ?? 0) > 0) continue;
    const c = await ctx.proprietaire.query<{ total: string; premier: string | null }>(
      `SELECT coalesce(sum(cout_micro_usd), 0)::text AS total, min(cree_le)::text AS premier
         FROM ia_consommations WHERE mission_id = $1`,
      [m.id],
    );
    const total = Number(c.rows[0]!.total);
    if (total === 0 && cle !== "plan-sicafe-export") continue;
    const plafond =
      total === 0 ? 1_000_000 : Math.max(600_000, Math.ceil((total * 1.8) / 100_000) * 100_000);
    attendre(
      200,
      await associe.put(`/api/agents/missions/${m.id}/plafond`, { plafond_micro_usd: plafond }),
      `plafond ${m.intitule}`,
    );
    if (c.rows[0]!.premier) {
      await ctx.proprietaire.query(
        "UPDATE agents_plafonds_mission SET modifie_le = $1 WHERE mission_id = $2",
        [c.rows[0]!.premier, m.id],
      );
    }
  }
}

export async function semerGouvernance(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
  executions: Record<string, string>,
): Promise<void> {
  await incidents(ctx, missions, executions);
  await decisions(ctx);
  await plafonds(ctx, missions);
}
