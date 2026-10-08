"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminRecalage,
  messageFeuilleDeRoute,
  messageRecalage,
  type ResultatRecalage,
} from "../../lib/plan-feuille-de-route";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { Alerte } from "../ui/Alerte";

export interface RecalageFeuilleDeRouteProps {
  planId: string;
  /** Initiatives que le moteur propose de recaler (celles affichées à l'utilisateur). */
  initiatives: readonly string[];
  partage: boolean;
}

/**
 * Application du recalage proposé par le moteur : chaque initiative recalée reçoit une nouvelle
 * version datée (validation à refaire ; partage au client retiré). L'API refuse (409) si la
 * feuille de route a changé depuis son affichage.
 */
export function RecalageFeuilleDeRoute({
  planId,
  initiatives,
  partage,
}: RecalageFeuilleDeRouteProps) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [attente, attendre] = useAttenteRafraichissement(initiatives.join(","));
  const refErreur = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);

  async function appliquer(): Promise<boolean> {
    if (attente) return false;
    setErreur(null);
    setSucces(null);
    try {
      const r = await api.post<ResultatRecalage>(cheminRecalage(planId), {
        initiatives: [...initiatives],
      });
      setSucces(messageRecalage(r, partage));
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageFeuilleDeRoute(e));
      router.refresh();
      return false;
    }
  }

  return (
    <div className="mp-plan__section">
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Recalage refusé">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      {initiatives.length ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={`Appliquer le recalage (${initiatives.length})`}
            question={`Enregistrer les dates recalées de ${initiatives.length} initiative${initiatives.length > 1 ? "s" : ""} ? Chacune reçoit une nouvelle version, à faire valider.${partage ? " Le partage au client sera retiré." : ""}`}
            libelleConfirmation="Oui, appliquer"
            texteChargement="Recalage…"
            variante="primaire"
            icone="historique"
            action={appliquer}
          />
        </div>
      ) : null}
    </div>
  );
}
