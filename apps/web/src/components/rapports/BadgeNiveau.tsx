import { estNiveauRapport, NIVEAUX } from "../../lib/rapports";
import { Icone } from "../ui/Icone";

/**
 * Niveau de confidentialité d'un rapport : libellé toujours écrit et icône propre au niveau
 * (la couleur ne porte jamais seule le sens). Niveau inconnu : badge neutre explicite.
 */
export function BadgeNiveau({ niveau }: { niveau: string }) {
  if (!estNiveauRapport(niveau)) {
    return (
      <span className="mp-badge mp-badge--neutre">
        <Icone nom="neutre" taille={14} />
        <span>Niveau non reconnu</span>
      </span>
    );
  }
  const n = NIVEAUX[niveau];
  return (
    <span className={`mp-badge mp-badge--${n.tonalite}`}>
      <Icone nom={n.icone} taille={14} />
      <span>{n.libelle}</span>
    </span>
  );
}
