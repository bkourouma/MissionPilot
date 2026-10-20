import {
  PLAFONDS_DD,
  PLAFONDS_DD_PORTAIL,
  type DdPortailEtatDossier,
  type DdPortailNotePubliable,
  type DdPortailPieceCabinet,
  type DdPortailPublicationCabinet,
  type DdPortailRapportPubliable,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import type { DossierLu } from "./acces.js";
import { comptesDuDossier, iso, lireOption } from "./portail.js";

/*
 * État du partage d'un dossier sur le portail investisseur (côté CABINET, migration 0509) : option
 * du cabinet, comptes du dossier, publications (retirées et périmées comprises, les plus récentes),
 * notes publiables avec leurs rapports. Lecture seule ; la route vérifie la permission et la
 * visibilité de la mission avant l'appel. Listes bornées par les plafonds de PLAFONDS_DD_PORTAIL.
 */

async function publicationsDuDossier(
  db: Db,
  dossierId: string,
): Promise<DdPortailPublicationCabinet[]> {
  const r = await db.query(
    `SELECT p.id, p.note_id, p.version, p.titre, p.recommandation, p.valide_le,
       p.cree_le AS publie_le, r.cree_le AS retiree_le,
       EXISTS (SELECT 1 FROM dd_note_versions z WHERE z.note_id = p.note_id
               AND z.etat = 'soumise' AND z.version > p.version) AS perimee
     FROM dd_portail_publications p
       LEFT JOIN dd_portail_publication_retraits r ON r.publication_id = p.id
     WHERE p.dossier_id = $1 ORDER BY p.numero DESC LIMIT $2`,
    [dossierId, PLAFONDS_DD_PORTAIL.publications_par_dossier],
  );
  const ids = r.rows.map((l) => l.id as string);
  const pieces = await db.query(
    `SELECT x.id, x.publication_id, x.rapport_id, x.variante, x.format FROM dd_portail_pieces x
     WHERE x.publication_id = ANY ($1::uuid[]) ORDER BY x.numero LIMIT $2`,
    [
      ids,
      PLAFONDS_DD_PORTAIL.publications_par_dossier * PLAFONDS_DD_PORTAIL.pieces_par_publication,
    ],
  );
  const parPublication = new Map<string, DdPortailPieceCabinet[]>();
  for (const x of pieces.rows) {
    const liste = parPublication.get(x.publication_id as string) ?? [];
    liste.push({
      id: x.id as string,
      rapport_id: x.rapport_id as string,
      variante: x.variante as DdPortailPieceCabinet["variante"],
      format: x.format as DdPortailPieceCabinet["format"],
    });
    parPublication.set(x.publication_id as string, liste);
  }
  return r.rows.map((l) => ({
    id: l.id as string,
    note_id: l.note_id as string,
    version: l.version as number,
    titre: l.titre as string,
    recommandation: l.recommandation as DdPortailPublicationCabinet["recommandation"],
    valide_le: iso(l.valide_le as Date) as string,
    publie_le: iso(l.publie_le as Date) as string,
    retiree: l.retiree_le !== null,
    retiree_le: iso((l.retiree_le as Date | null) ?? null),
    perimee: l.perimee === true,
    pieces: parPublication.get(l.id as string) ?? [],
  }));
}

async function notesPubliables(db: Db, dossierId: string): Promise<DdPortailNotePubliable[]> {
  const r = await db.query(
    `SELECT n.id AS note_id, n.titre, v.version, x.valide_le,
       (SELECT p.id FROM dd_portail_publications p WHERE p.note_id = n.id AND NOT EXISTS (
          SELECT 1 FROM dd_portail_publication_retraits rr WHERE rr.publication_id = p.id)
        ORDER BY p.numero DESC LIMIT 1) AS publication_active_id
     FROM dd_notes n
       JOIN LATERAL (SELECT y.id, y.version FROM dd_note_versions y
                     WHERE y.note_id = n.id AND y.etat = 'soumise'
                     ORDER BY y.version DESC LIMIT 1) v ON true
       JOIN dd_note_validations x ON x.note_version_id = v.id AND x.decision = 'valide'
     WHERE n.dossier_id = $1 ORDER BY n.numero LIMIT $2`,
    [dossierId, PLAFONDS_DD.notes_par_dossier],
  );
  if (r.rows.length === 0) return [];
  const rapports = await db.query(
    `SELECT id, dd_note_id, variante, format, genere_le FROM (
       SELECT r.id, r.dd_note_id, r.variante, r.format, r.genere_le,
         row_number() OVER (PARTITION BY r.dd_note_id ORDER BY r.genere_le DESC, r.id) AS rang
       FROM rapports_mission r
         JOIN unnest($1::uuid[], $2::int[]) AS t(note_id, version)
           ON r.dd_note_id = t.note_id AND r.version_source = t.version
       WHERE r.modele = 'note_comite' AND r.statut = 'valide' AND r.format IN ('pdf', 'docx')
         AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = r.fichier_id)
     ) q WHERE rang <= $3 ORDER BY genere_le DESC, id`,
    [
      r.rows.map((l) => l.note_id as string),
      r.rows.map((l) => l.version as number),
      PLAFONDS_DD_PORTAIL.rapports_par_note,
    ],
  );
  const parNote = new Map<string, DdPortailRapportPubliable[]>();
  for (const x of rapports.rows) {
    const liste = parNote.get(x.dd_note_id as string) ?? [];
    liste.push({
      id: x.id as string,
      variante: x.variante as DdPortailRapportPubliable["variante"],
      format: x.format as DdPortailRapportPubliable["format"],
      genere_le: iso(x.genere_le as Date) as string,
    });
    parNote.set(x.dd_note_id as string, liste);
  }
  return r.rows.map((l) => ({
    note_id: l.note_id as string,
    titre: l.titre as string,
    version: l.version as number,
    valide_le: iso(l.valide_le as Date) as string,
    publication_active_id: (l.publication_active_id as string | null) ?? null,
    rapports: parNote.get(l.note_id as string) ?? [],
  }));
}

export async function etatDossier(
  db: Db,
  cabinetId: string,
  dossier: DossierLu,
): Promise<DdPortailEtatDossier> {
  return {
    option_active: (await lireOption(db, cabinetId)).actif,
    comptes: await comptesDuDossier(db, dossier),
    publications: await publicationsDuDossier(db, dossier.id),
    notes_publiables: await notesPubliables(db, dossier.id),
  };
}
