import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { corps } from "./capitalisation-outils.js";
import { RETOURS_A } from "./donnees-cap-retours-a.js";
import { RETOURS_B } from "./donnees-cap-retours-b.js";
import type { RetourRedige, SectionsRetour } from "./donnees-cap-types.js";
import { chefDe, directeurDe, missionDuCasting, sql, type CleMissionCasting } from "./outils.js";

/*
 * Retour d'expérience (CAP-01) d'une mission « terminée » du casting.
 *
 * Les routes n'ouvrent un retour que pour une mission « à clôturer » ou « clôturée ». Les missions
 * du casting restent OUVERTES (`en_cours`) pendant les phases du seed : la mission passe donc en
 * « à clôturer » par la transition de route réversible, le retour est ouvert, rédigé et validé,
 * puis la mission est REMISE en `en_cours`. La clôture finale (phase « gestion ») rencontrera un
 * retour déjà ouvert : `ouvrirRetourALaCloture` ne recrée rien (ouverture idempotente) et un
 * retour validé n'empêche pas la clôture. Déjà « à clôturer » ou « clôturée » : statut inchangé.
 *
 * Reprise possible à chaque étape : version IA (gabarit simulé, sans clé ni réseau), version du
 * chef de mission, revue du directeur, puis validation par un associé distinct des rédacteurs.
 */

const REDACTIONS: Partial<Record<CleMissionCasting, RetourRedige>> = { ...RETOURS_A, ...RETOURS_B };

interface DetailRetour {
  id: string;
  statut: "brouillon" | "valide";
  ouvert_par: string;
  historique: { version: number; origine: string }[];
}

async function lireRetour(
  ctx: ContexteTenantDemo,
  missionId: string,
): Promise<DetailRetour | null> {
  const r = await ctx
    .session(await chefDe(ctx, missionId))
    .get(`/api/capitalisation/missions/${missionId}/retour`);
  const { retour } = corps<{ retour: DetailRetour | null }>(r, [200], "lecture du retour");
  return retour;
}

async function changerStatut(ctx: ContexteTenantDemo, missionId: string, statut: string) {
  corps(
    await ctx
      .session(await chefDe(ctx, missionId))
      .post(`/api/missions/${missionId}/statut`, { statut }),
    [200],
    `statut ${statut}`,
  );
}

async function travaillerRetour(
  ctx: ContexteTenantDemo,
  missionId: string,
  r: RetourRedige,
): Promise<void> {
  const chef = ctx.session(await chefDe(ctx, missionId));
  let retour = await lireRetour(ctx, missionId);
  if (!retour) {
    corps(await chef.post(`/api/capitalisation/missions/${missionId}/retour`), [201], "ouverture");
    retour = await lireRetour(ctx, missionId);
  }
  if (!retour) throw new Error("Retour d'expérience introuvable après ouverture.");
  const id = retour.id;
  // Version IA simulée : seulement si le retour n'a que son brouillon du gabarit.
  if (retour.historique.length < 2) {
    const ia = await chef.post(`/api/capitalisation/retours/${id}/ia`);
    if (ia.statusCode !== 201) {
      ctx.journal(
        `  capitalisation : génération IA indisponible (HTTP ${ia.statusCode}), gabarit conservé.`,
      );
    }
  }
  const apres = await lireRetour(ctx, missionId);
  const humaines = (apres?.historique ?? []).filter((v) => v.origine === "humain").length;
  const v3: SectionsRetour = { ...r.v2, ...r.v3 };
  // Rédacteurs et valideur : les personnes qui VOIENT la mission (son chef, son directeur) rédigent ;
  // un associé (voit tout) valide, distinct de l'ouvreur et des rédacteurs.
  const cleChef = await chefDe(ctx, missionId);
  const cleDirecteur = await directeurDe(ctx, missionId);
  const cleValideur: CleCompte =
    (["associe", "associe.2"] as const).find((k) => k !== cleChef && k !== cleDirecteur) ??
    r.valideur;
  const etapes: [number, CleCompte, SectionsRetour][] = [
    [0, cleChef, r.v2],
    [1, cleDirecteur, v3],
  ];
  for (const [rang, auteur, sections] of etapes) {
    if (humaines > rang) continue;
    const s = ctx.session(auteur);
    corps(await s.post(`/api/capitalisation/retours/${id}/versions`, sections), [201], "version");
  }
  const final = await lireRetour(ctx, missionId);
  const derniere = Math.max(...(final?.historique ?? []).map((v) => v.version));
  const valideur = ctx.session(cleValideur);
  if (
    valideur.utilisateurId === retour.ouvert_par ||
    cleValideur === cleChef ||
    cleValideur === cleDirecteur
  ) {
    throw new Error(
      "Le valideur du retour doit être distinct de son ouvreur et de ses rédacteurs.",
    );
  }
  corps(
    await valideur.post(`/api/capitalisation/retours/${id}/valider`, {
      version: derniere,
      acquitte_chiffres: false,
    }),
    [200],
    "validation du retour",
  );
}

/** Mène à son terme le retour d'expérience de la mission ; rend vrai si un travail a été fait. */
export async function traiterRetour(
  ctx: ContexteTenantDemo,
  cle: CleMissionCasting,
): Promise<boolean> {
  const redaction = REDACTIONS[cle];
  if (!redaction) return false;
  const mission = await missionDuCasting(ctx, cle);
  const existant = await sql<{ statut: string }>(
    ctx,
    "SELECT statut FROM retours_experience WHERE mission_id = $1",
    [mission.id],
  );
  if (existant[0]?.statut === "valide") return false;
  const ouverte = mission.statut === "en_cours";
  if (!ouverte && mission.statut !== "a_cloturer" && mission.statut !== "cloturee") {
    ctx.journal(
      `  capitalisation : « ${mission.intitule} » (${mission.statut}), retour non ouvert.`,
    );
    return false;
  }
  if (ouverte) await changerStatut(ctx, mission.id, "a_cloturer");
  try {
    await travaillerRetour(ctx, mission.id, redaction);
  } finally {
    if (ouverte) await changerStatut(ctx, mission.id, "en_cours");
  }
  return true;
}
