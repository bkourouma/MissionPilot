/** Gestion du portail : documents partageables et brouillon des partages (module extrait de `portail-gestion.ts`). */
import { missionGerable } from "./portail-gestion-acces";
import type {
  DocumentCandidat,
  DocumentPartageLu,
  MissionClient,
  PartagesClient,
} from "./portail-gestion-types";
import {
  TYPES_DOCUMENT_PARTAGEABLES,
  type Role,
  type StatutMission,
  type TypeDocument,
} from "@missionpilot/shared";

// --- Documents partageables --------------------------------------------------------------------

export const estTypePartageable = (type: string) =>
  (TYPES_DOCUMENT_PARTAGEABLES as readonly string[]).includes(type);

/**
 * Comme l'API : livrable ou lettre de mission, hors circuit IA ou VALIDÉ (« l'IA propose,
 * l'expert dispose » : aucun brouillon IA n'atteint le client).
 */
export function documentPartageable(d: Pick<DocumentCandidat, "type" | "statut_contenu">): boolean {
  return estTypePartageable(d.type) && (d.statut_contenu === null || d.statut_contenu === "valide");
}

export const RAISON_CONTENU_IA = "Contenu produit par l'IA : à valider avant tout partage.";

/** Document affiché dans les partages d'une mission. */
export interface LigneDocumentPartage {
  id: string;
  type: TypeDocument;
  nom: string;
  version: number;
  partageable: boolean;
  /** Pourquoi le document ne peut pas être partagé. */
  raison: string | null;
  /** Version partagée plus ancienne que la dernière : numéro de la dernière version. */
  versionPlusRecente: number | null;
}

const comparerDocuments = (a: LigneDocumentPartage, b: LigneDocumentPartage) =>
  a.type.localeCompare(b.type) || a.nom.localeCompare(b.nom, "fr") || b.version - a.version;

/**
 * Documents d'une mission à proposer au partage : dernières versions des livrables et lettres
 * de mission (les autres types ne se partagent pas), plus les versions déjà partagées qui ne
 * sont plus les dernières (pour pouvoir les retirer).
 */
export function documentsDeMission(
  missionId: string,
  candidats: readonly DocumentCandidat[],
  partages: readonly DocumentPartageLu[],
): LigneDocumentPartage[] {
  const lignes: LigneDocumentPartage[] = [];
  const derniere = new Map<string, number>();
  for (const d of candidats) {
    if (d.mission_id !== missionId || !estTypePartageable(d.type)) continue;
    const partageable = documentPartageable(d);
    derniere.set(`${d.type}\u0000${d.nom}`, d.version);
    lignes.push({
      id: d.id,
      type: d.type,
      nom: d.nom,
      version: d.version,
      partageable,
      raison: partageable ? null : RAISON_CONTENU_IA,
      versionPlusRecente: null,
    });
  }
  const vus = new Set(lignes.map((l) => l.id));
  for (const p of partages) {
    if (p.mission_id !== missionId || vus.has(p.document_id)) continue;
    vus.add(p.document_id);
    const recente = derniere.get(`${p.type}\u0000${p.nom}`);
    lignes.push({
      id: p.document_id,
      type: p.type,
      nom: p.nom,
      version: p.version,
      partageable: true,
      raison: null,
      versionPlusRecente: recente !== undefined && recente > p.version ? recente : null,
    });
  }
  return lignes.sort(comparerDocuments);
}

/** Mission présentée dans le formulaire des partages. */
export interface MissionPartageable {
  id: string;
  intitule: string;
  statut: StatutMission;
  gerable: boolean;
  documents: LigneDocumentPartage[];
  /** La liste des documents n'a pas pu être chargée : seuls les documents déjà partagés figurent. */
  documentsIndisponibles: boolean;
}

/**
 * Missions du client à présenter : celles que l'utilisateur voit, plus les missions partagées
 * absentes de la liste. Les documents ne sont chargés que pour les missions gérables (`null` :
 * échec du chargement) ; pour les autres, seuls les documents partagés sont montrés.
 */
export function missionsPartageables(e: {
  missions: readonly MissionClient[];
  partages: Pick<PartagesClient, "missions" | "documents">;
  documents: ReadonlyMap<string, readonly DocumentCandidat[] | null>;
  utilisateurId: string;
  roles: readonly Role[];
}): MissionPartageable[] {
  const partageParMission = new Map(e.partages.missions.map((p) => [p.mission_id, p]));
  const resultat: MissionPartageable[] = [];
  const vues = new Set<string>();
  const ajouter = (id: string, intitule: string, statut: StatutMission, gerable: boolean) => {
    vues.add(id);
    const candidats = gerable ? e.documents.get(id) : [];
    resultat.push({
      id,
      intitule,
      statut,
      gerable,
      documents: documentsDeMission(id, candidats ?? [], e.partages.documents),
      documentsIndisponibles: gerable && !candidats,
    });
  };
  for (const m of e.missions) {
    if (vues.has(m.id)) continue;
    const gerable =
      partageParMission.get(m.id)?.gerable ?? missionGerable(m, e.utilisateurId, e.roles);
    ajouter(m.id, m.intitule, m.statut, gerable);
  }
  for (const p of e.partages.missions) {
    if (!vues.has(p.mission_id)) ajouter(p.mission_id, p.intitule, p.statut, p.gerable);
  }
  return resultat.sort((a, b) => a.intitule.localeCompare(b.intitule, "fr"));
}

// --- Brouillon des partages ------------------------------------------------------------------

export interface OptionsMission {
  jalons: boolean;
  factures: boolean;
}

/**
 * État du formulaire : une mission présente dans `missions` est partagée ; `documents` associe
 * l'identifiant d'un document partagé à sa mission ; `contact` vaut "" pour « aucun ».
 */
export interface BrouillonPartages {
  missions: Readonly<Record<string, OptionsMission>>;
  documents: Readonly<Record<string, string>>;
  contact: string;
}

export function brouillonDepuisPartages(p: PartagesClient): BrouillonPartages {
  return {
    missions: Object.fromEntries(
      p.missions.map((m) => [m.mission_id, { jalons: m.jalons, factures: m.factures }]),
    ),
    documents: Object.fromEntries(p.documents.map((d) => [d.document_id, d.mission_id])),
    contact: p.contact_principal?.id ?? "",
  };
}

/** Partager une mission (rien d'autre coché), ou la retirer avec ses jalons, factures et documents. */
export function basculerMission(
  b: BrouillonPartages,
  missionId: string,
  partagee: boolean,
): BrouillonPartages {
  if (partagee) {
    if (b.missions[missionId]) return b;
    return { ...b, missions: { ...b.missions, [missionId]: { jalons: false, factures: false } } };
  }
  const missions = { ...b.missions };
  delete missions[missionId];
  const documents = Object.fromEntries(
    Object.entries(b.documents).filter(([, mission]) => mission !== missionId),
  );
  return { ...b, missions, documents };
}

/** Cocher les jalons ou les factures partage aussi la mission. */
export function basculerOption(
  b: BrouillonPartages,
  missionId: string,
  option: keyof OptionsMission,
  valeur: boolean,
): BrouillonPartages {
  const actuelles = b.missions[missionId];
  if (!actuelles && !valeur) return b;
  const options = { ...(actuelles ?? { jalons: false, factures: false }), [option]: valeur };
  return { ...b, missions: { ...b.missions, [missionId]: options } };
}

/** Cocher un document partage aussi sa mission. */
export function basculerDocument(
  b: BrouillonPartages,
  documentId: string,
  missionId: string,
  coche: boolean,
): BrouillonPartages {
  if (!coche) {
    if (!(documentId in b.documents)) return b;
    const documents = { ...b.documents };
    delete documents[documentId];
    return { ...b, documents };
  }
  const avecMission = basculerMission(b, missionId, true);
  return { ...avecMission, documents: { ...avecMission.documents, [documentId]: missionId } };
}

const signature = (b: BrouillonPartages) =>
  JSON.stringify([
    Object.entries(b.missions)
      .map(([id, o]) => [id, o.jalons, o.factures])
      .sort(),
    Object.keys(b.documents).sort(),
    b.contact,
  ]);

export const brouillonModifie = (b: BrouillonPartages, initial: BrouillonPartages) =>
  signature(b) !== signature(initial);

/** Corps de `PUT /api/portail/partages?client_id=`. */
export interface ChargePartages {
  missions: { mission_id: string; jalons: boolean; factures: boolean }[];
  documents: string[];
  contact_principal_id?: string | null;
}

/**
 * Corps du remplacement des partages : seules les missions GÉRABLES (et leurs documents) sont
 * envoyées, les partages des autres missions restant intacts côté API. Le contact principal
 * n'est envoyé que s'il change ("" → null : plus aucun contact affiché).
 */
export function chargePartages(
  b: BrouillonPartages,
  initial: BrouillonPartages,
  gerables: ReadonlySet<string>,
): ChargePartages {
  const missions = Object.entries(b.missions)
    .filter(([id]) => gerables.has(id))
    .sort(([a], [z]) => a.localeCompare(z))
    .map(([mission_id, o]) => ({ mission_id, jalons: o.jalons, factures: o.factures }));
  const partagees = new Set(missions.map((m) => m.mission_id));
  const documents = Object.entries(b.documents)
    .filter(([, mission]) => partagees.has(mission))
    .map(([id]) => id)
    .sort();
  const charge: ChargePartages = { missions, documents };
  if (b.contact !== initial.contact)
    charge.contact_principal_id = b.contact === "" ? null : b.contact;
  return charge;
}
