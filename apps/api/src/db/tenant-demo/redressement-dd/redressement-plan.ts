import type { ContexteTenantDemo } from "../contexte.js";
import type { Acteurs } from "./commun.js";
import {
  ECHELLE_IDENTITE,
  appeler,
  creer,
  dateAction,
  dateDecision,
  dater,
  debutAppel,
  decider,
  lire,
  uid,
  urlD,
  type Echelle,
  type Json,
} from "./redressement-outils.js";

/*
 * Plan de redressement en deux volets : actions (kanban), leviers chiffrés par le moteur, versions
 * de plan et validation. Exécution, par les routes, de définitions d'actions et de mouvements dans
 * le kanban, chacun antidaté à son jour. Un levier est chiffré à la CRÉATION de l'action par le
 * moteur de leviers, d'après le dernier état financier accepté du client (instantané conservé).
 * Une version de plan est un instantané construit par le serveur ; la validation revient au
 * directeur de la mission (compte différent du créateur de la version).
 */

export type Equipier = keyof Acteurs;

export interface ActionDef {
  titre: string;
  description?: string;
  volet: "quick_win" | "restructuration";
  domaine: "tresorerie" | "activite" | "exploitation" | "social" | "financement";
  echeance: string;
  responsable: Parameters<ContexteTenantDemo["session"]>[0];
  levier?: { code: string; parametres: Record<string, number> };
  creeLe: string;
  par: Equipier;
}

export interface MouvementDef {
  jour: string;
  /** Titre de l'action concernée. */
  action: string;
  par: Equipier;
  /** Déplacement dans le kanban. */
  statut?: "a_faire" | "en_cours" | "bloquee" | "terminee" | "abandonnee";
  motif?: string;
  /** Modification de contenu (action non terminée). */
  modification?: { echeance?: string; titre?: string; description?: string };
  commentaire?: string;
}

/** Identifiants des actions du dossier, par titre. */
export async function idsActions(
  a: Acteurs,
  dossierId: string,
): Promise<Map<string, { id: string; statut: string }>> {
  const plan = (await lire(a.chef, urlD(dossierId, "/plan"), "plan")) as {
    kanban: { colonnes: Record<string, Json[]>; abandonnees: Json[] };
  };
  const toutes: Json[] = [
    ...Object.values(plan.kanban.colonnes).flat(),
    ...plan.kanban.abandonnees,
  ];
  return new Map(
    toutes.map((x) => [x.titre as string, { id: x.id as string, statut: x.statut as string }]),
  );
}

/**
 * Un levier ne se chiffre que si le dernier état accepté du client est dans la devise du dossier
 * (celle de la mission) : sinon la route répond 409 RED_DEVISE_ETAT_DIFFERENTE.
 */
export async function leviersPossibles(a: Acteurs, dossierId: string): Promise<boolean> {
  const dossier = await lire(a.chef, urlD(dossierId), "dossier");
  const ratios = await lire(a.chef, urlD(dossierId, "/ratios"), "ratios");
  const dernier = (ratios.exercices as Json[])[0];
  return dernier !== undefined && dernier.devise === dossier.devise;
}

/** Paramètres de levier exprimés en montant (les autres : jours, points de base, mois). */
const CLES_MONETAIRES = new Set([
  "chargesFixesAnnuelles",
  "prixCession",
  "valeurComptableNette",
  "fraisEtImpots",
]);

function levierEchelonne(
  levier: NonNullable<ActionDef["levier"]>,
  echelle: Echelle,
): NonNullable<ActionDef["levier"]> {
  return {
    code: levier.code,
    parametres: Object.fromEntries(
      Object.entries(levier.parametres).map(([cle, v]) => [
        cle,
        CLES_MONETAIRES.has(cle) ? echelle(v) : v,
      ]),
    ),
  };
}

/** Crée les actions absentes ; les montants des leviers (XOF) passent par `echelle`. */
export async function creerActions(
  ctx: ContexteTenantDemo,
  a: Acteurs,
  dossierId: string,
  defs: readonly ActionDef[],
  echelle: Echelle = ECHELLE_IDENTITE,
): Promise<void> {
  const existantes = await idsActions(a, dossierId);
  const avecLevier = await leviersPossibles(a, dossierId);
  if (!avecLevier && defs.some((d) => d.levier)) {
    ctx.journal(
      "  leviers non chiffrés : la devise des états du client diffère de celle de la mission.",
    );
  }
  for (const d of defs) {
    if (existantes.has(d.titre)) continue;
    const debut = await debutAppel(ctx);
    await creer(
      a[d.par],
      urlD(dossierId, "/actions"),
      {
        titre: d.titre,
        ...(d.description ? { description: d.description } : {}),
        volet: d.volet,
        domaine: d.domaine,
        echeance: d.echeance,
        responsable_id: uid(ctx, d.responsable),
        ...(d.levier && avecLevier ? { levier: levierEchelonne(d.levier, echelle) } : {}),
      },
      `action « ${d.titre} »`,
    );
    await dater(ctx, dossierId, debut, d.creeLe, "red_actions", "red_action_evenements");
  }
}

/** Joue des mouvements du kanban (dans l'ordre donné, supposé chronologique). */
export async function jouerMouvements(
  ctx: ContexteTenantDemo,
  a: Acteurs,
  dossierId: string,
  mouvements: readonly MouvementDef[],
): Promise<void> {
  const ordonnes = [...mouvements].sort((x, y) => (x.jour < y.jour ? -1 : x.jour > y.jour ? 1 : 0));
  for (const m of ordonnes) {
    const action = (await idsActions(a, dossierId)).get(m.action);
    if (!action) throw new Error(`Action « ${m.action} » introuvable.`);
    const debut = await debutAppel(ctx);
    if (m.modification) {
      await appeler(
        a[m.par],
        "patch",
        `/api/redressement/actions/${action.id}`,
        m.modification,
        200,
        `modification de « ${m.action} »`,
      );
    }
    if (m.statut) {
      await decider(
        a[m.par],
        `/api/redressement/actions/${action.id}/deplacement`,
        {
          statut: m.statut,
          ...(m.motif ? { motif: m.motif } : {}),
          ...(m.statut === "terminee" ? { termine_le: m.jour } : {}),
        },
        `déplacement de « ${m.action} »`,
      );
    }
    if (m.commentaire) {
      await creer(
        a[m.par],
        `/api/redressement/actions/${action.id}/commentaires`,
        { commentaire: m.commentaire },
        `commentaire de « ${m.action} »`,
      );
    }
    await dater(ctx, dossierId, debut, m.jour, "red_action_evenements");
    await dateAction(ctx, action.id, m.jour);
  }
}

/** Nouvelle version de plan (brouillon), puis, si `validation`, validation par le directeur. */
export async function versionDePlan(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: Acteurs[Equipier],
  jourCreation: string,
  validation?: { par: Acteurs[Equipier]; jour: string; motif: string },
): Promise<string> {
  const debut = await debutAppel(ctx);
  const v = await creer(
    par,
    urlD(dossierId, "/plan/versions"),
    { date_reference: jourCreation },
    "version de plan",
  );
  await dater(ctx, dossierId, debut, jourCreation, "red_plan_versions");
  if (validation) {
    const t = await debutAppel(ctx);
    await decider(
      validation.par,
      `/api/redressement/plan/versions/${v.id}/validation`,
      { motif: validation.motif },
      "validation du plan",
    );
    await dateDecision(ctx, "plan_valide", dossierId, t, validation.jour);
  }
  return v.id as string;
}
