"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  CONFIRMATION_ACTIVATION,
  CONFIRMATION_DESACTIVATION,
  cheminOptionPortailDd,
} from "../../lib/due-diligence-portail";
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
  const p = usePartageInvestisseur();
  const [confirmation, setConfirmation] = useState(false);
  const cible = !actif;

  async function appliquer() {
    const ok = await p.executer(
      () => api.post(cheminOptionPortailDd, { actif: cible }),
      cible ? "Le portail investisseur est activé." : "Le portail investisseur est désactivé.",
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
            cible ? "Activer le portail investisseur ?" : "Désactiver le portail investisseur ?"
          }
        >
          <p>{cible ? CONFIRMATION_ACTIVATION : CONFIRMATION_DESACTIVATION}</p>
          <div className="mp-actions-formulaire">
            <Bouton
              variante={cible ? "primaire" : "danger"}
              chargement={p.enCours}
              texteChargement="Enregistrement…"
              onClick={() => void appliquer()}
            >
              {cible ? "Oui, activer" : "Oui, désactiver"}
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={p.enCours}
              onClick={() => setConfirmation(false)}
            >
              Annuler
            </Bouton>
          </div>
        </Alerte>
      ) : (
        <div className="mp-actions-formulaire">
          <Bouton
            variante={cible ? "primaire" : "secondaire"}
            onClick={() => setConfirmation(true)}
          >
            {cible ? "Activer le portail investisseur" : "Désactiver le portail investisseur"}
          </Bouton>
        </div>
      )}
    </div>
  );
}
