import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleCompte } from "../cles.js";
import { methodeCabinet, methodeStandard, versionPubliee } from "./standard-aide.js";

/*
 * Comité méthode (STD-12) : propositions d'évolution du standard. Droits réels : `standard.gerer`
 * (associés et experts métier) pour proposer, relire et publier ; un consultant de mission
 * transmet ses idées à un expert, qui les consigne. Circuit : proposée, en revue (relecteur autre
 * que l'auteur), acceptée ou refusée (avis motivé), publiée (version publiée du cabinet portant la
 * méthode visée ; jamais par l'auteur sauf associé). Rejouable : clé = titre.
 */

type Cible = "proposee" | "en_revue" | "acceptee" | "refusee" | "publiee";
const RANG: Record<string, number> = {
  proposee: 0,
  en_revue: 1,
  acceptee: 2,
  refusee: 2,
  publiee: 3,
};

interface Proposition {
  titre: string;
  description: string;
  /** `standard:<code>`, code d'une méthode du cabinet, ou rien (nouvelle méthode). */
  methode?: string;
  auteur: CleCompte;
  cible: Cible;
  relecteur?: CleCompte;
  avis?: string;
  publieur?: CleCompte;
  /** Méthode du cabinet (code) et version publiée qui porte l'évolution. */
  version?: { code: string; numero: number };
}

export const PROPOSITIONS: Proposition[] = [
  {
    titre: "Volet risque de change dans le diagnostic flash",
    description:
      "Les PME qui importent leurs intrants subissent le change sans le mesurer. Proposition d'une brique optionnelle, activée quand le dirigeant déclare une exposition au change, pour la lire dès le diagnostic.",
    methode: "standard:diagnostic_flash",
    auteur: "expert.metier.2",
    cible: "publiee",
    relecteur: "expert.metier",
    avis: "Utile et peu coûteux : brique optionnelle, sans effet sur les autres.",
    publieur: "associe",
    version: { code: "diagnostic_flash_cabinet", numero: 1 },
  },
  {
    titre: "Analyse PESTEL et volet IFC dans le plan stratégique",
    description:
      "Les plans financés par des bailleurs exigent une lecture du contexte et la conformité aux normes de performance IFC. Proposition d'une analyse PESTEL et d'un volet IFC activé selon le bailleur.",
    methode: "standard:plan_strategique",
    auteur: "expert.metier",
    cible: "publiee",
    relecteur: "expert.metier.2",
    avis: "Accepté : la variante du cabinet porte déjà ces deux briques.",
    publieur: "associe.2",
    version: { code: "plan_strategique_cabinet", numero: 1 },
  },
  {
    titre: "Ratios de service de la dette dans le business plan bancable",
    description:
      "Les guichets de développement lisent d'abord la capacité de remboursement. Proposition d'ajouter à l'analyse historique une lecture du service de la dette, calculée par le moteur du plan.",
    methode: "standard:business_plan_bancable",
    auteur: "expert.metier",
    cible: "acceptee",
    relecteur: "expert.metier.2",
    avis: "Acceptée ; à remonter au comité méthode du standard, car la méthode est celle de MissionPilot.",
  },
  {
    titre: "Suppression de l'atelier unique de la notation",
    description:
      "L'atelier unique de restitution réduit la valeur des entretiens individuels. Proposition de le retirer de la méthode de notation.",
    methode: "standard:notation_entreprise",
    auteur: "associe.2",
    cible: "refusee",
    relecteur: "expert.metier",
    avis: "Refusée : l'atelier unique reste utile aux petites structures et se désactive déjà par défaut.",
  },
  {
    titre: "Mission de conformité au référentiel comptable SYSCOHADA révisé",
    description:
      "Plusieurs clients demandent un contrôle de la tenue des comptes avant une levée de fonds. Proposition d'un service dédié, à décrire avec ses étapes, ses livrables et ses gardes.",
    auteur: "expert.metier",
    cible: "proposee",
  },
  {
    titre: "Revue par un pair obligatoire pour les plans de plus de six mois",
    description:
      "Les plans longs dérivent entre le cadrage et la restitution. Proposition de rendre la revue par un pair obligatoire (classe R2) au-delà d'une certaine durée.",
    methode: "standard:plan_strategique",
    auteur: "expert.metier.2",
    cible: "en_revue",
    relecteur: "associe",
  },
  {
    titre: "Visite de site systématique en due diligence",
    description:
      "Le cabinet constate que les écarts les plus lourds apparaissent sur le terrain. Proposition d'activer la visite du site pour toute cible industrielle, quelle que soit sa situation.",
    methode: "due_diligence_cabinet",
    auteur: "associe",
    cible: "proposee",
  },
];

async function methodeId(ctx: ContexteTenantDemo, ref: string | undefined): Promise<string | null> {
  if (!ref) return null;
  if (ref.startsWith("standard:")) return (await methodeStandard(ctx, ref.slice(9))).id;
  const m = await methodeCabinet(ctx, ref);
  if (!m) throw new Error(`Méthode « ${ref} » introuvable.`);
  return m.id;
}

async function statutActuel(
  ctx: ContexteTenantDemo,
  titre: string,
): Promise<{ id: string; statut: string } | null> {
  const r = await ctx.proprietaire.query<{ id: string; statut: string }>(
    "SELECT id, statut FROM propositions_standard WHERE cabinet_id = $1 AND titre = $2",
    [ctx.cabinetId, titre],
  );
  return r.rows[0] ?? null;
}

export async function semerPropositions(ctx: ContexteTenantDemo): Promise<void> {
  for (const p of PROPOSITIONS) {
    const existante = await statutActuel(ctx, p.titre);
    let id = existante?.id ?? "";
    let statut = existante?.statut ?? "proposee";
    if (!existante) {
      const r = await ctx.session(p.auteur).post("/api/standard/propositions", {
        methode_id: await methodeId(ctx, p.methode),
        titre: p.titre,
        description: p.description,
      });
      attendre(201, r, `proposition « ${p.titre} »`);
      id = (r.json() as { id: string }).id;
    }
    const url = `/api/standard/propositions/${id}`;
    const relire = async (
      action: string,
      par: CleCompte,
      avis: string | undefined,
      suivant: string,
    ) => {
      const r = await ctx.session(par).post(`${url}/revue`, { action, avis });
      attendre(200, r, `revue « ${p.titre} » (${action})`);
      statut = suivant;
    };
    if ((RANG[p.cible] ?? 0) >= 1 && (RANG[statut] ?? 0) < 1 && p.relecteur) {
      await relire("prendre_en_revue", p.relecteur, undefined, "en_revue");
    }
    if (statut === "en_revue" && (p.cible === "acceptee" || p.cible === "publiee")) {
      await relire("accepter", p.relecteur!, p.avis, "acceptee");
    }
    if (statut === "en_revue" && p.cible === "refusee") {
      await relire("refuser", p.relecteur!, p.avis, "refusee");
    }
    if (statut === "acceptee" && p.cible === "publiee" && p.version && p.publieur) {
      const r = await ctx.session(p.publieur).post(`${url}/publication`, {
        version_id: await versionPubliee(ctx, p.version.code, p.version.numero),
      });
      attendre(200, r, `publication « ${p.titre} »`);
    }
  }
  ctx.journal("  propositions du comité méthode à jour.");
}
