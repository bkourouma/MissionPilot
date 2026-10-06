"use client";

import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

export interface MessageErreurProps {
  erreur: Error & { digest?: string };
  reessayer: () => void;
}

/** Contenu commun des error boundaries : message en français, sans détail technique. */
export function MessageErreur({ erreur, reessayer }: MessageErreurProps) {
  // En production, Next masque le message des erreurs serveur : on n'affiche que la référence.
  return (
    <div className="mp-page mp-page--message">
      <h1 className="mp-page__titre">Cette page n&apos;a pas pu s&apos;afficher</h1>
      <Alerte tonalite="danger" titre="Une erreur est survenue" annonce="aucune">
        <p>
          Vérifiez votre connexion, puis réessayez. Si le problème persiste, transmettez la
          référence ci-dessous au support de votre cabinet.
        </p>
        {erreur.digest ? (
          <p className="mp-texte-doux">
            Référence : <code>{erreur.digest}</code>
          </p>
        ) : null}
      </Alerte>
      <Bouton onClick={reessayer}>Réessayer</Bouton>
    </div>
  );
}
