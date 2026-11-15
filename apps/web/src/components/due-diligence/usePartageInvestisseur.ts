"use client";

import { useState } from "react";
import { messagePortailDd, partageChange } from "../../lib/due-diligence-portail";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue } from "../i18n/FournisseurLangue";

/**
 * Action du partage avec l'investisseur : exécute l'appel, annonce le succès ou l'erreur traduite
 * dans la langue de l'interface, puis rafraîchit les données serveur (aussi après un refus qui rend
 * l'écran périmé).
 */
export function usePartageInvestisseur() {
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;

  async function executer(appel: () => Promise<unknown>, messageSucces: string): Promise<boolean> {
    setErreur(null);
    setSucces(null);
    setEnCours(true);
    try {
      await appel();
      setSucces(messageSucces);
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messagePortailDd(e, langue));
      if (partageChange(e)) rafraichir();
      return false;
    } finally {
      setEnCours(false);
    }
  }

  return { erreur, succes, enCours, executer };
}
