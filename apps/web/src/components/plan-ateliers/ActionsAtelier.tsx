"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminCloreAtelier,
  cheminOuvrirAtelier,
  messageAtelier,
  type StatutAtelier,
} from "../../lib/plan-ateliers";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

export interface ActionsAtelierProps {
  planId: string;
  atelierId: string;
  statut: StatutAtelier;
  /** Raison pour laquelle l'ouverture est impossible (null : possible). */
  raisonOuverture: string | null;
}

/** Ouvrir (brouillon) ou clore (ouvert) l'atelier ; la clôture fige les résultats du moteur. */
export function ActionsAtelier({
  planId,
  atelierId,
  statut,
  raisonOuverture,
}: ActionsAtelierProps) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refAlerte = useRef<HTMLDivElement>(null);

  async function executer(chemin: string): Promise<boolean> {
    setErreur(null);
    try {
      await api.post(chemin);
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageAtelier(e));
      refAlerte.current?.focus();
      return false;
    }
  }

  if (statut === "clos") return null;
  return (
    <div className="mp-pile">
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre="Action refusée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {statut === "brouillon" ? (
        <div className="mp-barre-actions">
          <Bouton
            icone="succes"
            disabled={raisonOuverture !== null}
            chargement={enCours}
            texteChargement="Ouverture…"
            onClick={async () => {
              setEnCours(true);
              await executer(cheminOuvrirAtelier(planId, atelierId));
              setEnCours(false);
            }}
          >
            Ouvrir l&apos;atelier aux participants
          </Bouton>
          {raisonOuverture ? (
            <p className="mp-texte-doux mp-texte-petit">{raisonOuverture}</p>
          ) : null}
        </div>
      ) : (
        <BoutonConfirmation
          libelle="Clore l'atelier"
          question="Clore l'atelier ? Les contributions sont figées et les résultats calculés. Cette action est définitive."
          libelleConfirmation="Oui, clore l'atelier"
          texteChargement="Clôture…"
          variante="primaire"
          action={() => executer(cheminCloreAtelier(planId, atelierId))}
        />
      )}
    </div>
  );
}
