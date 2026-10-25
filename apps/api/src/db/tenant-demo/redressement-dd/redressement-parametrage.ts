import type { ContexteTenantDemo } from "../contexte.js";
import { etape } from "./commun.js";
import {
  CODE_MODELE_BRASSERIE,
  INTITULE_MODELE_BRASSERIE,
  ITEMS_MODELE_V1,
  ITEMS_MODELE_V2,
  SEUILS_INDUSTRIE_V1,
  SEUILS_INDUSTRIE_V2,
  SEUILS_SERVICES_V1,
  SEUILS_SERVICES_V2,
  type SeuilsAlerte,
} from "./redressement-donnees-parametres.js";
import {
  acteurs,
  creer,
  dateModeleCree,
  dateSeuilsCrees,
  dateSeuilsPublies,
  dateVersionModeleCree,
  dateVersionModelePubliee,
  debutAppel,
  decider,
  lire,
  type Json,
} from "./redressement-outils.js";

/*
 * Paramétrage du cabinet pour le redressement, par les VRAIES routes et dans l'ordre de la vie du
 * cabinet (les dates de création et de publication sont remontées à leur jour fictif) :
 *
 * - seuils d'alerte (`redressement.parametrer`) : un expert métier rédige, un AUTRE expert métier
 *   ou un associé publie (séparation des tâches, doublée en base) ;
 * - modèle de check-list du cabinet : même séparation à la publication.
 *
 * Chaque fonction est une étape marquée : elle n'est jouée qu'une fois par cabinet. L'ordre
 * d'appel est celui de l'histoire (voir redressement.ts) : les scores d'alerte conservent
 * l'instantané des seuils en vigueur AU MOMENT du calcul.
 */

type Compte = "expert" | "expert2" | "associe" | "associe2";

async function rediger(
  ctx: ContexteTenantDemo,
  par: Compte,
  publieur: Compte,
  secteur: "industrie" | "services",
  seuils: SeuilsAlerte,
  motif: string,
  jourRedaction: string,
  jourPublication: string,
): Promise<void> {
  const a = acteurs(ctx);
  const debut = await debutAppel(ctx);
  const v = await creer(
    a[par],
    "/api/redressement/seuils",
    { secteur, seuils, motif },
    `seuils ${secteur}`,
  );
  await dateSeuilsCrees(ctx, secteur, debut, jourRedaction);
  const debutPub = await debutAppel(ctx);
  await decider(
    a[publieur],
    `/api/redressement/seuils/${v.id}/publication`,
    {},
    `publication des seuils ${secteur}`,
  );
  await dateSeuilsPublies(ctx, secteur, debutPub, jourPublication);
}

/** Mars 2025 : premiers seuils (industrie, services) et premier modèle de check-list du cabinet. */
export async function parametrerCabinet2025(ctx: ContexteTenantDemo): Promise<void> {
  await etape(ctx, "redressement:parametrage-2025", async () => {
    await rediger(
      ctx,
      "expert",
      "expert2",
      "industrie",
      SEUILS_INDUSTRIE_V1,
      "Seuils initiaux du secteur industriel, fixés d'après les normes sectorielles.",
      "2025-03-03",
      "2025-03-04",
    );
    await rediger(
      ctx,
      "expert",
      "expert2",
      "services",
      SEUILS_SERVICES_V1,
      "Seuils initiaux des services, repris des valeurs de référence du cabinet.",
      "2025-03-03",
      "2025-03-05",
    );
    const a = acteurs(ctx);
    const debut = await debutAppel(ctx);
    const modele = await creer(
      a.expert,
      "/api/redressement/checklists/modeles",
      {
        code: CODE_MODELE_BRASSERIE,
        intitule: INTITULE_MODELE_BRASSERIE,
        secteur: "industrie",
        items: ITEMS_MODELE_V1,
        motif: "Premier modèle du cabinet, tiré des missions de l'industrie des boissons.",
      },
      "modèle de check-list",
    );
    await dateModeleCree(ctx, CODE_MODELE_BRASSERIE, debut, "2025-03-06");
    const debutPub = await debutAppel(ctx);
    await decider(
      a.expert2,
      `/api/redressement/checklists/versions/${(modele.brouillon as Json).id}/publication`,
      {},
      "publication du modèle de check-list",
    );
    await dateVersionModelePubliee(ctx, CODE_MODELE_BRASSERIE, debutPub, "2025-03-07");
  });
}

/** Juin-juillet 2025 : recalibrage des seuils de l'industrie après la revue des premiers dossiers. */
export async function recalibrerIndustrie2025(ctx: ContexteTenantDemo): Promise<void> {
  await etape(ctx, "redressement:seuils-industrie-v2", async () => {
    await rediger(
      ctx,
      "expert2",
      "expert",
      "industrie",
      SEUILS_INDUSTRIE_V2,
      "Recalibrage après la revue des premiers dossiers : liquidité immédiate, autonomie et endettement.",
      "2025-06-30",
      "2025-07-01",
    );
  });
}

/** Février 2026 : version 2 du modèle de check-list (retour d'expérience des dossiers 2025). */
export async function reviserModele2026(ctx: ContexteTenantDemo): Promise<void> {
  await etape(ctx, "redressement:modele-v2", async () => {
    const a = acteurs(ctx);
    const modeles = await lire(a.associe2, "/api/redressement/checklists/modeles", "modèles");
    const modele = (modeles.modeles as Json[]).find((m) => m.code === CODE_MODELE_BRASSERIE);
    if (!modele) throw new Error("Modèle de check-list du cabinet introuvable.");
    const debut = await debutAppel(ctx);
    const version = await creer(
      a.associe2,
      `/api/redressement/checklists/modeles/${modele.id}/versions`,
      { items: ITEMS_MODELE_V2, motif: "Ajout du suivi des pertes de matières par lot." },
      "version 2 du modèle",
    );
    await dateVersionModeleCree(ctx, CODE_MODELE_BRASSERIE, debut, "2026-02-09");
    const debutPub = await debutAppel(ctx);
    await decider(
      a.expert,
      `/api/redressement/checklists/versions/${version.id}/publication`,
      {},
      "publication de la version 2 du modèle",
    );
    await dateVersionModelePubliee(ctx, CODE_MODELE_BRASSERIE, debutPub, "2026-02-12");
  });
}

/** Juin 2026 : seuils des services plus exigeants, publiés avant le début de la mission 7. */
export async function recalibrerServices2026(ctx: ContexteTenantDemo): Promise<void> {
  await etape(ctx, "redressement:seuils-services-v2", async () => {
    await rediger(
      ctx,
      "expert2",
      "associe",
      "services",
      SEUILS_SERVICES_V2,
      "Services à forte intensité de sous-traitance : liquidité et BFR suivis de plus près.",
      "2026-06-12",
      "2026-06-15",
    );
  });
}
