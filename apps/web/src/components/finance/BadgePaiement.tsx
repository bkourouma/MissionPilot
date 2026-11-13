import type { StatutPaiement } from "@missionpilot/shared";
import { STATUT_PAIEMENT, STATUT_PAIEMENT_LIBELLES_EN } from "../../lib/encaissements";
import { T } from "../i18n/T";
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
  const libelle = <T fr={s.libelle} en={STATUT_PAIEMENT_LIBELLES_EN[statut]} />;
  const texte =
    statut === "en_retard" && joursRetard && joursRetard > 0 ? (
      <>
        <T fr="En retard de" en="Overdue by" /> {String(joursRetard)}
        {"\u00a0"}
        <T fr="j" en="d" />
      </>
    ) : (
      libelle
    );
  return <BadgeStatut tonalite={s.tonalite}>{texte}</BadgeStatut>;
}
