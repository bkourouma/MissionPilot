import {
  analyserDerogations,
  SEUIL_MISSIONS_PAR_DEFAUT,
  type DerogationObservee,
  type GroupeDerogations,
} from "@missionpilot/engines";
import {
  propositionStandardCreationSchema,
  type analyseDerogationsQuerySchema,
  type propositionDerogationsSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { creerProposition } from "../standard/propositions.js";
import { NATURE_LIBELLES } from "./gabarit.js";

/*
 * Analyse des dérogations (CAP-05), réservée au comité méthode (`standard.gerer`).
 * Les EFFECTIFS portent sur toutes les dérogations du cabinet (agrégats) ; le TEXTE d'un motif
 * n'est lu que pour une mission visible de l'utilisateur (sinon compté sans être lu). Un groupe
 * au-dessus du seuil devient une proposition d'évolution du standard par le SERVICE du comité
 * méthode (`creerProposition`, lot STD : circuit proposée → en revue → acceptée → publiée, relu
 * par un autre expert) ; sa description ne cite que des effectifs et le groupe (méthode, brique,
 * nature), jamais un motif, un mot tiré des motifs ni une mission : la proposition est lisible
 * de rôles qui n'ont pas accès à ces missions. Un groupe déjà proposé (proposition non refusée) n'est pas reproposé.
 */

const DEROGATIONS_MAX = 20_000;

async function observer(db: Db, auth: Auth) {
  const r = await db.query(
    `SELECT d.id, d.mission_id, v.methode_id, me.code AS methode_code, d.brique_code, d.nature,
            d.statut, CASE WHEN ${filtreVisibilite(1, 2)} THEN d.motif END AS motif,
            d.cree_le::text AS cree_le
     FROM derogations d JOIN missions m ON m.id = d.mission_id
     JOIN mission_methodes mm ON mm.id = d.mission_methode_id
     JOIN methode_versions v ON v.id = mm.methode_version_id
     JOIN methodes me ON me.id = v.methode_id
     ORDER BY d.cree_le DESC, d.id DESC LIMIT $3`,
    [voitToutesLesMissions(auth), auth.utilisateurId, DEROGATIONS_MAX + 1],
  );
  return {
    derogations: r.rows.slice(0, DEROGATIONS_MAX) as DerogationObservee[],
    tronque: r.rows.length > DEROGATIONS_MAX,
  };
}

async function propositionsExistantes(db: Db) {
  const r = await db.query(
    `SELECT DISTINCT ON (c.cle) c.cle, c.proposition_id, p.statut, p.titre, c.cree_le
     FROM cap_propositions_derogations c JOIN propositions_standard p ON p.id = c.proposition_id
     ORDER BY c.cle, c.cree_le DESC`,
  );
  return new Map(
    (r.rows as { cle: string; proposition_id: string; statut: string; titre: string }[]).map(
      (x) => [x.cle, { id: x.proposition_id, statut: x.statut, titre: x.titre }],
    ),
  );
}

export async function analyseDerogations(
  db: Db,
  auth: Auth,
  q: z.infer<typeof analyseDerogationsQuerySchema>,
) {
  const { derogations, tronque } = await observer(db, auth);
  const seuil = q.seuil ?? SEUIL_MISSIONS_PAR_DEFAUT;
  const groupes = analyserDerogations(derogations, {
    seuilMissions: seuil,
    similarite: q.similarite,
  });
  const existantes = await propositionsExistantes(db);
  return {
    seuil,
    tronque,
    elements: groupes.map((g) => ({ ...g, proposition: existantes.get(g.cle) ?? null })),
  };
}

function texteProposition(g: GroupeDerogations) {
  const nature = NATURE_LIBELLES[g.nature] ?? g.nature;
  const titre = `Dérogations fréquentes : ${nature} de la brique « ${g.brique_code} »`.slice(
    0,
    200,
  );
  const description = [
    `Analyse des dérogations (CAP-05) : ${g.missions} missions et ${g.derogations} dérogations ` +
      `(${g.approuvees} approuvées, ${g.refusees} refusées, ${g.demandees} en attente) portent sur ` +
      `le ${nature} de la brique « ${g.brique_code} »` +
      `${g.methode_code ? ` de la méthode « ${g.methode_code} »` : ""}.`,
    "Proposition : examiner une évolution du standard pour ce cas récurrent (règle de modulation, " +
      "brique facultative, temps type ou garde). Les motifs détaillés se lisent dans le tableau des " +
      "dérogations, selon les droits de chacun.",
  ]
    .filter((l) => l !== "")
    .join("\n\n");
  return propositionStandardCreationSchema.parse({
    methode_id: g.methode_id,
    titre,
    description: description.slice(0, 4000),
  });
}

export async function proposerDepuisDerogations(
  db: Db,
  auth: Auth,
  corps: z.infer<typeof propositionDerogationsSchema>,
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `cap_derogations:${auth.cabinetId}:${corps.cle}`,
  ]);
  const { derogations } = await observer(db, auth);
  const seuil = corps.seuil ?? SEUIL_MISSIONS_PAR_DEFAUT;
  const g = analyserDerogations(derogations, { seuilMissions: seuil }).find(
    (x) => x.cle === corps.cle,
  );
  if (!g) throw introuvable("Groupe de dérogations");
  if (!g.au_dessus_du_seuil) {
    throw new AppError(
      409,
      "SEUIL_NON_ATTEINT",
      "Ce groupe de dérogations n'atteint pas le seuil de fréquence.",
    );
  }
  const existante = (await propositionsExistantes(db)).get(g.cle);
  if (existante && existante.statut !== "refusee") {
    throw new AppError(
      409,
      "PROPOSITION_EXISTANTE",
      "Une proposition est déjà soumise pour ce groupe.",
    );
  }
  const proposition = await creerProposition(db, auth, texteProposition(g));
  await db.query(
    `INSERT INTO cap_propositions_derogations (cabinet_id, cle, proposition_id, missions, derogations,
       cree_par) VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.cabinetId, g.cle, proposition.id, g.missions, g.derogations, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "capitalisation.derogations.proposer",
    entite: "proposition_standard",
    entiteId: proposition.id as string,
    details: { cle: g.cle, missions: g.missions, derogations: g.derogations },
  });
  return { proposition, groupe: g };
}
