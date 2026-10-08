import { classesBouton, type VarianteBouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";
import { hrefFacturePdf } from "./livrables";

export interface LienFacturePdfProps {
  factureId: string;
  /** Contexte ajouté au nom accessible, ex. « facture FA-2026-00001 ». */
  contexte?: string;
  variante?: VarianteBouton;
}

/**
 * Téléchargement du PDF d'une facture ou d'un avoir (GET /api/factures/:id/pdf : même document
 * que l'aperçu imprimable, rendu côté serveur, « facture.lire »). Lien authentifié de même
 * origine (cookie httpOnly) : le navigateur enregistre la pièce jointe, rien n'est conservé
 * par la page. Le rendu peut prendre quelques secondes.
 */
export function LienFacturePdf({
  factureId,
  contexte,
  variante = "secondaire",
}: LienFacturePdfProps) {
  return (
    <a
      className={classesBouton(variante)}
      href={hrefFacturePdf(factureId)}
      download
      aria-label={contexte ? `Télécharger le PDF (${contexte})` : "Télécharger le PDF"}
    >
      <Icone nom="telechargement" taille={18} />
      <span>Télécharger le PDF</span>
    </a>
  );
}
