"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageErreurLangue } from "../../lib/double-authentification";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
      setErreur(messageErreurLangue(e, langue));
      setEnCours(false);
    }
  }

  if (iconeSeule) {
    return (
      <div className="mp-deconnexion">
        <button
          type="button"
          className="mp-rail__icone"
          aria-label={
            enCours ? t("Déconnexion en cours", "Signing out") : t("Se déconnecter", "Sign out")
          }
          title={t("Se déconnecter", "Sign out")}
          aria-busy={enCours || undefined}
          disabled={enCours}
          onClick={deconnecter}
        >
          <Icone nom="deconnexion" />
        </button>
        {erreur ? (
          <p className="mp-deconnexion__erreur" role="alert">
            {t("Déconnexion impossible : ", "Unable to sign out: ")}
            {erreur}
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
        texteChargement={t("Déconnexion…", "Signing out…")}
        pleineLargeur={pleineLargeur}
        onClick={deconnecter}
      >
        {t("Se déconnecter", "Sign out")}
      </Bouton>
      {erreur ? (
        <p className="mp-deconnexion__erreur" role="alert">
          {t("Déconnexion impossible : ", "Unable to sign out: ")}
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
