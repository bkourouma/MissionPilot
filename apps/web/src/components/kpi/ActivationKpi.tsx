"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { cheminKpi, messageKpi, type DetailKpi } from "../../lib/kpi";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
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
          ? t(
              "KPI désactivé : il ne figure plus au tableau de bord et n'accepte plus de mesure.",
              "KPI disabled: it no longer appears on the dashboard and no longer accepts measurements.",
            )
          : t(
              "KPI réactivé : il figure de nouveau au tableau de bord.",
              "KPI reactivated: it appears on the dashboard again.",
            ),
      );
      attendre();
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messageKpi(e, langue));
      return false;
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur={
          actif
            ? t("Désactivation impossible", "Could not disable")
            : t("Réactivation impossible", "Could not reactivate")
        }
      />
      <p className="mp-texte-doux">
        {actif
          ? t(
              "Désactiver retire ce KPI du tableau de bord, du score composite et des rappels, et bloque la saisie. Rien n'est supprimé.",
              "Disabling removes this KPI from the dashboard, the composite score and the reminders, and blocks data entry. Nothing is deleted.",
            )
          : t(
              "Ce KPI est désactivé : il n'est plus évalué et n'accepte aucune mesure. Son historique est conservé.",
              "This KPI is disabled: it is no longer assessed and accepts no measurement. Its history is kept.",
            )}
      </p>
      {attente ? (
        <p className="mp-texte-doux" role="status">
          {t("Mise à jour de la page…", "Updating the page…")}
        </p>
      ) : (
        <BoutonConfirmation
          key={actif ? "actif" : "inactif"}
          libelle={
            actif
              ? t("Désactiver ce KPI", "Disable this KPI")
              : t("Réactiver ce KPI", "Reactivate this KPI")
          }
          question={
            actif
              ? t(`Désactiver « ${libelle} » ?`, `Disable "${libelle}"?`)
              : t(`Réactiver « ${libelle} » ?`, `Reactivate "${libelle}"?`)
          }
          libelleConfirmation={
            actif ? t("Oui, désactiver", "Yes, disable") : t("Oui, réactiver", "Yes, reactivate")
          }
          variante={actif ? "danger" : "secondaire"}
          texteChargement={t("Enregistrement…", "Saving…")}
          action={basculer}
        />
      )}
    </div>
  );
}
