"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { messagePortailDd, partageChange } from "../../lib/due-diligence-portail";

/**
 * Action du partage avec l'investisseur : exécute l'appel, annonce le succès ou l'erreur traduite
 * en français, puis rafraîchit les données serveur (aussi après un refus qui rend l'écran périmé).
 */
export function usePartageInvestisseur() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function executer(appel: () => Promise<unknown>, messageSucces: string): Promise<boolean> {
    setErreur(null);
    setSucces(null);
    setEnCours(true);
    try {
      await appel();
      setSucces(messageSucces);
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messagePortailDd(e));
      if (partageChange(e)) router.refresh();
      return false;
    } finally {
      setEnCours(false);
    }
  }

  return { erreur, succes, enCours, executer };
}
