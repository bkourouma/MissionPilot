import { estNiveauRapport, niveauRapport } from "../../lib/rapports";
import { T } from "../i18n/T";
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
        <span>
          <T fr="Niveau non reconnu" en="Unrecognized level" />
        </span>
      </span>
    );
  }
  const n = niveauRapport(niveau);
  return (
    <span className={`mp-badge mp-badge--${n.tonalite}`}>
      <Icone nom={n.icone} taille={14} />
      <span>
        <T fr={n.libelle} en={niveauRapport(niveau, "en").libelle} />
      </span>
    </span>
  );
}
