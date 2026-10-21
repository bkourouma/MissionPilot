import { contenuAvancementSchema, projeterContenuAvancementPortail } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { introuvablePortail, type AccesPortail } from "./acces.js";

/*
 * Rapports d'avancement hebdomadaires VALIDÉS, côté portail client (AUT-10). Projection explicite :
 * le contenu est celui du moteur, relu par la liste blanche `contenuAvancementSchema` ; l'introduction
 * et le commentaire sont ceux du chef de mission. JAMAIS la suggestion de l'IA (`commentaire_ia`), le
 * validateur, la version ni un brouillon. La base (politique `portail` de 0307) ne montre déjà que les
 * rapports validés des missions partagées avec CE client ; chaque requête le refiltre explicitement.
 */

interface LignePortail {
  id: string;
  mission_id: string;
  mission_intitule: string;
  semaine: string;
  contenu: unknown;
  introduction: string | null;
  commentaire: string | null;
  valide_le: Date;
  cle_tri: string;
}

const COLONNES = `r.id, r.mission_id, m.intitule AS mission_intitule, r.semaine::text AS semaine,
  r.contenu, r.introduction, r.commentaire, r.valide_le, r.semaine::text AS cle_tri`;
const DEPUIS = `avancement_rapports r JOIN missions m ON m.id = r.mission_id`;
const FILTRE = `r.statut = 'valide' AND r.client_id = $1`;

export function vueRapportPortail(l: Omit<LignePortail, "cle_tri">) {
  // Projection portail explicite : ni `non_partages`, ni rien d'interne (voir shared).
  const contenu = projeterContenuAvancementPortail(contenuAvancementSchema.parse(l.contenu));
  return {
    id: l.id,
    mission_id: l.mission_id,
    mission_intitule: l.mission_intitule,
    semaine: l.semaine,
    semaine_fin: contenu.semaine_fin,
    introduction: l.introduction,
    commentaire: l.commentaire,
    valide_le: l.valide_le,
    contenu,
  };
}

export async function listerRapportsPortail(
  db: Db,
  acces: AccesPortail,
  q: { mission_id?: string | undefined; limite: number; curseur?: string | undefined },
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES} FROM ${DEPUIS}
     WHERE ${FILTRE} AND ($2::uuid IS NULL OR r.mission_id = $2::uuid)
       AND ($3::date IS NULL OR (r.semaine, r.id) < ($3::date, $4::uuid))
     ORDER BY r.semaine DESC, r.id DESC LIMIT $5`,
    [acces.clientId, q.mission_id ?? null, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as LignePortail[], q.limite);
  return {
    elements: page.elements.map((l) => {
      const v = vueRapportPortail(l);
      return {
        id: v.id,
        mission_id: v.mission_id,
        mission_intitule: v.mission_intitule,
        semaine: v.semaine,
        semaine_fin: v.semaine_fin,
        avancement_pourcentage: v.contenu.avancement.pourcentage,
        valide_le: v.valide_le,
      };
    }),
    curseur_suivant: page.curseur_suivant,
  };
}

export async function lireRapportPortail(db: Db, acces: AccesPortail, id: string) {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE ${FILTRE} AND r.id = $2`, [
    acces.clientId,
    id,
  ]);
  if (!r.rows[0]) throw introuvablePortail();
  return vueRapportPortail(r.rows[0] as LignePortail);
}
