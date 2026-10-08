import {
  aPermission,
  TYPES_RESULTAT_RECHERCHE,
  type Permission,
  type RechercheQuery,
  type TypeResultatRecherche,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { journaliser } from "../audit.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import {
  filtreVisibilite,
  modifieToutesLesMissions,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { tousNiveauxLisibles } from "../rapports/niveaux.js";

/*
 * Recherche unifiée plein texte français (CAP-07), DANS LES DROITS DE L'UTILISATEUR :
 * - chaque source exige sa permission (mission, livrable, rapport : `mission.lire` ; preuve :
 *   `preuve.lire` ; retour d'expérience : `connaissance.lire`, déjà exigée par la route) ; une
 *   source non permise n'est pas interrogée ;
 * - chaque résultat appartient à une mission VISIBLE (même fragment que `exigerMissionVisible`) ;
 * - rapport : niveau lisible (rapports/niveaux.ts, FIN-02) ; preuve : version courante, verbatim
 *   nominatif sans accord exclu sauf pour qui peut le voir (preuves/acces.ts `peutVoirNominatif`) ;
 *   rapport : fichier non supprimé (comme la liste des rapports) ; retour d'expérience : version
 *   VALIDÉE seulement (base de connaissances), et sans la section « Écarts » (jours et budget)
 *   pour qui n'a pas `budget.lire_jours` : ni dans l'extrait, ni dans le texte interrogé (sinon
 *   la recherche serait un oracle sur des jours que l'API ne montre pas) ;
 * - débit : au plus RECHERCHES_PAR_FENETRE recherches par utilisateur sur FENETRE_RECHERCHE_MINUTES
 *   minutes (429 `TROP_DE_RECHERCHES`), compté sur le journal d'audit (modèle
 *   `routes/factures-pdf.ts`) ; chaque recherche aboutie est journalisée SANS le texte cherché.
 * Normalisation identique des deux côtés (`cap_tsv` / `cap_tsq`, migration 0460) ; index GIN
 * sur les mêmes expressions (0460, 0464). Classement par pertinence (`ts_rank`), plafond par
 * source signalé (`tronque`), jamais silencieux.
 *
 * Point d'extension : la banque de références (AO-05) s'ajoutera comme une source de plus.
 */

interface Resultat {
  type: TypeResultatRecherche;
  id: string;
  titre: string;
  extrait: string | null;
  mission_id: string;
  mission_intitule: string;
  date: string;
  rang: number;
}

interface Source {
  type: TypeResultatRecherche;
  permission: Permission;
  /** Requête : $1 texte, $2 voit toutes, $3 utilisateur, $4 limite, puis `extra`. */
  sql: string | ((auth: Auth) => string);
  extra?: (auth: Auth) => unknown[];
}

const VISIBLE = filtreVisibilite(2, 3);

const SOURCES: readonly Source[] = [
  {
    type: "mission",
    permission: "mission.lire",
    sql: `SELECT m.id, m.intitule AS titre, nullif(concat_ws(' · ', m.secteur, m.activite), '') AS extrait,
            m.id AS mission_id, m.intitule AS mission_intitule, m.cree_le::text AS date,
            ts_rank(cap_tsv(m.intitule || ' ' || coalesce(m.secteur, '') || ' ' || coalesce(m.activite, '')), q) AS rang
          FROM missions m, cap_tsq($1) q
          WHERE cap_tsv(m.intitule || ' ' || coalesce(m.secteur, '') || ' ' || coalesce(m.activite, '')) @@ q
            AND ${VISIBLE}
          ORDER BY rang DESC, m.id LIMIT $4`,
  },
  {
    type: "livrable",
    permission: "mission.lire",
    sql: `SELECT d.id, d.nom AS titre, d.type || ', version ' || d.version AS extrait,
            m.id AS mission_id, m.intitule AS mission_intitule, d.cree_le::text AS date,
            ts_rank(cap_tsv(d.nom), q) AS rang
          FROM mission_documents d JOIN missions m ON m.id = d.mission_id, cap_tsq($1) q
          WHERE cap_tsv(d.nom) @@ q AND ${VISIBLE}
            AND NOT EXISTS (SELECT 1 FROM mission_documents d2 WHERE d2.mission_id = d.mission_id
                              AND d2.type = d.type AND d2.nom = d.nom AND d2.version > d.version)
          ORDER BY rang DESC, d.id LIMIT $4`,
  },
  {
    type: "rapport",
    permission: "mission.lire",
    sql: `SELECT r.id, CASE r.modele WHEN 'etat_avancement' THEN 'Rapport d''état d''avancement'
              WHEN 'notation' THEN 'Rapport de notation' ELSE 'Rapport de plan stratégique' END AS titre,
            r.format || ', ' || r.statut AS extrait, m.id AS mission_id, m.intitule AS mission_intitule,
            r.genere_le::text AS date,
            ts_rank(cap_tsv(m.intitule || ' rapport ' || replace(r.modele, '_', ' ')), q) AS rang
          FROM rapports_mission r JOIN missions m ON m.id = r.mission_id
          JOIN fichiers f ON f.id = r.fichier_id, cap_tsq($1) q
          WHERE cap_tsv(m.intitule || ' rapport ' || replace(r.modele, '_', ' ')) @@ q
            AND ${VISIBLE} AND r.niveau = ANY ($5::text[])
            AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
          ORDER BY rang DESC, r.id LIMIT $4`,
    extra: (auth) => [tousNiveauxLisibles(auth.roles)],
  },
  {
    type: "preuve",
    permission: "preuve.lire",
    sql: `SELECT p.id, v.source_precise AS titre, left(v.extrait, 300) AS extrait,
            m.id AS mission_id, m.intitule AS mission_intitule, v.date_preuve::text AS date,
            ts_rank(cap_tsv(v.source_precise || ' ' || coalesce(v.extrait, '')), q) AS rang
          FROM preuve_versions v JOIN preuves p ON p.id = v.preuve_id
          JOIN missions m ON m.id = p.mission_id, cap_tsq($1) q
          WHERE cap_tsv(v.source_precise || ' ' || coalesce(v.extrait, '')) @@ q AND ${VISIBLE}
            AND NOT EXISTS (SELECT 1 FROM preuve_versions v2
                            WHERE v2.preuve_id = v.preuve_id AND v2.version > v.version)
            AND (NOT (v.nominatif AND NOT v.accord_nominatif) OR $5::boolean
                 OR v.auteur_id = $3 OR v.cree_par = $3 OR m.directeur_id = $3 OR m.chef_id = $3)
          ORDER BY rang DESC, p.id LIMIT $4`,
    extra: (auth) => [modifieToutesLesMissions(auth)],
  },
  {
    type: "connaissance",
    permission: "connaissance.lire",
    sql: (auth) => {
      // Sans `budget.lire_jours` : section « Écarts » hors du texte interrogé (pas d'index GIN).
      const texte = aPermission(auth.roles, "budget.lire_jours")
        ? "v.contexte || ' ' || v.methode || ' ' || v.ecarts || ' ' || v.lecons"
        : "v.contexte || ' ' || v.methode || ' ' || v.lecons";
      return `SELECT r.id, 'Retour d''expérience : ' || m.intitule AS titre, left(v.lecons, 300) AS extrait,
            m.id AS mission_id, m.intitule AS mission_intitule, r.valide_le::text AS date,
            ts_rank(cap_tsv(${texte}), q) AS rang
          FROM retour_experience_versions v
          JOIN retours_experience r ON r.id = v.retour_id AND r.version_validee = v.version
          JOIN missions m ON m.id = r.mission_id, cap_tsq($1) q
          WHERE cap_tsv(${texte}) @@ q
            AND ${VISIBLE}
          ORDER BY rang DESC, r.id LIMIT $4`;
    },
  },
];

/** Recherches admises par utilisateur sur la fenêtre glissante. */
export const RECHERCHES_PAR_FENETRE = 60;
export const FENETRE_RECHERCHE_MINUTES = 1;
const ACTION_RECHERCHE = "capitalisation.recherche";

/** 429 si l'utilisateur a déjà lancé RECHERCHES_PAR_FENETRE recherches sur la fenêtre. */
async function verifierDebitRecherche(db: Db, auth: Auth): Promise<void> {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM journal_audit
     WHERE utilisateur_id = $1 AND action = $2 AND cree_le > now() - make_interval(mins => $3)`,
    [auth.utilisateurId, ACTION_RECHERCHE, FENETRE_RECHERCHE_MINUTES],
  );
  if ((r.rows[0].n as number) >= RECHERCHES_PAR_FENETRE) {
    throw new AppError(
      429,
      "TROP_DE_RECHERCHES",
      `Au plus ${RECHERCHES_PAR_FENETRE} recherches par minute : réessayez dans un instant.`,
    );
  }
}

export async function rechercher(db: Db, auth: Auth, q: RechercheQuery) {
  await verifierDebitRecherche(db, auth);
  const types = q.types && q.types.length > 0 ? q.types : [...TYPES_RESULTAT_RECHERCHE];
  const resultats: Resultat[] = [];
  const parType: Partial<Record<TypeResultatRecherche, { nombre: number; tronque: boolean }>> = {};
  for (const s of SOURCES) {
    if (!types.includes(s.type) || !aPermission(auth.roles, s.permission)) continue;
    const r = await db.query(typeof s.sql === "function" ? s.sql(auth) : s.sql, [
      q.q,
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      q.limite + 1,
      ...(s.extra ? s.extra(auth) : []),
    ]);
    const lignes = (r.rows as Omit<Resultat, "type">[]).slice(0, q.limite);
    parType[s.type] = { nombre: lignes.length, tronque: r.rows.length > q.limite };
    resultats.push(...lignes.map((l) => ({ ...l, type: s.type, rang: Number(l.rang) })));
  }
  resultats.sort(
    (a, b) => b.rang - a.rang || a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: ACTION_RECHERCHE,
    entite: "recherche",
    details: { types, longueur: q.q.length },
  });
  return {
    q: q.q,
    par_type: parType,
    elements: resultats.map(({ rang: _rang, ...r }) => r),
  };
}
