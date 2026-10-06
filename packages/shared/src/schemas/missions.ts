import { z } from "zod";
import { MODES_FACTURATION } from "./catalogue";
import {
  auMoinsUnChamp,
  codeSchema,
  dateIsoSchema,
  deviseSchema,
  MESSAGE_CORPS_VIDE,
  montantSchema,
  texte,
  texteOptionnel,
} from "./commun";

/** Cycle de vie d'une mission (PRD, « Cycle de vie d'une mission »). */
export const STATUTS_MISSION = [
  "opportunite",
  "proposition",
  "signee",
  "en_cours",
  "a_cloturer",
  "cloturee",
] as const;
export type StatutMission = (typeof STATUTS_MISSION)[number];

/** Nombre de jours au centième (unité de calcul des moteurs). */
export const joursSchema = z
  .number()
  .min(0)
  .max(100_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "Jours au centième.");

const uuidOuNull = z.string().uuid().nullable();

const datesCoherentes = (v: { date_debut?: string | null; date_fin?: string | null }) =>
  !v.date_debut || !v.date_fin || v.date_fin >= v.date_debut;
const MESSAGE_DATES = "La date de fin précède la date de début.";

const champsMission = {
  intitule: texte(200),
  directeur_id: uuidOuNull,
  chef_id: uuidOuNull,
  date_debut: dateIsoSchema.nullable(),
  date_fin: dateIsoSchema.nullable(),
  devise: deviseSchema,
  mode_facturation: z.enum(MODES_FACTURATION),
  activite: texteOptionnel(120),
  secteur: texteOptionnel(120),
  bureau: texteOptionnel(120),
};

/** Création depuis un type du catalogue (copie du découpage) ou mission vierge. */
export const missionCreationSchema = z
  .object({
    ...champsMission,
    client_id: z.string().uuid(),
    type_mission_id: uuidOuNull.default(null),
    directeur_id: champsMission.directeur_id.default(null),
    chef_id: champsMission.chef_id.default(null),
    date_debut: champsMission.date_debut.default(null),
    date_fin: champsMission.date_fin.default(null),
    devise: champsMission.devise.default("XOF"),
    /** Par défaut : le mode du type de mission (obligatoire sans type). */
    mode_facturation: champsMission.mode_facturation.optional(),
    statut: z.enum(["opportunite", "proposition"]).default("proposition"),
  })
  .strict()
  .refine(datesCoherentes, MESSAGE_DATES);

/** Création depuis une proposition acceptée : client, type, devise et découpage en viennent. */
export const missionDepuisPropositionSchema = z
  .object(champsMission)
  .omit({ devise: true })
  .partial()
  .strict()
  .refine(datesCoherentes, MESSAGE_DATES);

export const missionModificationSchema = z
  .object(champsMission)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE)
  .refine(datesCoherentes, MESSAGE_DATES);

/** Transitions simples ; signature et clôture ont leurs propres routes. */
export const missionStatutSchema = z
  .object({ statut: z.enum(["proposition", "en_cours", "a_cloturer"]) })
  .strict();

export const NATURES_LIGNE_BUDGET = [
  "honoraires",
  "cout_interne",
  "debours",
  "sous_traitance",
] as const;
export type NatureLigneBudget = (typeof NATURES_LIGNE_BUDGET)[number];

/** Natures réservées aux droits finance (coûts internes et achats, FIN-02). */
export const NATURES_FINANCE: readonly NatureLigneBudget[] = ["cout_interne", "sous_traitance"];

const ligneSupplementaireSchema = z
  .object({
    nature: z.enum(["debours", "sous_traitance"]),
    libelle: texte(200),
    montant: montantSchema,
    refacturable: z.boolean().default(false),
  })
  .strict()
  .refine((l) => l.nature === "debours" || !l.refacturable, "Seul un débours est refacturable.");

/** Signature de la lettre de mission (MIS-07) : fige le budget initial (FIN-03, FIN-04). */
export const missionSignatureSchema = z
  .object({
    date_signature: dateIsoSchema,
    /** 1 unité de la devise de la mission = `taux_change` unités de la devise du cabinet. */
    taux_change: z.number().positive().max(1_000_000).optional(),
    /** Taux de vente journaliers par code de grade, en devise de la mission. */
    taux_vente: z
      .record(codeSchema, montantSchema)
      .refine((v) => Object.keys(v).length <= 30, "30 grades au plus.")
      .optional(),
    lignes_supplementaires: z.array(ligneSupplementaireSchema).max(50).default([]),
  })
  .strict();

export const missionDuplicationSchema = z
  .object({ intitule: texte(200), client_id: z.string().uuid().optional() })
  .strict();

export const missionModeleSchema = z.object({ code: codeSchema, libelle: texte(160) }).strict();

export const missionEquipeAjoutSchema = z.object({ utilisateur_id: z.string().uuid() }).strict();

export const missionsListeQuerySchema = z
  .object({
    statut: z.enum(STATUTS_MISSION).optional(),
    client_id: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

/* ----- Découpage (PLN-01, PLN-02, PLN-03) ----- */

const ordreSchema = z.number().int().min(0).max(100_000);

export const phaseCreationSchema = z
  .object({ libelle: texte(200), ordre: ordreSchema.default(0) })
  .strict();

export const phaseModificationSchema = z
  .object({ libelle: texte(200), ordre: ordreSchema })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

export const lotCreationSchema = z
  .object({
    phase_id: z.string().uuid(),
    libelle: texte(200),
    ordre: ordreSchema.default(0),
    est_livrable: z.boolean().default(false),
  })
  .strict();

export const lotModificationSchema = z
  .object({ libelle: texte(200), ordre: ordreSchema, est_livrable: z.boolean() })
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

const champsTache = {
  libelle: texte(200),
  ordre: ordreSchema,
  est_livrable: z.boolean(),
  date_debut: dateIsoSchema.nullable(),
  duree_jours_ouvres: z.number().int().min(1).max(1000),
};

export const tacheCreationSchema = z
  .object({
    /** Phase ou lot parent. */
    parent_id: z.string().uuid(),
    ...champsTache,
    ordre: champsTache.ordre.default(0),
    est_livrable: champsTache.est_livrable.default(false),
    date_debut: champsTache.date_debut.default(null),
    duree_jours_ouvres: champsTache.duree_jours_ouvres.default(1),
  })
  .strict();

export const tacheModificationSchema = z
  .object(champsTache)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

const champsJalon = {
  phase_id: uuidOuNull,
  libelle: texte(200),
  date_prevue: dateIsoSchema.nullable(),
  atteint: z.boolean(),
  ordre: ordreSchema,
};

export const jalonCreationSchema = z
  .object({
    ...champsJalon,
    phase_id: champsJalon.phase_id.default(null),
    date_prevue: champsJalon.date_prevue.default(null),
    atteint: champsJalon.atteint.default(false),
    ordre: champsJalon.ordre.default(0),
  })
  .strict();

export const jalonModificationSchema = z
  .object(champsJalon)
  .partial()
  .strict()
  .refine(auMoinsUnChamp, MESSAGE_CORPS_VIDE);

/** Budget en jours d'une tâche : par grade OU par personne, une ligne par cible. */
export const tacheBudgetSchema = z
  .object({
    lignes: z
      .array(
        z
          .object({
            grade_id: z.string().uuid().optional(),
            collaborateur_id: z.string().uuid().optional(),
            jours: joursSchema,
          })
          .strict()
          .refine(
            (l) => (l.grade_id === undefined) !== (l.collaborateur_id === undefined),
            "Une ligne porte un grade ou un collaborateur, pas les deux.",
          ),
      )
      .max(50)
      .refine((lignes) => {
        const cles = lignes.map((l) => l.grade_id ?? `c:${l.collaborateur_id}`);
        return new Set(cles).size === cles.length;
      }, "Un grade ou un collaborateur apparaît deux fois."),
  })
  .strict();

export const TYPES_ELEMENT_DECOUPAGE = ["phase", "lot", "tache", "jalon"] as const;

/** Réorganisation transactionnelle (glisser-déposer) : ordre et parent. */
export const reorganisationSchema = z
  .object({
    deplacements: z
      .array(
        z
          .object({
            type: z.enum(TYPES_ELEMENT_DECOUPAGE),
            id: z.string().uuid(),
            /** Lot : phase ; tâche : phase ou lot ; jalon : phase ou null ; phase : absent. */
            parent_id: uuidOuNull.optional(),
            ordre: ordreSchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const dependanceCreationSchema = z
  .object({
    predecesseur_id: z.string().uuid(),
    successeur_id: z.string().uuid(),
    decalage: z.number().int().min(-365).max(365).default(0),
  })
  .strict()
  .refine((d) => d.predecesseur_id !== d.successeur_id, "Une tâche ne dépend pas d'elle-même.");

/* ----- Versions de budget (FIN-03) ----- */

export const ligneBudgetSaisieSchema = z
  .object({
    /** Clé stable pour comparer les versions ; par défaut dérivée du libellé. */
    cle: z
      .string()
      .trim()
      .regex(/^[a-z0-9_:.-]{1,120}$/)
      .optional(),
    libelle: texte(200),
    nature: z.enum(NATURES_LIGNE_BUDGET),
    grade_code: codeSchema.optional(),
    jours: joursSchema.optional(),
    prix_journalier: montantSchema.optional(),
    montant_forfait: montantSchema.optional(),
    refacturable: z.boolean().default(false),
  })
  .strict()
  .refine(
    (l) =>
      (l.jours !== undefined &&
        l.prix_journalier !== undefined &&
        l.montant_forfait === undefined) ||
      (l.jours === undefined && l.prix_journalier === undefined && l.montant_forfait !== undefined),
    "Une ligne est soit au temps (jours et prix journalier), soit au forfait (montant).",
  )
  .refine((l) => l.nature === "debours" || !l.refacturable, "Seul un débours est refacturable.");

const lignesBudgetSchema = z
  .array(ligneBudgetSaisieSchema)
  .max(300)
  .refine((lignes) => {
    const cles = lignes.filter((l) => l.cle !== undefined).map((l) => l.cle);
    return new Set(cles).size === cles.length;
  }, "Deux lignes portent la même clé.");

export const revisionCreationSchema = z
  .object({
    motif: texte(2000),
    /** Lignes de la révision ; sans lignes, celles de la version de référence sont reprises. */
    lignes: lignesBudgetSchema.optional(),
    /** Recalcule les lignes depuis le budget en jours des tâches. */
    depuis_decoupage: z.boolean().default(false),
  })
  .strict()
  .refine(
    (r) => !(r.depuis_decoupage && r.lignes !== undefined),
    "Choisir des lignes saisies ou un recalcul depuis le découpage, pas les deux.",
  );

export const versionLignesSchema = z.object({ lignes: lignesBudgetSchema }).strict();

export const comparaisonQuerySchema = z
  .object({ avant: z.string().uuid(), apres: z.string().uuid() })
  .strict();

/* ----- Documents de mission (SOC-05) ----- */

export const TYPES_DOCUMENT = ["proposition", "lettre_de_mission", "livrable", "autre"] as const;
export type TypeDocument = (typeof TYPES_DOCUMENT)[number];

export const documentCreationSchema = z
  .object({
    type: z.enum(TYPES_DOCUMENT),
    nom: texte(200),
    chemin_stockage: texteOptionnel(500),
  })
  .strict();

export type MissionCreation = z.infer<typeof missionCreationSchema>;
export type LigneBudgetSaisie = z.infer<typeof ligneBudgetSaisieSchema>;
