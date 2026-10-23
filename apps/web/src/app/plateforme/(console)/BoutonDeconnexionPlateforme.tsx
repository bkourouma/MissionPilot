"use client";

import { useState } from "react";
import { Bouton } from "../../../components/ui/Bouton";
import { deconnecterSuperAdmin } from "../../../lib/plateforme-client";
import { messageErreurPlateforme } from "../../../lib/plateforme";
import { destinationApresDeconnexion } from "./console-logique";

/** Déconnexion du super administrateur, puis rechargement complet (change d'espace). */
export function BoutonDeconnexionPlateforme({ estDemo }: { estDemo: boolean }) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function deconnecter() {
    setEnCours(true);
    setErreur(null);
    try {
      await deconnecterSuperAdmin();
      window.location.assign(destinationApresDeconnexion(estDemo));
    } catch (e) {
      setErreur(messageErreurPlateforme(e));
      setEnCours(false);
    }
  }

  return (
    <div className="mp-deconnexion">
      <Bouton
        variante="secondaire"
        icone="deconnexion"
        chargement={enCours}
        texteChargement="Déconnexion…"
        onClick={() => void deconnecter()}
      >
        Se déconnecter
      </Bouton>
      {erreur ? (
        <p className="mp-deconnexion__erreur" role="alert">
          Déconnexion impossible : {erreur}
        </p>
      ) : null}
    </div>
  );
}
