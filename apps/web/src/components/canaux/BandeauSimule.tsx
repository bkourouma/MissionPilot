import type { ReactNode } from "react";
import { Alerte } from "../ui/Alerte";
import { BANDEAU_SIMULE } from "../../lib/canaux";
import "./canaux.css";

export interface BandeauSimuleProps {
  /** Précision sous le titre (ex. ce qui est simulé sur cet écran). */
  children?: ReactNode;
}

/**
 * Bandeau permanent des écrans de canaux : « Simulé : aucun envoi réel ». Aucun message n'est
 * réellement envoyé, aucune clé ni compte externe n'est utilisé (règle ferme du lot).
 */
export function BandeauSimule({ children }: BandeauSimuleProps) {
  return (
    <Alerte tonalite="info" annonce="aucune" titre={BANDEAU_SIMULE}>
      {children ?? (
        <p>
          Les canaux sont des simulateurs : ni WhatsApp, ni SMS, ni opérateur réel n&apos;est
          contacté, et seuls des numéros de test sont acceptés.
        </p>
      )}
    </Alerte>
  );
}
