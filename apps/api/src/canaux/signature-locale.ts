import { createHash } from "node:crypto";
import {
  ErreurSignature,
  type DemandeSignatureExterne,
  type FournisseurSignature,
  type RefDemandeSignature,
} from "./ports.js";

/*
 * FournisseurSignatureLocal (SPEC-3c §4.3) : fournisseur de signature SIMULÉ. Niveau « simple
 * simulée » (SANS valeur juridique), parcours « interne » : le signataire signe DANS MissionPilot,
 * après reconfirmation de son identité (canaux/signatures.ts). Aucun appel externe. Le journal de
 * preuves n'est PAS ici : c'est la table `signatures_preuves`, tenue pour tous les fournisseurs.
 */
export class FournisseurSignatureLocal implements FournisseurSignature {
  readonly fournisseur = "local";
  readonly mode = "simule" as const;
  readonly niveau = "simple_simulee" as const;
  private readonly horloge: () => Date;

  constructor(options: { horloge?: () => Date } = {}) {
    this.horloge = options.horloge ?? (() => new Date());
  }

  async creerDemande(demande: DemandeSignatureExterne): Promise<RefDemandeSignature> {
    if (!/^[0-9a-f]{64}$/.test(demande.empreintesDocument)) {
      throw new ErreurSignature("EMPREINTE_INVALIDE");
    }
    if (
      Number.isNaN(demande.expireLe.getTime()) ||
      demande.expireLe.getTime() <= this.horloge().getTime()
    ) {
      throw new ErreurSignature("ECHEANCE_INVALIDE");
    }
    return {
      referenceExterne: `loc-${createHash("sha256").update(demande.idempotence, "utf8").digest("hex").slice(0, 16)}`,
      parcours: "interne",
      signataires: demande.signataires.map((s) => ({ id: s.id, url: null })),
    };
  }

  /** Sans effet distant : rien n'a été créé hors de MissionPilot. */
  async annuler(_referenceExterne: string, _motif: string): Promise<void> {
    return undefined;
  }

  /** La preuve est notre journal chaîné (`signatures_preuves`) : aucun dossier du fournisseur. */
  async recupererPreuves(_referenceExterne: string): Promise<Buffer | null> {
    return null;
  }
}
