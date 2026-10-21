import {
  CHECKLISTS_DEPART,
  ErreurRedressement,
  VERSION_CHECKLISTS,
  VERSION_CHECKLISTS_DEPART,
  checklistDepart,
  evaluerChecklist,
  validerModeleChecklist,
  type BilanChecklist,
  type ItemChecklist,
  type ReponseChecklist,
  type ResultatChecklist,
} from "@missionpilot/engines";
import {
  RED_CHECKLIST_MENTION_A_VALIDER,
  RED_CHECKLIST_PLAFONDS,
  RED_CHECKLIST_REPONSES,
  RED_SECTEURS,
  aPermission,
  type RedChecklistActivation,
  type RedChecklistBilanVue,
  type RedChecklistEvaluationVue,
  type RedChecklistItemVue,
  type RedChecklistModeleCreation,
  type RedChecklistModeleVue,
  type RedChecklistModelesVue,
  type RedChecklistOrigine,
  type RedChecklistReferentielVue,
  type RedChecklistReponseVue,
  type RedChecklistReponsesLot,
  type RedChecklistResumeVue,
  type RedChecklistStatut,
  type RedChecklistVersionCreation,
  type RedChecklistVersionVue,
  type RedChecklistVue,
  type RedChecklistsVue,
  type RedDomaine,
  type RedSecteur,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import {
  exigerDossierRedEcriture,
  exigerDossierRedVisible,
  peutEcrireDansDossier,
  type AccesDossierRed,
  type DossierRed,
} from "./acces.js";
import {
  DEBIT_CHECKLIST_ACTIVATIONS,
  DEBIT_CHECKLIST_MODELES,
  DEBIT_CHECKLIST_REPONSES,
  DEBIT_CHECKLIST_VERSIONS,
} from "./checklists-limites.js";
import { journalRed } from "./journal.js";
import { verifierDebit } from "./limites.js";
import { iso, isoOuVide, personne } from "./vues.js";

/*
 * Check-lists métier du redressement (RED-03). Le cabinet configure des MODÈLES versionnés (brouillon
 * puis publiée : séparation des tâches contrôlée ici ET en base, MPZ07) ; une check-list est ACTIVÉE
 * dans un dossier sous forme d'instantané figé (modèle publié ou contenu de départ du moteur, marqué
 * « à valider par un expert ») ; les réponses s'ajoutent sans jamais s'effacer, la dernière d'un item
 * est la courante. Les taux (complétude, conformité) sortent du moteur à chaque lecture. Une check-list
 * est un constat de saisie : aucune qualification juridique. Le journal ne porte que des identifiants,
 * des codes et des comptes (jamais un libellé, un commentaire ni un motif).
 */

const separation = (message: string) => new AppError(403, "SEPARATION_DES_TACHES", message);

type Ligne = Record<string, unknown>;

/* ----- Référentiel ----- */

function itemsVue(items: readonly ItemChecklist[]): RedChecklistItemVue[] {
  return items.map((i) => ({
    id: i.id,
    domaine: i.domaine,
    libelle: i.libelle,
    aide: i.aide ?? null,
  }));
}

/** Route « référentiel » : contenu de départ, réponses, plafonds. Aucune lecture en base. */
export function referentielChecklists(): RedChecklistReferentielVue {
  return {
    version_moteur_checklists: VERSION_CHECKLISTS,
    version_depart: VERSION_CHECKLISTS_DEPART,
    mention_a_valider: RED_CHECKLIST_MENTION_A_VALIDER,
    secteurs: [...RED_SECTEURS],
    reponses: [...RED_CHECKLIST_REPONSES],
    departs: CHECKLISTS_DEPART.map((c) => ({
      code: c.code,
      secteur: c.secteur,
      intitule: c.intitule,
      a_valider_par_un_expert: c.a_valider_par_un_expert,
      items: itemsVue(c.items),
    })),
    plafonds: { ...RED_CHECKLIST_PLAFONDS },
  };
}

/* ----- Contenu stocké ----- */

/** Contenu stocké (`{ items: [...] }`) → items du moteur ; seuls les champs connus sont lus. */
export function itemsDepuisContenu(contenu: unknown): ItemChecklist[] {
  const source = ((contenu ?? {}) as { items?: Ligne[] }).items ?? [];
  return source.map((i) => ({
    id: i.id as string,
    domaine: i.domaine as RedDomaine,
    libelle: i.libelle as string,
    aide: (i.aide as string | null | undefined) ?? null,
  }));
}

/** Items saisis (ou de départ) → JSON stocké, dans la forme canonique du moteur, revalidée. */
function contenuDepuisItems(
  items: readonly {
    id: string;
    domaine: RedDomaine;
    libelle: string;
    aide?: string | null | undefined;
  }[],
): { items: ItemChecklist[]; json: string } {
  const normalises: ItemChecklist[] = items.map((i) => ({
    id: i.id,
    domaine: i.domaine,
    libelle: i.libelle,
    aide: i.aide ?? null,
  }));
  validerModeleChecklist(normalises);
  return { items: normalises, json: JSON.stringify({ items: normalises }) };
}

/* ----- Modèles et versions ----- */

const COLONNES_VERSION = `v.id, v.modele_id, v.version, v.statut, v.motif, v.cree_par, uc.nom AS cree_par_nom,
  v.cree_le, v.publiee_par, up.nom AS publiee_par_nom, v.publiee_le,
  jsonb_array_length(v.contenu -> 'items') AS nombre_items`;
const JOINTURES_VERSION = `FROM red_checklist_versions v
  JOIN utilisateurs uc ON uc.id = v.cree_par
  LEFT JOIN utilisateurs up ON up.id = v.publiee_par`;

/** Peut publier : brouillon, rôle d'expert métier ou d'associé, jamais l'auteur (sauf associé). */
function peutPublier(auth: Auth, v: { statut: string; cree_par: string }): boolean {
  return (
    v.statut === "brouillon" &&
    aPermission(auth.roles, "redressement.parametrer") &&
    (auth.roles.includes("expert_metier") || estAssocie(auth)) &&
    (v.cree_par !== auth.utilisateurId || estAssocie(auth))
  );
}

function vueVersion(
  auth: Auth,
  l: Ligne,
  enVigueur: number | null,
  items?: readonly ItemChecklist[],
): RedChecklistVersionVue {
  return {
    id: l.id as string,
    modele_id: l.modele_id as string,
    version: l.version as number,
    statut: l.statut as RedChecklistVersionVue["statut"],
    remplacee: l.statut === "publiee" && enVigueur !== null && (l.version as number) < enVigueur,
    nombre_items: l.nombre_items as number,
    ...(items ? { items: itemsVue(items) } : {}),
    motif: (l.motif as string | null) ?? null,
    cree_par: personne(l.cree_par as string, l.cree_par_nom as string),
    cree_le: isoOuVide(l.cree_le as Date),
    publiee_par: l.publiee_par
      ? personne(l.publiee_par as string, l.publiee_par_nom as string)
      : null,
    publiee_le: iso(l.publiee_le as Date | null),
    peut_publier: peutPublier(auth, { statut: l.statut as string, cree_par: l.cree_par as string }),
  };
}

/** Contenus des versions demandées (une requête, jamais toute l'historique). */
async function contenusVersions(db: Db, ids: string[]): Promise<Map<string, ItemChecklist[]>> {
  const sortie = new Map<string, ItemChecklist[]>();
  if (ids.length === 0) return sortie;
  const r = await db.query(
    "SELECT id, contenu FROM red_checklist_versions WHERE id = ANY($1::uuid[])",
    [ids],
  );
  for (const l of r.rows as Ligne[]) sortie.set(l.id as string, itemsDepuisContenu(l.contenu));
  return sortie;
}

/** Route « modèles » : modèles du cabinet avec version en vigueur, brouillon et historique (sans items). */
export async function lireModeles(
  db: Db,
  auth: Auth,
  secteur: RedSecteur | undefined,
): Promise<RedChecklistModelesVue> {
  const m = await db.query(
    `SELECT m.id, m.code, m.intitule, m.secteur, m.cree_par, uc.nom AS cree_par_nom, m.cree_le
     FROM red_checklist_modeles m JOIN utilisateurs uc ON uc.id = m.cree_par
     WHERE ($1::text IS NULL OR m.secteur = $1) ORDER BY m.secteur, m.code
     LIMIT ${RED_CHECKLIST_PLAFONDS.modeles_par_cabinet}`,
    [secteur ?? null],
  );
  const modeles = m.rows as Ligne[];
  const v = await db.query(
    `SELECT ${COLONNES_VERSION} ${JOINTURES_VERSION}
     WHERE v.modele_id = ANY($1::uuid[]) ORDER BY v.modele_id, v.version DESC`,
    [modeles.map((x) => x.id)],
  );
  const versions = v.rows as Ligne[];
  const parModele = (id: string) => versions.filter((x) => x.modele_id === id);
  // Contenu des seules versions affichées en détail : en vigueur et brouillon.
  const detaillees = new Map<string, Ligne>();
  for (const mod of modeles) {
    const liste = parModele(mod.id as string);
    const publiee = liste.find((x) => x.statut === "publiee");
    const brouillon = liste.find((x) => x.statut === "brouillon");
    if (publiee) detaillees.set(publiee.id as string, publiee);
    if (brouillon) detaillees.set(brouillon.id as string, brouillon);
  }
  const contenus = await contenusVersions(db, [...detaillees.keys()]);
  return {
    modeles: modeles.map((mod): RedChecklistModeleVue => {
      const liste = parModele(mod.id as string);
      const publiee = liste.find((x) => x.statut === "publiee");
      const brouillon = liste.find((x) => x.statut === "brouillon");
      const numero = publiee ? (publiee.version as number) : null;
      return {
        id: mod.id as string,
        code: mod.code as string,
        intitule: mod.intitule as string,
        secteur: mod.secteur as RedSecteur,
        cree_par: personne(mod.cree_par as string, mod.cree_par_nom as string),
        cree_le: isoOuVide(mod.cree_le as Date),
        en_vigueur: publiee
          ? vueVersion(auth, publiee, numero, contenus.get(publiee.id as string))
          : null,
        brouillon: brouillon
          ? vueVersion(auth, brouillon, numero, contenus.get(brouillon.id as string))
          : null,
        historique: liste.map((x) => vueVersion(auth, x, numero)),
      };
    }),
  };
}

async function lireModele(db: Db, auth: Auth, id: string): Promise<RedChecklistModeleVue> {
  const tous = await lireModeles(db, auth, undefined);
  const trouve = tous.modeles.find((m) => m.id === id);
  if (!trouve) throw introuvable("Modèle de check-list");
  return trouve;
}

async function lireVersion(db: Db, auth: Auth, id: string): Promise<RedChecklistVersionVue> {
  const r = await db.query(`SELECT ${COLONNES_VERSION} ${JOINTURES_VERSION} WHERE v.id = $1`, [id]);
  const ligne = r.rows[0] as Ligne | undefined;
  if (!ligne) throw introuvable("Version de check-list");
  const haute = await db.query(
    `SELECT max(version) AS numero FROM red_checklist_versions
     WHERE modele_id = $1 AND statut = 'publiee'`,
    [ligne.modele_id],
  );
  const contenus = await contenusVersions(db, [id]);
  return vueVersion(
    auth,
    ligne,
    (haute.rows[0]?.numero as number | null) ?? null,
    contenus.get(id),
  );
}

async function verrouillerModele(db: Db, cabinetId: string, cle: string): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `redressement_checklist_modele:${cabinetId}:${cle}`,
  ]);
}

/** Création d'un modèle du cabinet : sa version 1 naît en brouillon. Le moteur revalide les items. */
export async function creerModele(
  db: Db,
  auth: Auth,
  corps: RedChecklistModeleCreation,
): Promise<RedChecklistModeleVue> {
  const { json } = contenuDepuisItems(corps.items);
  await verrouillerModele(db, auth.cabinetId, `code:${corps.code}`);
  await verifierDebit(db, auth, DEBIT_CHECKLIST_MODELES);
  const existe = await db.query("SELECT 1 FROM red_checklist_modeles WHERE code = $1", [
    corps.code,
  ]);
  if ((existe.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      "RED_CHECKLIST_CODE_EXISTE",
      "Un modèle de check-list porte déjà ce code dans le cabinet.",
    );
  }
  const r = await db.query(
    `INSERT INTO red_checklist_modeles (cabinet_id, code, intitule, secteur, cree_par)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [auth.cabinetId, corps.code, corps.intitule, corps.secteur, auth.utilisateurId],
  );
  const id = r.rows[0].id as string;
  const version = await db.query(
    `INSERT INTO red_checklist_versions (cabinet_id, modele_id, version, contenu, motif, cree_par)
     VALUES ($1, $2, 1, $3, $4, $5) RETURNING id`,
    [auth.cabinetId, id, json, corps.motif ?? null, auth.utilisateurId],
  );
  await journalRed(db, auth, "red_checklist_modele", "creation", id, {
    secteur: corps.secteur,
    version_id: version.rows[0].id as string,
    items: corps.items.length,
  });
  return lireModele(db, auth, id);
}

/** Nouvelle version (brouillon) d'un modèle : un seul brouillon à la fois (409), versions consécutives. */
export async function creerVersionModele(
  db: Db,
  auth: Auth,
  modeleId: string,
  corps: RedChecklistVersionCreation,
): Promise<RedChecklistVersionVue> {
  const { json } = contenuDepuisItems(corps.items);
  const modele = await db.query("SELECT id FROM red_checklist_modeles WHERE id = $1", [modeleId]);
  if (!modele.rows[0]) throw introuvable("Modèle de check-list");
  await verrouillerModele(db, auth.cabinetId, `id:${modeleId}`);
  await verifierDebit(db, auth, DEBIT_CHECKLIST_VERSIONS);
  const enCours = await db.query(
    `SELECT 1 FROM red_checklist_versions WHERE modele_id = $1 AND statut = 'brouillon' LIMIT 1`,
    [modeleId],
  );
  if ((enCours.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      "RED_CHECKLIST_BROUILLON_EN_COURS",
      "Un brouillon est déjà en cours pour ce modèle : publiez-le avant d'en rédiger un autre.",
    );
  }
  const suivante = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_checklist_versions WHERE modele_id = $1",
    [modeleId],
  );
  const r = await db.query(
    `INSERT INTO red_checklist_versions (cabinet_id, modele_id, version, contenu, motif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      auth.cabinetId,
      modeleId,
      suivante.rows[0].suivante as number,
      json,
      corps.motif ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journalRed(db, auth, "red_checklist_version", "creation", id, {
    modele_id: modeleId,
    version: suivante.rows[0].suivante as number,
    items: corps.items.length,
  });
  return lireVersion(db, auth, id);
}

/** Publication d'un brouillon, la dernière version du modèle, par un autre expert (ou un associé). */
export async function publierVersionModele(
  db: Db,
  auth: Auth,
  id: string,
): Promise<RedChecklistVersionVue> {
  const apercu = await db.query("SELECT modele_id FROM red_checklist_versions WHERE id = $1", [id]);
  if (!apercu.rows[0]) throw introuvable("Version de check-list");
  const modeleId = apercu.rows[0].modele_id as string;
  await verrouillerModele(db, auth.cabinetId, `id:${modeleId}`);
  const r = await db.query(
    `SELECT v.statut, v.version, v.cree_par,
       (SELECT max(x.version) FROM red_checklist_versions x WHERE x.modele_id = v.modele_id) AS derniere
     FROM red_checklist_versions v WHERE v.id = $1`,
    [id],
  );
  const l = r.rows[0] as
    { statut: string; version: number; cree_par: string; derniere: number } | undefined;
  if (!l) throw introuvable("Version de check-list");
  if (!(auth.roles.includes("expert_metier") || estAssocie(auth))) {
    throw separation("Les check-lists sont publiées par un expert métier ou un associé.");
  }
  if (l.cree_par === auth.utilisateurId && !estAssocie(auth)) {
    throw separation("L'auteur d'une check-list ne la publie pas lui-même.");
  }
  if (l.statut !== "brouillon") {
    throw new AppError(409, "RED_CHECKLIST_NON_BROUILLON", "Cette version est déjà publiée.");
  }
  if (l.version !== l.derniere) {
    throw new AppError(
      409,
      "RED_VERSION_NON_CONSECUTIVE",
      "Une version plus récente existe : seule la dernière version d'un modèle se publie.",
    );
  }
  await db.query(
    `UPDATE red_checklist_versions SET statut = 'publiee', publiee_par = $2, publiee_le = now()
     WHERE id = $1`,
    [id, auth.utilisateurId],
  );
  await journalRed(db, auth, "red_checklist_version", "publication", id, {
    modele_id: modeleId,
    version: l.version,
  });
  return lireVersion(db, auth, id);
}

/* ----- Évaluation et vues d'une check-list activée ----- */

const bilanVue = (b: BilanChecklist): RedChecklistBilanVue => ({
  total: b.total,
  oui: b.oui,
  non: b.non,
  partiel: b.partiel,
  sans_objet: b.sans_objet,
  non_renseignes: b.non_renseignes,
  applicables: b.applicables,
  completude_pb: b.completude_pb,
  conformite_pb: b.conformite_pb,
});

/** Miroir snake_case de la sortie du moteur : chaque champ est recopié nommément. */
export function vueEvaluationChecklist(r: ResultatChecklist): RedChecklistEvaluationVue {
  return {
    version: r.version,
    domaines: r.domaines.map((d) => ({ domaine: d.domaine, ...bilanVue(d) })),
    global: bilanVue(r.global),
    non_conformes: [...r.non_conformes],
    partiels: [...r.partiels],
    non_renseignes: [...r.non_renseignes],
    complete: r.complete,
  };
}

export interface ChecklistLue {
  id: string;
  dossier_id: string;
  intitule: string;
  secteur: RedSecteur;
  origine: RedChecklistOrigine;
  code_depart: string | null;
  modele_id: string | null;
  modele_version: number | null;
  statut: RedChecklistStatut;
  a_valider_par_un_expert: boolean;
  contenu: unknown;
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  archivee_le: Date | null;
  motif_archivage: string | null;
}

const COLONNES = `c.id, c.dossier_id, c.intitule, c.secteur, c.origine, c.code_depart, c.modele_id,
  mv.version AS modele_version, c.statut, c.a_valider_par_un_expert, c.contenu, c.cree_par,
  uc.nom AS cree_par_nom, c.cree_le, c.archivee_le, c.motif_archivage`;
const JOINTURES = `FROM red_checklists c
  JOIN utilisateurs uc ON uc.id = c.cree_par
  LEFT JOIN red_checklist_versions mv ON mv.id = c.modele_version_id`;

/** Réponses COURANTES (la dernière de chaque item) des check-lists données. */
async function reponsesCourantes(db: Db, ids: string[]): Promise<Map<string, Ligne[]>> {
  const sortie = new Map<string, Ligne[]>();
  if (ids.length === 0) return sortie;
  const r = await db.query(
    `SELECT DISTINCT ON (r.checklist_id, r.item_id) r.checklist_id, r.item_id, r.reponse, r.commentaire,
       r.auteur, ua.nom AS auteur_nom, r.cree_le
     FROM red_checklist_reponses r JOIN utilisateurs ua ON ua.id = r.auteur
     WHERE r.checklist_id = ANY($1::uuid[])
     ORDER BY r.checklist_id, r.item_id, r.rang DESC`,
    [ids],
  );
  for (const l of r.rows as Ligne[]) {
    const liste = sortie.get(l.checklist_id as string) ?? [];
    liste.push(l);
    sortie.set(l.checklist_id as string, liste);
  }
  return sortie;
}

/** Carte item → réponse courante, dans l'ordre des items. */
function carteReponses(courantes: readonly Ligne[]): Record<string, ReponseChecklist> {
  const carte: Record<string, ReponseChecklist> = {};
  for (const l of courantes) carte[l.item_id as string] = l.reponse as ReponseChecklist;
  return carte;
}

async function lireLigne(db: Db, id: string): Promise<ChecklistLue | null> {
  const r = await db.query(`SELECT ${COLONNES} ${JOINTURES} WHERE c.id = $1`, [id]);
  return (r.rows[0] as ChecklistLue | undefined) ?? null;
}

async function peutRepondre(
  db: Db,
  auth: Auth,
  { dossier, mission }: AccesDossierRed,
  c: ChecklistLue,
): Promise<boolean> {
  return (
    c.statut === "active" &&
    dossier.statut !== "clos" &&
    mission.statut !== "cloturee" &&
    aPermission(auth.roles, "redressement.ecrire") &&
    (await peutEcrireDansDossier(db, auth, mission))
  );
}

async function vueChecklist(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  c: ChecklistLue,
): Promise<RedChecklistVue> {
  const items = itemsDepuisContenu(c.contenu);
  const courantes = (await reponsesCourantes(db, [c.id])).get(c.id) ?? [];
  const parItem = new Map(courantes.map((l) => [l.item_id as string, l]));
  const reponses: RedChecklistReponseVue[] = items.flatMap((i) => {
    const l = parItem.get(i.id);
    return l
      ? [
          {
            item_id: i.id,
            reponse: l.reponse as RedChecklistReponseVue["reponse"],
            commentaire: (l.commentaire as string | null) ?? null,
            auteur: personne(l.auteur as string, l.auteur_nom as string),
            cree_le: isoOuVide(l.cree_le as Date),
          },
        ]
      : [];
  });
  return {
    id: c.id,
    dossier_id: c.dossier_id,
    intitule: c.intitule,
    secteur: c.secteur,
    origine: c.origine,
    code_depart: c.code_depart,
    modele_id: c.modele_id,
    modele_version: c.modele_version,
    statut: c.statut,
    a_valider_par_un_expert: c.a_valider_par_un_expert,
    items: itemsVue(items),
    reponses,
    evaluation: vueEvaluationChecklist(evaluerChecklist(items, carteReponses(courantes))),
    cree_par: personne(c.cree_par, c.cree_par_nom),
    cree_le: isoOuVide(c.cree_le),
    archivee_le: iso(c.archivee_le),
    motif_archivage: c.motif_archivage,
    peut_repondre: await peutRepondre(db, auth, acces, c),
  };
}

/** Liste des check-lists d'un dossier (30 au plus), avec leurs taux calculés par le moteur. */
export async function listerChecklists(
  db: Db,
  dossier: DossierRed,
  statut: "active" | "archivee" | "toutes",
): Promise<RedChecklistsVue> {
  const r = await db.query(
    `SELECT ${COLONNES} ${JOINTURES}
     WHERE c.dossier_id = $1 AND ($2::text = 'toutes' OR c.statut = $2)
     ORDER BY c.cree_le DESC, c.id DESC LIMIT ${RED_CHECKLIST_PLAFONDS.checklists_par_dossier}`,
    [dossier.id, statut],
  );
  const lignes = r.rows as ChecklistLue[];
  const courantes = await reponsesCourantes(
    db,
    lignes.map((l) => l.id),
  );
  return {
    checklists: lignes.map((c): RedChecklistResumeVue => {
      const items = itemsDepuisContenu(c.contenu);
      const evaluation = evaluerChecklist(items, carteReponses(courantes.get(c.id) ?? []));
      return {
        id: c.id,
        intitule: c.intitule,
        secteur: c.secteur,
        origine: c.origine,
        statut: c.statut,
        a_valider_par_un_expert: c.a_valider_par_un_expert,
        nombre_items: items.length,
        completude_pb: evaluation.global.completude_pb,
        conformite_pb: evaluation.global.conformite_pb,
        cree_par: personne(c.cree_par, c.cree_par_nom),
        cree_le: isoOuVide(c.cree_le),
      };
    }),
  };
}

/** Activation dans le dossier (déjà verrouillé et ouvert) : instantané figé du contenu. */
export async function activerChecklist(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  corps: RedChecklistActivation,
): Promise<RedChecklistVue> {
  const { dossier } = acces;
  await verifierDebit(db, auth, DEBIT_CHECKLIST_ACTIVATIONS);
  let intitule: string;
  let secteur: RedSecteur;
  let json: string;
  let codeDepart: string | null = null;
  let modeleId: string | null = null;
  let versionId: string | null = null;
  let numeroVersion: number | null = null;
  if (corps.origine === "depart") {
    const depart = checklistDepart(corps.code);
    if (!depart) throw introuvable("Check-list de départ");
    ({ json } = contenuDepuisItems(depart.items));
    intitule = depart.intitule;
    secteur = depart.secteur;
    codeDepart = depart.code;
  } else {
    const m = await db.query(
      `SELECT m.id, m.intitule, m.secteur, v.id AS version_id, v.version, v.contenu
       FROM red_checklist_modeles m
       LEFT JOIN LATERAL (SELECT x.id, x.version, x.contenu FROM red_checklist_versions x
                          WHERE x.modele_id = m.id AND x.statut = 'publiee'
                          ORDER BY x.version DESC LIMIT 1) v ON true
       WHERE m.id = $1`,
      [corps.modele_id],
    );
    const ligne = m.rows[0] as Ligne | undefined;
    if (!ligne) throw introuvable("Modèle de check-list");
    if (!ligne.version_id) {
      throw new AppError(
        409,
        "RED_CHECKLIST_SANS_VERSION_PUBLIEE",
        "Ce modèle n'a pas de version publiée : publiez-le avant de l'activer.",
      );
    }
    ({ json } = contenuDepuisItems(itemsDepuisContenu(ligne.contenu)));
    intitule = ligne.intitule as string;
    secteur = ligne.secteur as RedSecteur;
    modeleId = ligne.id as string;
    versionId = ligne.version_id as string;
    numeroVersion = ligne.version as number;
  }
  const deja = await db.query(
    `SELECT 1 FROM red_checklists
     WHERE dossier_id = $1 AND statut = 'active'
       AND ((origine = 'depart' AND code_depart = $2) OR (origine = 'modele' AND modele_id = $3))
     LIMIT 1`,
    [dossier.id, codeDepart, modeleId],
  );
  if ((deja.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      "RED_CHECKLIST_DEJA_ACTIVE",
      "Cette check-list est déjà active dans le dossier : archivez-la avant de la réactiver.",
    );
  }
  const r = await db.query(
    `INSERT INTO red_checklists (cabinet_id, dossier_id, intitule, secteur, origine, code_depart, modele_id,
       modele_version_id, contenu, a_valider_par_un_expert, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      intitule,
      secteur,
      corps.origine,
      codeDepart,
      modeleId,
      versionId,
      json,
      corps.origine === "depart",
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journalRed(db, auth, "red_checklist", "activation", id, {
    dossier_id: dossier.id,
    origine: corps.origine,
    code_depart: codeDepart,
    modele_id: modeleId,
    version: numeroVersion,
  });
  return lireChecklistVue(db, auth, acces, id);
}

async function lireChecklistVue(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  id: string,
): Promise<RedChecklistVue> {
  const c = await lireLigne(db, id);
  if (!c) throw introuvable("Check-list");
  return vueChecklist(db, auth, acces, c);
}

const absente = () => introuvable("Check-list");

/** Check-list lisible : son dossier est visible (404 sinon, le même pour une check-list inconnue ou d'autrui). */
export async function checklistVisible(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ acces: AccesDossierRed; checklist: ChecklistLue }> {
  const c = await lireLigne(db, id);
  if (!c) throw absente();
  const acces = await exigerDossierRedVisible(db, auth, c.dossier_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? absente() : e;
  });
  return { acces, checklist: c };
}

/**
 * Check-list ouverte à l'écriture de l'utilisateur (404 / 403 / 409), dossier VERROUILLÉ avant toute
 * lecture dont une règle dépend, puis check-list relue.
 */
export async function checklistEcriture(
  db: Db,
  auth: Auth,
  id: string,
): Promise<{ acces: AccesDossierRed; checklist: ChecklistLue }> {
  const apercu = await lireLigne(db, id);
  if (!apercu) throw absente();
  const acces = await exigerDossierRedEcriture(db, auth, apercu.dossier_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? absente() : e;
  });
  const checklist = await lireLigne(db, id);
  if (!checklist) throw absente();
  return { acces, checklist };
}

/** Route : lecture d'une check-list avec l'évaluation du moteur. */
export async function detailChecklist(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  c: ChecklistLue,
): Promise<RedChecklistVue> {
  return vueChecklist(db, auth, acces, c);
}

const figee = () =>
  new AppError(409, "RED_CHECKLIST_FIGEE", "Cette check-list est archivée : elle est figée.");

/** Saisie d'un lot de réponses : ajout seul, la dernière réponse d'un item est la courante. */
export async function saisirReponses(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  c: ChecklistLue,
  corps: RedChecklistReponsesLot,
): Promise<RedChecklistVue> {
  if (c.statut === "archivee") throw figee();
  const ids = new Set(itemsDepuisContenu(c.contenu).map((i) => i.id));
  const inconnus = corps.reponses.filter((r) => !ids.has(r.item_id)).map((r) => r.item_id);
  if (inconnus.length > 0) {
    throw new ErreurRedressement(
      "QUESTION_INCONNUE",
      "Item inconnu dans la check-list.",
      inconnus.slice(0, 20),
    );
  }
  await verifierDebit(db, auth, DEBIT_CHECKLIST_REPONSES);
  const courantes = (await reponsesCourantes(db, [c.id])).get(c.id) ?? [];
  const parItem = new Map(courantes.map((l) => [l.item_id as string, l]));
  let ajoutees = 0;
  for (const r of corps.reponses) {
    const actuelle = parItem.get(r.item_id);
    // Une réponse identique à la courante n'ajoute rien (le plafond de volume est préservé).
    if (
      actuelle &&
      actuelle.reponse === r.reponse &&
      ((actuelle.commentaire as string | null) ?? null) === (r.commentaire ?? null)
    ) {
      continue;
    }
    await db.query(
      `INSERT INTO red_checklist_reponses (cabinet_id, checklist_id, dossier_id, item_id, reponse, commentaire, auteur)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auth.cabinetId,
        c.id,
        c.dossier_id,
        r.item_id,
        r.reponse,
        r.commentaire ?? null,
        auth.utilisateurId,
      ],
    );
    ajoutees += 1;
  }
  await journalRed(db, auth, "red_checklist", "reponses", c.id, {
    dossier_id: c.dossier_id,
    recues: corps.reponses.length,
    ajoutees,
  });
  return lireChecklistVue(db, auth, acces, c.id);
}

/** Archivage : la check-list devient figée (plus de réponse). Réversible par une nouvelle activation. */
export async function archiverChecklist(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  c: ChecklistLue,
  motif: string | null | undefined,
): Promise<RedChecklistVue> {
  if (c.statut === "archivee") throw figee();
  await db.query(
    `UPDATE red_checklists SET statut = 'archivee', motif_archivage = $2, archivee_par = $3, archivee_le = now()
     WHERE id = $1`,
    [c.id, motif ?? null, auth.utilisateurId],
  );
  await journalRed(db, auth, "red_checklist", "archivage", c.id, { dossier_id: c.dossier_id });
  return lireChecklistVue(db, auth, acces, c.id);
}
