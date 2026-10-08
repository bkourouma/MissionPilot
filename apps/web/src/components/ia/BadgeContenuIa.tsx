import type { StatutContenu, StatutGeneration } from "@missionpilot/shared";
import { MESSAGE_ESSAI, STATUT_CONTENU_IA, STATUT_GENERATION_IA } from "../../lib/ia-contenu";
import { Icone } from "../ui/Icone";
import "./ia.css";

/**
 * Statut d'un contenu IA : « Brouillon IA », « Modifié » ou « Validé ». Texte toujours visible et
 * icône propre à chaque statut : la couleur ne porte jamais seule le sens.
 */
export function BadgeContenuIa({ statut }: { statut: StatutContenu | null | undefined }) {
  if (!statut) return null;
  const s = STATUT_CONTENU_IA[statut];
  return (
    <span className={`mp-badge mp-badge--${s.tonalite}`} title={s.aide}>
      <Icone nom={s.icone} taille={14} />
      <span>{s.libelle}</span>
    </span>
  );
}

/** Contenu produit sans appel à un modèle, par un gabarit déterministe. */
export function BadgeGabaritIa() {
  return (
    <span className="mp-badge mp-badge--neutre">
      <Icone nom="livre" taille={14} />
      <span>Gabarit, sans IA</span>
    </span>
  );
}

/** Essai fait avec un prompt « exemple » : jamais livrable au client, même validé. */
export function BadgeEssaiIa() {
  return (
    <span className="mp-badge mp-badge--neutre" title={MESSAGE_ESSAI}>
      <Icone nom="drapeau" taille={14} />
      <span>Essai, hors client</span>
    </span>
  );
}

/** État d'exécution d'une génération (file, en cours, terminée, échec, annulée). */
export function BadgeStatutGenerationIa({ statut }: { statut: StatutGeneration }) {
  const s = STATUT_GENERATION_IA[statut];
  return (
    <span className={`mp-badge mp-badge--${s.tonalite}`}>
      <Icone nom={s.icone} taille={14} />
      <span>{s.libelle}</span>
    </span>
  );
}
