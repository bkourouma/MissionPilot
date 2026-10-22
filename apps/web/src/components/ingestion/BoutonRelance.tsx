"use client";

import "./ingestion.css";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bouton } from "../ui/Bouton";
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
  const router = useRouter();
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [echec, setEchec] = useState<string | null>(null);

  async function relancer() {
    setOccupe(true);
    setEchec(null);
    setMessage("");
    try {
      await relancerDocumentIngestion(api, docId);
      setMessage("Lecture relancée : le statut se met à jour tout seul.");
      router.refresh();
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
          texteChargement="Relance en cours…"
          onClick={() => void relancer()}
        >
          {libelle}
        </Bouton>
      </div>
      <p role="status" aria-live="polite" className="mp-ing-meta">
        {message}
      </p>
      {echec ? <p role="alert">{echec}</p> : null}
    </div>
  );
}
