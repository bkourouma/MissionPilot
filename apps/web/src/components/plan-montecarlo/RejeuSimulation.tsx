"use client";

import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminRejeu,
  messageMonteCarlo,
  messageRejeu,
  type ReponseRejeu,
} from "../../lib/plan-montecarlo";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { useLangue, useT } from "../i18n/FournisseurLangue";

export interface RejeuSimulationProps {
  planId: string;
  simulationId: string;
}

/**
 * Rejeu à l'identique (PLA-16) : relance le moteur avec la graine, les lois et la version du
 * modèle ENREGISTRÉES et compare au résultat figé. Rien n'est écrit : le rejeu ne crée pas de
 * nouvelle simulation.
 */
export function RejeuSimulation({ planId, simulationId }: RejeuSimulationProps) {
  const t = useT();
  const langue = useLangue();
  const [reponse, setReponse] = useState<ReponseRejeu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refErreur = useRef<HTMLDivElement>(null);

  async function rejouer() {
    setErreur(null);
    setReponse(null);
    setEnCours(true);
    try {
      setReponse(await api.post<ReponseRejeu>(cheminRejeu(planId, simulationId)));
    } catch (e) {
      setErreur(messageMonteCarlo(e, langue));
      refErreur.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-mc__reperes">
      <div>
        <Bouton
          variante="secondaire"
          icone="historique"
          chargement={enCours}
          texteChargement={t("Rejeu en cours…", "Replay in progress…")}
          onClick={rejouer}
        >
          {t("Rejouer à l'identique", "Replay identically")}
        </Bouton>
      </div>
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre={t("Rejeu impossible", "Replay failed")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {reponse ? (
        <Alerte
          tonalite={reponse.identique ? "succes" : "attention"}
          titre={
            reponse.identique
              ? t("Identique", "Identical")
              : t("Écart constaté", "Difference found")
          }
          annonce="status"
        >
          <p>{messageRejeu(reponse, langue)}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
