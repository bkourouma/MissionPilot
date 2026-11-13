"use client";

import { useState } from "react";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { Bouton } from "../../../components/ui/Bouton";
import { deconnecterSuperAdmin } from "../../../lib/plateforme-client";
import { messageErreurPlateforme } from "../../../lib/plateforme";
import { destinationApresDeconnexion } from "./console-logique";

/** Déconnexion du super administrateur, puis rechargement complet (change d'espace). */
export function BoutonDeconnexionPlateforme({ estDemo }: { estDemo: boolean }) {
  const t = useT();
  const langue = useLangue();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function deconnecter() {
    setEnCours(true);
    setErreur(null);
    try {
      await deconnecterSuperAdmin();
      window.location.assign(destinationApresDeconnexion(estDemo));
    } catch (e) {
      setErreur(messageErreurPlateforme(e, langue));
      setEnCours(false);
    }
  }

  return (
    <div className="mp-deconnexion">
      <Bouton
        variante="secondaire"
        icone="deconnexion"
        chargement={enCours}
        texteChargement={t("Déconnexion…", "Signing out…")}
        onClick={() => void deconnecter()}
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
