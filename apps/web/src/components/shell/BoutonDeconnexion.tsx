"use client";

import { useState } from "react";
import { api, ErreurApi, MESSAGE_INATTENDU } from "../../lib/api";
import { effacerConversation, stockageSession } from "../../lib/copilote-session";
import { purgerDonneesHorsLigne } from "../../lib/hors-ligne/magasins";
import { Bouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";

export function BoutonDeconnexion({
  pleineLargeur = false,
  iconeSeule = false,
}: {
  pleineLargeur?: boolean;
  /** Pied du rail : un bouton carré avec icône, le nom accessible reste « Se déconnecter ». */
  iconeSeule?: boolean;
}) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function deconnecter() {
    setEnCours(true);
    setErreur(null);
    try {
      await api.post("/api/auth/deconnexion", undefined, { redirigerSi401: false });
      // Saisies de temps gardées hors ligne : effacées de l'appareil. Un échec ne bloque pas
      // la déconnexion (le service worker purge aussi la base).
      try {
        await purgerDonneesHorsLigne();
      } catch {
        // Stockage indisponible : rien de plus à faire.
      }
      // Conversation du copilote gardée dans l'onglet : effacée à la déconnexion (sans effet si le
      // stockage est indisponible).
      effacerConversation(stockageSession());
      // Rechargement complet : vide l'état client et le cache du routeur.
      window.location.assign("/connexion");
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : MESSAGE_INATTENDU);
      setEnCours(false);
    }
  }

  if (iconeSeule) {
    return (
      <div className="mp-deconnexion">
        <button
          type="button"
          className="mp-rail__icone"
          aria-label={enCours ? "Déconnexion en cours" : "Se déconnecter"}
          title="Se déconnecter"
          aria-busy={enCours || undefined}
          disabled={enCours}
          onClick={deconnecter}
        >
          <Icone nom="deconnexion" />
        </button>
        {erreur ? (
          <p className="mp-deconnexion__erreur" role="alert">
            Déconnexion impossible : {erreur}
          </p>
        ) : null}
      </div>
    );
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
