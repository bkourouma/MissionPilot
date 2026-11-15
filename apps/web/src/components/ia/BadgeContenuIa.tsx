"use client";

import type { StatutContenu, StatutGeneration } from "@missionpilot/shared";
import {
  MESSAGE_ESSAI,
  MESSAGE_ESSAI_EN,
  presentationStatutContenu,
  presentationStatutGeneration,
} from "../../lib/ia-contenu";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Icone } from "../ui/Icone";
import "./ia.css";

/**
 * Statut d'un contenu IA : « Brouillon IA », « Modifié » ou « Validé ». Texte toujours visible et
 * icône propre à chaque statut : la couleur ne porte jamais seule le sens.
 */
export function BadgeContenuIa({ statut }: { statut: StatutContenu | null | undefined }) {
  const langue = useLangue();
  if (!statut) return null;
  const s = presentationStatutContenu(statut, langue);
  return (
    <span className={`mp-badge mp-badge--${s.tonalite} mp-badge--ia`} title={s.aide}>
      <Icone nom={s.icone} taille={14} />
      <span>{s.libelle}</span>
    </span>
  );
}

/** Contenu produit sans appel à un modèle, par un gabarit déterministe. */
export function BadgeGabaritIa() {
  const t = useT();
  return (
    <span className="mp-badge mp-badge--neutre">
      <Icone nom="livre" taille={14} />
      <span>{t("Gabarit, sans IA", "Template, no AI")}</span>
    </span>
  );
}

/** Essai fait avec un prompt « exemple » : jamais livrable au client, même validé. */
export function BadgeEssaiIa() {
  const t = useT();
  return (
    <span className="mp-badge mp-badge--neutre" title={t(MESSAGE_ESSAI, MESSAGE_ESSAI_EN)}>
      <Icone nom="drapeau" taille={14} />
      <span>{t("Essai, hors client", "Test, not for clients")}</span>
    </span>
  );
}

/** État d'exécution d'une génération (file, en cours, terminée, échec, annulée). */
export function BadgeStatutGenerationIa({ statut }: { statut: StatutGeneration }) {
  const s = presentationStatutGeneration(statut, useLangue());
  return (
    <span className={`mp-badge mp-badge--${s.tonalite}`}>
      <Icone nom={s.icone} taille={14} />
      <span>{s.libelle}</span>
    </span>
  );
}
