"use client";

import { useState } from "react";
import { api, ErreurApi, MESSAGE_INATTENDU } from "../../lib/api";
import { Bouton } from "../ui/Bouton";

export function BoutonDeconnexion({ pleineLargeur = false }: { pleineLargeur?: boolean }) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function deconnecter() {
    setEnCours(true);
    setErreur(null);
    try {
      await api.post("/api/auth/deconnexion", undefined, { redirigerSi401: false });
      // Rechargement complet : vide l'état client et le cache du routeur.
      window.location.assign("/connexion");
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : MESSAGE_INATTENDU);
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
        pleineLargeur={pleineLargeur}
        onClick={deconnecter}
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
