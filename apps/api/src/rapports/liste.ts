import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { vueFichier } from "../stockage/fichiers.js";
import { COLONNES_RAPPORT } from "./enregistrement.js";
import { tousNiveauxLisibles } from "./niveaux.js";

/*
 * Listes des rapports générés, paginées par curseur, plus récent d'abord :
 * par mission (tous modèles), par notation ou par plan. L'appelant a déjà
 * contrôlé la visibilité de la mission (ou de la notation, du plan). Seuls
 * les rapports dont l'appelant détient les permissions du NIVEAU sont listés
 * (rapports/niveaux.ts) ; fichiers supprimés (retirés ou purgés) exclus ;
 * jamais la clé de stockage.
 */

/** Clé de tri : instant de génération (microsecondes, UTC). */
const CLE_TRI = `to_char(r.genere_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

export type FiltreRapports = { missionId: string } | { notationId: string } | { planId: string };

/** Colonne filtrée : choix entre constantes selon la forme du filtre. */
function colonne(filtre: FiltreRapports): { sql: string; valeur: string } {
  if ("notationId" in filtre) return { sql: "r.notation_id", valeur: filtre.notationId };
  if ("planId" in filtre) return { sql: "r.plan_id", valeur: filtre.planId };
  return { sql: "r.mission_id", valeur: filtre.missionId };
}

export async function listerRapports(
  db: Db,
  auth: Auth,
  filtre: FiltreRapports,
  q: { limite: number; curseur?: string | undefined },
) {
  const apres = decoderCurseur(q.curseur);
  const c = colonne(filtre);
  const r = await db.query(
    `SELECT ${COLONNES_RAPPORT}, f.id AS fichier_id, f.nom_origine AS nom, f.type_mime,
       f.taille, f.sha256, f.envoye_par, f.cree_le, ${CLE_TRI} AS cle_tri
     FROM rapports_mission r JOIN fichiers f ON f.id = r.fichier_id
     WHERE ${c.sql} = $1 AND r.niveau = ANY ($2::text[])
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
       AND ($3::text IS NULL OR (${CLE_TRI}, r.id) < ($3, $4::uuid))
     ORDER BY cle_tri DESC, r.id DESC LIMIT $5`,
    [
      c.valeur,
      tousNiveauxLisibles(auth.roles),
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      q.limite + 1,
    ],
  );
  type Ligne = Record<string, unknown> & { cle_tri: string; id: string };
  const page = paginer(r.rows as Ligne[], q.limite);
  return {
    elements: page.elements.map((l) => ({
      id: l.id,
      mission_id: l.mission_id,
      modele: l.modele,
      format: l.format,
      statut: l.statut,
      niveau: l.niveau,
      notation_id: l.notation_id,
      plan_id: l.plan_id,
      version_source: l.version_source,
      genere_par: l.genere_par,
      genere_le: l.genere_le,
      fichier: vueFichier({ ...l, id: l.fichier_id }),
    })),
    curseur_suivant: page.curseur_suivant,
  };
}
