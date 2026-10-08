import { z } from "zod";
import { texte } from "./commun";

/*
 * Check-list de clôture (AUT-08, PRD complémentaire §8) : contrat des routes
 * /api/cloture/modele et /api/missions/:id/cloture/**. Le modèle est propre à chaque cabinet
 * (items activables, bloquants ou non) ; chaque item désigne un contrôle déterministe NOMMÉ,
 * jamais une règle libre. La décision de clôture est celle du moteur (`decisionCloture`).
 */

export const CONTROLES_CLOTURE = [
  "temps_valides",
  "debours_traites",
  "factures_emises",
  "livrables_signes",
  "encaissements_soldes",
  "satisfaction_demandee",
  "capitalisation_faite",
] as const;
export type ControleCloture = (typeof CONTROLES_CLOTURE)[number];
export const controleClotureSchema = z.enum(CONTROLES_CLOTURE);

export const CONTROLE_CLOTURE_LIBELLES: Record<ControleCloture, string> = {
  temps_valides: "Temps validés",
  debours_traites: "Débours traités",
  factures_emises: "Factures émises",
  livrables_signes: "Livrables signés",
  encaissements_soldes: "Encaissements soldés",
  satisfaction_demandee: "Satisfaction demandée",
  capitalisation_faite: "Capitalisation faite",
};

export const CONTROLE_CLOTURE_DESCRIPTIONS: Record<ControleCloture, string> = {
  temps_valides:
    "Aucune feuille de temps de la mission n'est restée en brouillon, soumise ou rejetée.",
  debours_traites:
    "Aucun débours de la mission n'attend une décision (brouillon ou soumis) ; validé ou rejeté suffit.",
  factures_emises:
    "Aucune facture de la mission n'est restée à émettre et aucune échéance n'est à facturer.",
  livrables_signes:
    "Tout livrable de classe R2 ou R3 suivi par la qualité est signé (suivi qualité).",
  encaissements_soldes: "Toutes les factures émises de la mission sont soldées.",
  satisfaction_demandee: "Une note de satisfaction de clôture a été saisie pour le client.",
  capitalisation_faite:
    "Les enseignements de la mission ont été capitalisés (attestation de l'équipe : la clôture ne lit pas encore le retour d'expérience du module de capitalisation).",
};

/** Contrôles qui se vérifient par attestation humaine (aucune donnée à calculer). */
export const CONTROLES_PAR_ATTESTATION: readonly ControleCloture[] = ["capitalisation_faite"];

/** Valeurs appliquées tant que le cabinet n'a pas paramétré son modèle. */
export const CONTROLE_CLOTURE_DEFAUTS: Record<
  ControleCloture,
  { actif: boolean; bloquant: boolean }
> = {
  temps_valides: { actif: true, bloquant: true },
  debours_traites: { actif: true, bloquant: true },
  factures_emises: { actif: true, bloquant: true },
  livrables_signes: { actif: true, bloquant: true },
  encaissements_soldes: { actif: true, bloquant: false },
  satisfaction_demandee: { actif: true, bloquant: false },
  capitalisation_faite: { actif: false, bloquant: false },
};

export const ETATS_ITEM_CLOTURE = [
  "inactif",
  "conforme",
  "avertissement",
  "deroge",
  "bloque",
] as const;
export type EtatItemCloture = (typeof ETATS_ITEM_CLOTURE)[number];

export const itemModeleClotureSchema = z
  .object({
    controle: controleClotureSchema,
    actif: z.boolean(),
    bloquant: z.boolean(),
  })
  .strict()
  // Un item inactif ne bloque jamais (CHECK `actif OR NOT bloquant` de 0320).
  .refine((i) => i.actif || !i.bloquant, {
    message: "Un item désactivé ne peut pas être bloquant.",
  });
export type ItemModeleCloture = z.infer<typeof itemModeleClotureSchema>;

export const modeleClotureSchema = z
  .object({
    items: z
      .array(itemModeleClotureSchema)
      .min(1)
      .max(CONTROLES_CLOTURE.length)
      .refine((l) => new Set(l.map((i) => i.controle)).size === l.length, {
        message: "Un contrôle ne figure qu'une fois dans le modèle.",
      }),
  })
  .strict();

const motif = texte(500).refine((v) => v.length >= 10, {
  message: "Le motif doit comporter au moins 10 caractères.",
});

export const derogationClotureSchema = z
  .object({ controle: controleClotureSchema, motif })
  .strict();
export const retraitDerogationClotureSchema = z.object({ motif }).strict();

export const attestationClotureSchema = z
  .object({
    controle: z.enum(["capitalisation_faite"]),
    attestee: z.boolean(),
    note: texte(500).optional(),
  })
  .strict();

export const historiqueClotureQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(200).default(50),
    /** Curseur opaque de la page suivante (`curseur_suivant`), pour chacune des deux listes. */
    curseur_verifications: z.string().min(1).max(500).optional(),
    curseur_derogations: z.string().min(1).max(500).optional(),
  })
  .strict();
