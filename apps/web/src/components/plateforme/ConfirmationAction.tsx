"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import "./plateforme-commun.css";

export interface ConfirmationActionProps {
  titre: string;
  /** Explication des conséquences. */
  children: ReactNode;
  libelleConfirmer: string;
  /** Rouge pour une désactivation, bleu sinon. */
  danger?: boolean;
  enCours?: boolean;
  /** Erreur de la dernière tentative (message français). */
  erreur?: string | null;
  surConfirmer: () => void;
  surAnnuler: () => void;
}

/**
 * Confirmation en ligne (sans fenêtre modale) d'une action sensible. Le focus va sur
 * « Annuler » à l'ouverture (choix le plus prudent) ; Échap annule.
 */
export function ConfirmationAction({
  titre,
  children,
  libelleConfirmer,
  danger = false,
  enCours = false,
  erreur,
  surConfirmer,
  surAnnuler,
}: ConfirmationActionProps) {
  const idTitre = useId();
  const annuler = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    annuler.current?.focus();
  }, []);

  return (
    <div
      className="mp-confirmation-plateforme"
      role="group"
      aria-labelledby={idTitre}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !enCours) surAnnuler();
      }}
    >
      <p id={idTitre} className="mp-confirmation-plateforme__titre">
        {titre}
      </p>
      <div className="mp-confirmation-plateforme__texte">{children}</div>
      {erreur ? (
        <Alerte tonalite="danger" titre="Action impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="mp-confirmation-plateforme__actions">
        <Bouton
          variante={danger ? "danger" : "primaire"}
          chargement={enCours}
          texteChargement="Enregistrement…"
          onClick={surConfirmer}
        >
          {libelleConfirmer}
        </Bouton>
        <Bouton ref={annuler} variante="secondaire" disabled={enCours} onClick={surAnnuler}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
}
