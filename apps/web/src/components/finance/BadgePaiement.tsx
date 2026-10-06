import type { StatutPaiement } from "@missionpilot/shared";
import { STATUT_PAIEMENT } from "../../lib/encaissements";
import { BadgeStatut } from "../ui/BadgeStatut";

/** Statut de paiement dérivé par l'API : couleur, icône et texte (« En retard de 12 j »). */
export function BadgePaiement({
  statut,
  joursRetard,
}: {
  statut: StatutPaiement;
  joursRetard?: number;
}) {
  const s = STATUT_PAIEMENT[statut];
  const texte =
    statut === "en_retard" && joursRetard && joursRetard > 0
      ? s.libelle + " de " + String(joursRetard) + " j"
      : s.libelle;
  return <BadgeStatut tonalite={s.tonalite}>{texte}</BadgeStatut>;
}
