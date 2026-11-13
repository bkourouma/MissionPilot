"use client";

import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { useT } from "../i18n/FournisseurLangue";

export interface MessageErreurProps {
  erreur: Error & { digest?: string };
  reessayer: () => void;
}

/** Contenu commun des error boundaries : message en français, sans détail technique. */
export function MessageErreur({ erreur, reessayer }: MessageErreurProps) {
  const t = useT();
  // En production, Next masque le message des erreurs serveur : on n'affiche que la référence.
  return (
    <div className="mp-page mp-page--message">
      <h1 className="mp-page__titre">
        {t("Cette page n'a pas pu s'afficher", "This page could not be displayed")}
      </h1>
      <Alerte
        tonalite="danger"
        titre={t("Une erreur est survenue", "An error occurred")}
        annonce="aucune"
      >
        <p>
          {t(
            "Vérifiez votre connexion, puis réessayez. Si le problème persiste, transmettez la référence ci-dessous au support de votre cabinet.",
            "Check your connection, then try again. If the problem persists, send the reference below to your firm's support.",
          )}
        </p>
        {erreur.digest ? (
          <p className="mp-texte-doux">
            {t("Référence :", "Reference:")} <code>{erreur.digest}</code>
          </p>
        ) : null}
      </Alerte>
      <Bouton onClick={reessayer}>{t("Réessayer", "Try again")}</Bouton>
    </div>
  );
}
