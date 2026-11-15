"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  CONFIRMATION_ACTIVATION,
  CONFIRMATION_ACTIVATION_EN,
  CONFIRMATION_DESACTIVATION,
  CONFIRMATION_DESACTIVATION_EN,
  cheminOptionPortailDd,
} from "../../lib/due-diligence-portail";
import { useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { PartageInvestisseurRetour } from "./PartageInvestisseurRetour";
import { usePartageInvestisseur } from "./usePartageInvestisseur";

export interface PartageInvestisseurOptionProps {
  actif: boolean;
}

/**
 * Option du cabinet (associé seul) : activer ou désactiver le portail investisseur. Toute
 * modification est confirmée explicitement avant l'envoi.
 */
export function PartageInvestisseurOption({ actif }: PartageInvestisseurOptionProps) {
  const t = useT();
  const p = usePartageInvestisseur();
  const [confirmation, setConfirmation] = useState(false);
  const cible = !actif;

  async function appliquer() {
    const ok = await p.executer(
      () => api.post(cheminOptionPortailDd, { actif: cible }),
      cible
        ? t("Le portail investisseur est activé.", "The investor portal is enabled.")
        : t("Le portail investisseur est désactivé.", "The investor portal is disabled."),
    );
    if (ok) setConfirmation(false);
  }

  return (
    <div className="mp-dd-pile">
      <PartageInvestisseurRetour erreur={p.erreur} succes={p.succes} />
      {confirmation ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={
            cible
              ? t("Activer le portail investisseur ?", "Enable the investor portal?")
              : t("Désactiver le portail investisseur ?", "Disable the investor portal?")
          }
        >
          <p>
            {cible
              ? t(CONFIRMATION_ACTIVATION, CONFIRMATION_ACTIVATION_EN)
              : t(CONFIRMATION_DESACTIVATION, CONFIRMATION_DESACTIVATION_EN)}
          </p>
          <div className="mp-actions-formulaire">
            <Bouton
              variante={cible ? "primaire" : "danger"}
              chargement={p.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
              onClick={() => void appliquer()}
            >
              {cible ? t("Oui, activer", "Yes, enable") : t("Oui, désactiver", "Yes, disable")}
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={p.enCours}
              onClick={() => setConfirmation(false)}
            >
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </Alerte>
      ) : (
        <div className="mp-actions-formulaire">
          <Bouton
            variante={cible ? "primaire" : "secondaire"}
            onClick={() => setConfirmation(true)}
          >
            {cible
              ? t("Activer le portail investisseur", "Enable the investor portal")
              : t("Désactiver le portail investisseur", "Disable the investor portal")}
          </Bouton>
        </div>
      )}
    </div>
  );
}
