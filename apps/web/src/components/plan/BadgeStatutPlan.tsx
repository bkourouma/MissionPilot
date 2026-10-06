import { BadgeContenuIa } from "../ia/BadgeContenuIa";
import { Icone } from "../ui/Icone";
import { STATUT_CONTENU_PLAN } from "../../lib/plan-strategique";
import type { StatutContenuPlan } from "@missionpilot/shared";

/**
 * Statut d'un contenu du plan. « Brouillon IA », « Modifié » et « Validé » réutilisent le badge
 * des contenus IA ; « Brouillon » (rédigé par l'équipe, jamais validé) est propre au plan.
 * Texte toujours visible et icône propre : la couleur ne porte jamais seule le sens.
 */
export function BadgeStatutPlan({ statut }: { statut: StatutContenuPlan | string }) {
  if (statut === "brouillon_ia" || statut === "modifie" || statut === "valide") {
    return <BadgeContenuIa statut={statut} />;
  }
  const s = STATUT_CONTENU_PLAN[statut as StatutContenuPlan];
  return (
    <span className={`mp-badge mp-badge--${s?.tonalite ?? "neutre"}`} title={s?.aide}>
      <Icone nom={s?.icone ?? "neutre"} taille={14} />
      <span>{s?.libelle ?? "Statut inconnu"}</span>
    </span>
  );
}

/** Contenu retiré du plan : il reste dans l'historique et doit être validé comme les autres. */
export function BadgeRetire() {
  return (
    <span
      className="mp-badge mp-badge--neutre"
      title="Retiré du plan : conservé dans l'historique."
    >
      <Icone nom="fermer" taille={14} />
      <span>Retiré</span>
    </span>
  );
}

/** Partage du plan au client (portail). */
export function BadgePartage({ partage }: { partage: boolean }) {
  return partage ? (
    <span className="mp-badge mp-badge--succes">
      <Icone nom="oeil" taille={14} />
      <span>Partagé au client</span>
    </span>
  ) : (
    <span className="mp-badge mp-badge--neutre">
      <Icone nom="cadenas" taille={14} />
      <span>Non partagé</span>
    </span>
  );
}
