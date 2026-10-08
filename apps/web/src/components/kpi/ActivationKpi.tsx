"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { cheminKpi, messageKpi, type DetailKpi } from "../../lib/kpi";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";

export interface ActivationKpiProps {
  kpiId: string;
  libelle: string;
  actif: boolean;
}

/**
 * Désactivation (le KPI sort du tableau de bord, du score et des rappels ; plus aucune
 * mesure n'est acceptée) ou réactivation. Rien n'est supprimé : définition, cibles et
 * mesures restent dans l'historique.
 */
export function ActivationKpi({ kpiId, libelle, actif }: ActivationKpiProps) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [attente, attendre] = useAttenteRafraichissement(actif);
  const refAlerte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function basculer(): Promise<boolean> {
    setErreur(null);
    setSucces(null);
    try {
      await api.patch<DetailKpi>(cheminKpi(kpiId), { actif: !actif });
      setSucces(
        actif
          ? "KPI désactivé : il ne figure plus au tableau de bord et n'accepte plus de mesure."
          : "KPI réactivé : il figure de nouveau au tableau de bord.",
      );
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageKpi(e));
      return false;
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur={actif ? "Désactivation impossible" : "Réactivation impossible"}
      />
      <p className="mp-texte-doux">
        {actif
          ? "Désactiver retire ce KPI du tableau de bord, du score composite et des rappels, et bloque la saisie. Rien n'est supprimé."
          : "Ce KPI est désactivé : il n'est plus évalué et n'accepte aucune mesure. Son historique est conservé."}
      </p>
      {attente ? (
        <p className="mp-texte-doux" role="status">
          Mise à jour de la page…
        </p>
      ) : (
        <BoutonConfirmation
          key={actif ? "actif" : "inactif"}
          libelle={actif ? "Désactiver ce KPI" : "Réactiver ce KPI"}
          question={actif ? `Désactiver « ${libelle} » ?` : `Réactiver « ${libelle} » ?`}
          libelleConfirmation={actif ? "Oui, désactiver" : "Oui, réactiver"}
          variante={actif ? "danger" : "secondaire"}
          texteChargement="Enregistrement…"
          action={basculer}
        />
      )}
    </div>
  );
}
