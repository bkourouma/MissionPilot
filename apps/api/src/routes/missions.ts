import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  calculerBudget,
  figerTauxChange,
  figerVersion,
  PARITE_EUR_FCFA,
  sommerJours,
  type Devise,
} from "@missionpilot/engines";
import {
  aPermission,
  missionCreationSchema,
  missionDepuisPropositionSchema,
  missionDuplicationSchema,
  missionEquipeAjoutSchema,
  missionModeleSchema,
  missionModificationSchema,
  missionSignatureSchema,
  missionsListeQuerySchema,
  missionStatutSchema,
  type StatutMission,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { choisir, clauseSet, traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, interdit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, motifContient, paginer, paramsId } from "../http/outils.js";
import {
  estAssocie,
  exigerMissionModifiable,
  exigerMissionVisible,
  filtreVisibilite,
  modifieToutesLesMissions,
  STATUTS_SIGNES,
  voitToutesLesMissions,
  type MissionAcces,
} from "../missions/acces.js";
import {
  calculerDepuisDecoupage,
  chargerVersions,
  insererLignes,
  versVersionMoteur,
  vueVersion,
  type LigneBudgetDb,
} from "../missions/budget.js";
import {
  chargerDecoupage,
  copierElements,
  dupliquerDecoupage,
  elementsDeProposition,
  elementsDuModele,
} from "../missions/decoupage.js";
import { droitsBudget, slug } from "../missions/outils.js";
import { enregistrerBilanCloture } from "../finance/bilan.js";

const COLONNES = `m.id, m.intitule, m.client_id, cl.raison_sociale AS client_raison_sociale,
  m.type_mission_id, m.opportunite_id, m.proposition_id, m.mission_source_id, m.directeur_id, m.chef_id,
  m.date_debut::text AS date_debut, m.date_fin::text AS date_fin, m.devise, m.mode_facturation,
  m.statut, m.activite, m.secteur, m.bureau, m.date_signature::text AS date_signature, m.signee_par,
  m.taux_change::float8 AS taux_change, m.devise_reference, m.cloturee_le, m.cloturee_par,
  m.cree_par, m.cree_le, m.modifie_le`;
const DEPUIS = "missions m JOIN clients cl ON cl.id = m.client_id";
/**
 * Listes paginées par curseur, plus récentes d'abord (missions, opportunités) : tri
 * `cree_le DESC, id DESC`, page suivante par comparaison de ligne
 * `(cree_le, id) < (curseur)`, servis par l'index (cabinet_id, cree_le DESC, id DESC)
 * (migration 0121). Le curseur porte l'horodatage ISO à la microseconde (UTC) et l'id.
 * `alias` : alias SQL de la table (constante de code).
 */
export const cleTriCreation = (alias: "m" | "o") =>
  `to_char(${alias}.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export type CleTri = { cle_tri: string; id: string };
const HORODATAGE_CURSEUR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z$/;

/** Curseur (horodatage ISO µs, id) ; 400 s'il est illisible ou si la date n'existe pas. */
export function decoderCurseurCreation(curseur: string | undefined): [string, string] | null {
  const cle = decoderCurseur(curseur);
  if (!cle) return null;
  const ms = HORODATAGE_CURSEUR.exec(cle[0])?.[1];
  const date = ms ? new Date(`${ms}Z`) : null;
  // Date réelle (pas de 31 février) et postérieure à 1970 : le transtypage SQL ne peut pas échouer.
  const valide = date !== null && date.getTime() >= 0 && date.toISOString() === `${ms}Z`; // NaN >= 0 : faux
  if (!valide) throw requeteInvalide("Curseur de pagination invalide.");
  return cle;
}
const CHAMPS = [
  "intitule",
  "client_id",
  "type_mission_id",
  "directeur_id",
  "chef_id",
  "date_debut",
  "date_fin",
  "devise",
  "mode_facturation",
  "statut",
  "activite",
  "secteur",
  "bureau",
] as const;
const REFERENCE = "Client, type, directeur ou chef de mission inconnu dans ce cabinet.";

/** Transitions simples ; signee et cloturee passent par /signer et /cloturer. */
const TRANSITIONS: Partial<Record<StatutMission, readonly StatutMission[]>> = {
  opportunite: ["proposition"],
  signee: ["en_cours"],
  en_cours: ["a_cloturer"],
  a_cloturer: ["en_cours"],
};

const paramsMembre = z.object({ id: z.string().uuid(), utilisateurId: z.string().uuid() });

async function lireMission(db: Db, id: string): Promise<Record<string, unknown>> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE m.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Mission");
  const equipe = await db.query(
    `SELECT e.utilisateur_id, u.nom FROM mission_equipe e JOIN utilisateurs u ON u.id = e.utilisateur_id
     WHERE e.mission_id = $1 ORDER BY u.nom, e.utilisateur_id`,
    [id],
  );
  return { ...r.rows[0], equipe: equipe.rows };
}

/**
 * Directeur : associé ou directeur de mission ; chef : chef de mission,
 * directeur ou associé. Utilisateurs actifs du cabinet uniquement.
 */
async function verifierResponsables(
  db: Db,
  directeurId: string | null | undefined,
  chefId: string | null | undefined,
): Promise<void> {
  const verifier = async (id: string | null | undefined, roles: string[], quoi: string) => {
    if (!id) return;
    const r = await db.query(
      "SELECT 1 FROM utilisateurs WHERE id = $1 AND actif AND roles && $2::text[]",
      [id, roles],
    );
    if (!r.rowCount) throw requeteInvalide(`${quoi} : utilisateur inconnu ou sans le rôle requis.`);
  };
  await verifier(directeurId, ["associe", "directeur_mission"], "Directeur de mission");
  await verifier(chefId, ["associe", "directeur_mission", "chef_mission"], "Chef de mission");
}

/**
 * Un créateur qui ne voit pas toutes les missions devient chef de la mission
 * (sinon il ne la verrait pas) ; s'il en désigne un autre sans en être directeur, refus.
 */
function responsablesDuCreateur(
  auth: Auth,
  directeurId: string | null,
  chefId: string | null,
): { directeurId: string | null; chefId: string | null } {
  if (voitToutesLesMissions(auth) || [directeurId, chefId].includes(auth.utilisateurId)) {
    return { directeurId, chefId };
  }
  if (chefId !== null) {
    throw requeteInvalide("Vous devez être directeur ou chef de la mission que vous créez.");
  }
  return { directeurId, chefId: auth.utilisateurId };
}

interface NouvelleMission {
  intitule: string;
  client_id: string;
  type_mission_id: string | null;
  opportunite_id?: string | null;
  proposition_id?: string | null;
  mission_source_id?: string | null;
  directeur_id: string | null;
  chef_id: string | null;
  date_debut: string | null;
  date_fin: string | null;
  devise: string;
  mode_facturation: string;
  statut: StatutMission;
  activite?: string | null;
  secteur?: string | null;
  bureau?: string | null;
}

async function insererMission(db: Db, auth: Auth, m: NouvelleMission): Promise<string> {
  const { directeurId, chefId } = responsablesDuCreateur(auth, m.directeur_id, m.chef_id);
  await verifierResponsables(db, directeurId, chefId);
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO missions (cabinet_id, intitule, client_id, type_mission_id, opportunite_id,
         proposition_id, mission_source_id, directeur_id, chef_id, date_debut, date_fin, devise,
         mode_facturation, statut, activite, secteur, bureau, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id`,
      [
        auth.cabinetId,
        m.intitule,
        m.client_id,
        m.type_mission_id,
        m.opportunite_id ?? null,
        m.proposition_id ?? null,
        m.mission_source_id ?? null,
        directeurId,
        chefId,
        m.date_debut,
        m.date_fin,
        m.devise,
        m.mode_facturation,
        m.statut,
        m.activite ?? null,
        m.secteur ?? null,
        m.bureau ?? null,
        auth.utilisateurId,
      ],
    ),
    { "*": "Cette proposition a déjà donné une mission." },
    REFERENCE,
  );
  return r.rows[0].id as string;
}

const estFcfa = (d: string) => d === "XOF" || d === "XAF";

/** Parité fixe (légale) entre deux devises, ou undefined pour une devise flottante. */
export function pariteFixe(devise: string, deviseCabinet: string): number | undefined {
  if (devise === deviseCabinet) return 1;
  if (estFcfa(devise) && estFcfa(deviseCabinet)) return 1;
  if (devise === "EUR" && estFcfa(deviseCabinet)) return PARITE_EUR_FCFA;
  // Arrondi à la précision de la colonne (numeric(20, 10)).
  if (estFcfa(devise) && deviseCabinet === "EUR") return Number((1 / PARITE_EUR_FCFA).toFixed(10));
  return undefined;
}

/** Bornes d'un taux flottant saisi (1 unité de la devise de mission en devise du cabinet). */
export const TAUX_FLOTTANT_MIN = 0.000001;
export const TAUX_FLOTTANT_MAX = 1_000_000;

/**
 * Taux de change figé à la signature (FIN-04). Parité fixe (même devise : 1 ;
 * XOF/XAF : 1 ; EUR/FCFA : 655,957) : imposée, tout autre taux saisi est
 * refusé (400). Devise flottante (USD) : le taux est requis, saisi par un
 * signataire qui voit les données financières (« finance.lire ») ou un
 * associé, et borné.
 */
export function tauxDeSignature(
  devise: string,
  deviseCabinet: string,
  saisi?: number,
  peutSaisirFlottant = false,
): number {
  const fixe = pariteFixe(devise, deviseCabinet);
  if (fixe !== undefined) {
    if (saisi !== undefined && Math.abs(saisi - fixe) > fixe * 1e-9) {
      throw requeteInvalide(
        `Parité fixe ${devise} → ${deviseCabinet} (${fixe}) : aucun autre taux n'est accepté.`,
      );
    }
    return fixe;
  }
  if (saisi === undefined) {
    throw requeteInvalide(`Taux de change ${devise} → ${deviseCabinet} requis à la signature.`);
  }
  if (!peutSaisirFlottant) {
    throw new AppError(
      403,
      "INTERDIT",
      `Le taux ${devise} → ${deviseCabinet} est saisi par un associé ou un gestionnaire.`,
    );
  }
  if (!(saisi >= TAUX_FLOTTANT_MIN && saisi <= TAUX_FLOTTANT_MAX)) {
    throw requeteInvalide(
      `Taux de change hors bornes (${TAUX_FLOTTANT_MIN} à ${TAUX_FLOTTANT_MAX}).`,
    );
  }
  return saisi;
}

async function prochaineVersionDocument(db: Db, missionId: string, type: string, nom: string) {
  const r = await db.query(
    `SELECT coalesce(max(version), 0) + 1 AS v FROM mission_documents
     WHERE mission_id = $1 AND type = $2 AND nom = $3`,
    [missionId, type, nom],
  );
  return r.rows[0].v as number;
}

async function signer(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  corps: z.infer<typeof missionSignatureSchema>,
) {
  const cabinet = await db.query("SELECT devise_base FROM cabinets WHERE id = $1", [
    auth.cabinetId,
  ]);
  const deviseCabinet = cabinet.rows[0].devise_base as Devise;
  const finance = aPermission(auth.roles, "finance.lire");
  const taux = figerTauxChange(
    mission.devise as Devise,
    deviseCabinet,
    tauxDeSignature(mission.devise, deviseCabinet, corps.taux_change, finance || estAssocie(auth)),
    corps.date_signature,
  );
  // Sous-traitance : donnée financière interne (FIN-02), comme fusionnerLignesSaisies.
  if (!finance && corps.lignes_supplementaires.some((l) => l.nature === "sous_traitance")) {
    throw interdit();
  }
  if (mission.proposition_id && corps.taux_vente) {
    // Le prix validé par l'associé dans la proposition ne se renégocie pas à la signature.
    const r = await db.query(
      `SELECT g.code, t.taux_journalier FROM proposition_taux t JOIN grades g ON g.id = t.grade_id
       WHERE t.proposition_id = $1 AND t.taux_journalier IS NOT NULL`,
      [mission.proposition_id],
    );
    const proposes = new Map(r.rows.map((t) => [t.code as string, Number(t.taux_journalier)]));
    const divergents = Object.entries(corps.taux_vente)
      .filter(([code, valeur]) => proposes.has(code) && proposes.get(code) !== valeur)
      .map(([code]) => code)
      .sort();
    if (divergents.length > 0) {
      throw requeteInvalide(
        `Taux de vente différents de la proposition validée : ${divergents.join(", ")}.`,
      );
    }
  }
  const calcul = await calculerDepuisDecoupage(db, mission, {
    date: corps.date_signature,
    tauxVente: corps.taux_vente,
  });
  if (!calcul.lignes.some((l) => l.nature === "honoraires")) {
    throw requeteInvalide(
      "Le découpage ne porte aucun jour budgété : budgéter les tâches d'abord.",
    );
  }
  const supplementaires: LigneBudgetDb[] = corps.lignes_supplementaires.map((l) => ({
    cle: `${l.nature}:${slug(l.libelle)}`,
    libelle: l.libelle,
    nature: l.nature,
    grade_code: null,
    jours: null,
    prix_journalier: null,
    montant_forfait: l.montant,
    refacturable: l.refacturable,
  }));
  const lignes = [...calcul.lignes, ...supplementaires];
  const v = await traduireErreursPg(
    db.query(
      `INSERT INTO budget_versions (cabinet_id, mission_id, numero, type, devise, cree_par)
       VALUES ($1, $2, 1, 'initial', $3, $4) RETURNING id`,
      [auth.cabinetId, mission.id, mission.devise, auth.utilisateurId],
    ),
    { "*": "Cette mission a déjà un budget initial." },
  );
  const versionId = v.rows[0].id as string;
  await insererLignes(db, auth.cabinetId, mission.id, versionId, lignes);
  // Le moteur valide les lignes et fige la version ; la base la rend immuable.
  const moteur = versVersionMoteur({
    id: versionId,
    numero: 1,
    type: "initial",
    devise: mission.devise as Devise,
    figee: false,
    motif: null,
    lignes,
  });
  calculerBudget(moteur);
  const figee = figerVersion(moteur, corps.date_signature);
  await db.query(
    `UPDATE budget_versions SET figee = true, date_figeage = $2, validee_par = $3, validee_le = now()
     WHERE id = $1`,
    [versionId, figee.dateFigeage, auth.utilisateurId],
  );
  await db.query(
    `UPDATE missions SET statut = 'signee', date_signature = $2, signee_par = $3, taux_change = $4,
       devise_reference = $5, modifie_le = now() WHERE id = $1`,
    [mission.id, corps.date_signature, auth.utilisateurId, taux.taux, deviseCabinet],
  );
  await db.query(
    `INSERT INTO mission_documents (cabinet_id, mission_id, type, nom, version, auteur_id)
     VALUES ($1, $2, 'lettre_de_mission', 'Lettre de mission', $3, $4)`,
    [
      auth.cabinetId,
      mission.id,
      await prochaineVersionDocument(db, mission.id, "lettre_de_mission", "Lettre de mission"),
      auth.utilisateurId,
    ],
  );
  return {
    versionId,
    lignes: lignes.length,
    coutsManquants: calcul.coutsManquants,
    tauxChange: taux.taux,
    deviseReference: deviseCabinet,
  };
}

/** Enregistre le découpage d'une mission comme type du catalogue (MIS-12). */
async function enregistrerModele(
  db: Db,
  cabinetId: string,
  missionId: string,
  code: string,
  libelle: string,
): Promise<string> {
  const t = await traduireErreursPg(
    db.query(
      `INSERT INTO types_mission (cabinet_id, code, libelle, domaine, mode_facturation, equipe_type)
       SELECT m.cabinet_id, $2, $3, tm.domaine, m.mode_facturation, '[]'::jsonb
       FROM missions m LEFT JOIN types_mission tm ON tm.id = m.type_mission_id WHERE m.id = $1
       RETURNING id`,
      [missionId, code, libelle],
    ),
    { "*": "Un type de mission porte déjà ce code." },
  );
  const typeId = t.rows[0].id as string;
  const d = await chargerDecoupage(db, missionId);
  const grades = await db.query(
    `SELECT c.id, g.code FROM collaborateurs c JOIN grades g ON g.id = c.grade_id`,
  );
  const gradeCollaborateur = new Map(grades.rows.map((g) => [g.id as string, g.code as string]));
  const joursParGrade = (tacheId: string) => {
    const parCode = new Map<string, number[]>();
    for (const l of d.lignes.filter((x) => x.tache_id === tacheId)) {
      const code =
        (l.grade_code as string | null) ?? gradeCollaborateur.get(l.collaborateur_id as string);
      if (code) parCode.set(code, [...(parCode.get(code) ?? []), Number(l.jours)]);
    }
    return Object.fromEntries([...parCode].map(([c, j]) => [c, sommerJours(j)]));
  };
  const inserer = async (
    parent: string | null,
    niveau: number,
    e: Record<string, unknown>,
    jours: Record<string, number> = {},
  ) =>
    (
      await db.query(
        `INSERT INTO modele_elements (cabinet_id, type_mission_id, parent_id, niveau, libelle, ordre,
           jours_par_grade, est_livrable)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          cabinetId,
          typeId,
          parent,
          niveau,
          e.libelle,
          e.ordre,
          JSON.stringify(jours),
          e.est_livrable ?? false,
        ],
      )
    ).rows[0].id as string;
  for (const p of d.phases) {
    const phaseId = await inserer(null, 1, p);
    for (const l of d.lots.filter((x) => x.phase_id === p.id)) {
      const lotId = await inserer(phaseId, 2, l);
      for (const t of d.taches.filter((x) => x.lot_id === l.id)) {
        await inserer(lotId, 3, t, joursParGrade(t.id as string));
      }
    }
    // Une tâche sans lot devient un élément de niveau 2 portant ses jours.
    for (const t of d.taches.filter((x) => x.phase_id === p.id && x.lot_id === null)) {
      await inserer(phaseId, 2, t, joursParGrade(t.id as string));
    }
  }
  return typeId;
}

/** Fiche mission (MIS-07, MIS-09, MIS-10, MIS-12) et cycle de vie. */
export const routesMissions: FastifyPluginAsync = async (app) => {
  app.get("/missions", async (request) => {
    const auth = exiger(request, "mission.lire");
    const q = missionsListeQuerySchema.parse(request.query);
    const apres = decoderCurseurCreation(q.curseur);
    // Pagination par curseur (plus récentes d'abord) : clé (date de création, id), stable.
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES}, ${cleTriCreation("m")} AS cle_tri FROM ${DEPUIS}
         WHERE ${filtreVisibilite(1, 2)}
           AND ($3::text IS NULL OR m.statut = $3) AND ($4::uuid IS NULL OR m.client_id = $4)
           AND ($5::text IS NULL OR m.intitule ILIKE $5 OR cl.raison_sociale ILIKE $5)
           AND ($6::timestamptz IS NULL OR (m.cree_le, m.id) < ($6::timestamptz, $7::uuid))
         ORDER BY m.cree_le DESC, m.id DESC LIMIT $8`,
        [
          voitToutesLesMissions(auth),
          auth.utilisateurId,
          q.statut ?? null,
          q.client_id ?? null,
          motifContient(q.q),
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows as (Record<string, unknown> & CleTri)[], q.limite);
      return { elements: page.elements, suivant: page.curseur_suivant };
    });
  });

  app.get("/missions/:id", async (request) => {
    const auth = exiger(request, "mission.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      return lireMission(db, id);
    });
  });

  app.post("/missions", async (request, reply) => {
    const auth = exiger(request, "mission.creer");
    const m = missionCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      let mode = m.mode_facturation;
      if (m.type_mission_id) {
        const t = await db.query("SELECT mode_facturation FROM types_mission WHERE id = $1", [
          m.type_mission_id,
        ]);
        if (!t.rows[0]) throw requeteInvalide("Type de mission inconnu dans ce cabinet.");
        mode ??= t.rows[0].mode_facturation;
      }
      if (!mode) throw requeteInvalide("Le mode de facturation est requis sans type de mission.");
      const id = await insererMission(db, auth, { ...m, mode_facturation: mode });
      if (m.type_mission_id) {
        await copierElements(db, auth.cabinetId, id, await elementsDuModele(db, m.type_mission_id));
      }
      const lue = await lireMission(db, id);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "mission",
        entiteId: id,
        details: { apres: choisir(lue, CHAMPS) },
      });
      return lue;
    });
    reply.status(201);
    return creee;
  });

  app.post("/propositions/:id/mission", async (request, reply) => {
    const auth = exiger(request, "mission.creer");
    const { id } = paramsId.parse(request.params);
    const corps = missionDepuisPropositionSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await db.query(
        `SELECT p.id, p.statut, p.intitule, p.devise, p.type_mission_id, p.opportunite_id,
           o.client_id, t.mode_facturation
         FROM propositions p JOIN opportunites o ON o.id = p.opportunite_id
         JOIN types_mission t ON t.id = p.type_mission_id WHERE p.id = $1 FOR UPDATE OF p`,
        [id],
      );
      const prop = p.rows[0];
      if (!prop) throw introuvable("Proposition");
      if (prop.statut !== "acceptee") {
        throw conflit("Seule une proposition acceptée par le client devient une mission.");
      }
      const missionId = await insererMission(db, auth, {
        intitule: corps.intitule ?? prop.intitule,
        client_id: prop.client_id,
        type_mission_id: prop.type_mission_id,
        opportunite_id: prop.opportunite_id,
        proposition_id: id,
        directeur_id: corps.directeur_id ?? null,
        chef_id: corps.chef_id ?? null,
        date_debut: corps.date_debut ?? null,
        date_fin: corps.date_fin ?? null,
        devise: prop.devise,
        mode_facturation: corps.mode_facturation ?? prop.mode_facturation,
        statut: "proposition",
        activite: corps.activite,
        secteur: corps.secteur,
        bureau: corps.bureau,
      });
      await copierElements(db, auth.cabinetId, missionId, await elementsDeProposition(db, id));
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation_depuis_proposition",
        entite: "mission",
        entiteId: missionId,
        details: { proposition_id: id },
      });
      return lireMission(db, missionId);
    });
    reply.status(201);
    return creee;
  });

  app.patch("/missions/:id", async (request) => {
    const auth = exiger(request, "mission.creer");
    const { id } = paramsId.parse(request.params);
    const modif = missionModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionModifiable(db, auth, id);
      const signee = STATUTS_SIGNES.includes(mission.statut);
      if (signee && modif.devise !== undefined && modif.devise !== mission.devise) {
        throw conflit("La devise est figée à la signature de la lettre de mission.");
      }
      if (signee && modif.mode_facturation !== undefined) {
        const r = await db.query("SELECT mode_facturation FROM missions WHERE id = $1", [id]);
        if (r.rows[0].mode_facturation !== modif.mode_facturation) {
          throw conflit("Le mode de facturation est figé à la signature de la lettre de mission.");
        }
      }
      if (
        !modifieToutesLesMissions(auth) &&
        (modif.directeur_id !== undefined || modif.chef_id !== undefined)
      ) {
        // Un chef ne se retire pas lui-même ni ne réattribue la mission.
        throw interdit();
      }
      if (
        modif.directeur_id !== undefined &&
        modif.directeur_id !== mission.directeur_id &&
        !estAssocie(auth)
      ) {
        // Le directeur valide les révisions et signe : seul un associé le désigne.
        throw interdit();
      }
      await verifierResponsables(db, modif.directeur_id, modif.chef_id);
      const avant = await lireMission(db, id);
      const set = clauseSet(modif, 2);
      await traduireErreursPg(
        db.query(`UPDATE missions SET ${set.sql}, modifie_le = now() WHERE id = $1`, [
          id,
          ...set.valeurs,
        ]),
        {},
        REFERENCE,
      );
      const apres = await lireMission(db, id);
      const champs = Object.keys(modif);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "mission",
        entiteId: id,
        details: { avant: choisir(avant, champs), apres: choisir(apres, champs) },
      });
      return apres;
    });
  });

  app.post("/missions/:id/statut", async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const { statut } = missionStatutSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionModifiable(db, auth, id);
      if (!TRANSITIONS[mission.statut]?.includes(statut)) {
        throw conflit(`Transition impossible : ${mission.statut} → ${statut}.`);
      }
      await db.query("UPDATE missions SET statut = $2, modifie_le = now() WHERE id = $1", [
        id,
        statut,
      ]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "changement_statut",
        entite: "mission",
        entiteId: id,
        details: { avant: mission.statut, apres: statut },
      });
      return lireMission(db, id);
    });
  });

  app.post("/missions/:id/signer", async (request) => {
    const auth = exiger(request, "mission.signer");
    const { id } = paramsId.parse(request.params);
    const corps = missionSignatureSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionModifiable(db, auth, id);
      if (mission.statut !== "proposition") {
        throw conflit("Seule une mission au stade de la proposition se signe.");
      }
      if (!mission.directeur_id) throw requeteInvalide("Désigner d'abord le directeur de mission.");
      if (mission.directeur_id !== auth.utilisateurId && !estAssocie(auth)) {
        throw new AppError(
          403,
          "INTERDIT",
          "La lettre de mission est signée par le directeur de la mission ou un associé.",
        );
      }
      const resultat = await signer(db, auth, mission, corps);
      // Journal sans montant : date, version figée et nombre de lignes.
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "signature",
        entite: "mission",
        entiteId: id,
        details: {
          date_signature: corps.date_signature,
          version_id: resultat.versionId,
          lignes: resultat.lignes,
          taux_change: resultat.tauxChange,
          devise_reference: resultat.deviseReference,
        },
      });
      const droits = droitsBudget(auth);
      const versions = await chargerVersions(db, id);
      return {
        mission: await lireMission(db, id),
        budget_initial: vueVersion(versions[0] as (typeof versions)[number], droits),
        ...(droits.finance ? { couts_manquants: resultat.coutsManquants } : {}),
      };
    });
  });

  app.post("/missions/:id/cloturer", async (request) => {
    const auth = exiger(request, "mission.cloturer");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionModifiable(db, auth, id);
      if (mission.statut !== "a_cloturer") throw conflit("La mission doit être « à clôturer ».");
      await db.query(
        `UPDATE missions SET statut = 'cloturee', cloturee_le = now(), cloturee_par = $2,
           modifie_le = now() WHERE id = $1`,
        [id, auth.utilisateurId],
      );
      // Bilan de rentabilité archivé (snapshot immuable, finance/bilan.ts).
      await enregistrerBilanCloture(db, auth, id);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "cloture",
        entite: "mission",
        entiteId: id,
        details: {},
      });
      return lireMission(db, id);
    });
  });

  app.post("/missions/:id/dupliquer", async (request, reply) => {
    const auth = exiger(request, "mission.creer");
    const { id } = paramsId.parse(request.params);
    const corps = missionDuplicationSchema.parse(request.body);
    const copie = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const source = await lireMission(db, id);
      const nouvelle = await insererMission(db, auth, {
        intitule: corps.intitule,
        client_id: corps.client_id ?? (source.client_id as string),
        type_mission_id: source.type_mission_id as string | null,
        mission_source_id: id,
        directeur_id: source.directeur_id as string | null,
        chef_id: source.chef_id as string | null,
        date_debut: null,
        date_fin: null,
        devise: source.devise as string,
        mode_facturation: source.mode_facturation as string,
        statut: "proposition",
        activite: source.activite as string | null,
        secteur: source.secteur as string | null,
        bureau: source.bureau as string | null,
      });
      await dupliquerDecoupage(db, auth.cabinetId, id, nouvelle);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "duplication",
        entite: "mission",
        entiteId: nouvelle,
        details: { source_id: id },
      });
      return lireMission(db, nouvelle);
    });
    reply.status(201);
    return copie;
  });

  app.post("/missions/:id/modele", async (request, reply) => {
    const auth = exiger(request, "catalogue.ecrire");
    const { id } = paramsId.parse(request.params);
    const { code, libelle } = missionModeleSchema.parse(request.body);
    const type = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const typeId = await enregistrerModele(db, auth.cabinetId, id, code, libelle);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "enregistrement_modele",
        entite: "type_mission",
        entiteId: typeId,
        details: { mission_id: id, code, libelle },
      });
      const r = await db.query(
        `SELECT id, code, libelle, mode_facturation, actif FROM types_mission WHERE id = $1`,
        [typeId],
      );
      return r.rows[0];
    });
    reply.status(201);
    return type;
  });

  app.post("/missions/:id/equipe", async (request, reply) => {
    const auth = exiger(request, "mission.planifier");
    const { id } = paramsId.parse(request.params);
    const { utilisateur_id } = missionEquipeAjoutSchema.parse(request.body);
    const mission = await app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const actif = await db.query("SELECT 1 FROM utilisateurs WHERE id = $1 AND actif", [
        utilisateur_id,
      ]);
      if (!actif.rowCount) throw requeteInvalide("Utilisateur inconnu ou inactif dans ce cabinet.");
      // Un membre entré par affectation (source « affectation ») devient un
      // membre manuel : il ne sera plus retiré avec sa dernière affectation.
      const ajout = await traduireErreursPg(
        db.query(
          `INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id, ajoute_par)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (mission_id, utilisateur_id) DO UPDATE
             SET source = 'manuel', ajoute_par = EXCLUDED.ajoute_par, ajoute_le = now()
             WHERE mission_equipe.source = 'affectation'
           RETURNING id`,
          [auth.cabinetId, id, utilisateur_id, auth.utilisateurId],
        ),
        { "*": "Cet utilisateur est déjà dans l'équipe." },
        "Utilisateur inconnu dans ce cabinet.",
      );
      if (!ajout.rowCount) throw conflit("Cet utilisateur est déjà dans l'équipe.");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "ajout_equipe",
        entite: "mission",
        entiteId: id,
        details: { utilisateur_id },
      });
      return lireMission(db, id);
    });
    reply.status(201);
    return mission;
  });

  app.delete("/missions/:id/equipe/:utilisateurId", async (request) => {
    const auth = exiger(request, "mission.planifier");
    const { id, utilisateurId } = paramsMembre.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionModifiable(db, auth, id);
      const r = await db.query(
        "DELETE FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2",
        [id, utilisateurId],
      );
      if (!r.rowCount) throw introuvable("Membre de l'équipe");
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "retrait_equipe",
        entite: "mission",
        entiteId: id,
        details: { utilisateur_id: utilisateurId },
      });
      return lireMission(db, id);
    });
  });
};
