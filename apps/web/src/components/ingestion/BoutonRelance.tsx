"use client";

import "./ingestion.css";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState } from "react";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { useT } from "../i18n/FournisseurLangue";
import { messageErreur, relancerDocumentIngestion, type ApiIngestion } from "../../lib/ingestion";

export interface BoutonRelanceProps {
  api: ApiIngestion;
  docId: string;
  libelle: string;
}

/**
 * Relance la lecture d'un document dont l'IA était indisponible (ou qui n'a rien donné). La page se
 * recharge ensuite et suit l'avancement toute seule ; l'erreur éventuelle est annoncée.
 */
export function BoutonRelance({ api, docId, libelle }: BoutonRelanceProps) {
  const t = useT();
  const { rafraichir } = useRafraichir();
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [echec, setEchec] = useState<string | null>(null);

  async function relancer() {
    setOccupe(true);
    setEchec(null);
    setMessage("");
    try {
      await relancerDocumentIngestion(api, docId);
      setMessage(
        t(
          "Lecture relancée : le statut se met à jour tout seul.",
          "Reading restarted: the status updates on its own.",
        ),
      );
      rafraichir();
    } catch (e) {
      setEchec(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div className="mp-ing-pile">
      <div>
        <Bouton
          variante="secondaire"
          icone="historique"
          chargement={occupe}
          texteChargement={t("Relance en cours…", "Restarting…")}
          onClick={() => void relancer()}
        >
          {libelle}
        </Bouton>
      </div>
      <p role="status" aria-live="polite" className="mp-ing-meta">
        {message}
      </p>
      {echec ? (
        <Alerte tonalite="danger" titre={t("Relance impossible", "Could not restart")}>
          <p>{echec}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
