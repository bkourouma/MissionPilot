"use client";

import { useEffect, useRef, useState } from "react";
import { Alerte } from "../ui/Alerte";
import { Bouton, classesBouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";
import { useT } from "../i18n/FournisseurLangue";
import { copierTexte } from "./presse-papiers";

export interface MessageErreurProps {
  erreur: Error & { digest?: string };
  reessayer: () => void;
}

/**
 * Contenu commun des error boundaries : message clair sans détail technique, actions utiles
 * (réessayer, recharger, revenir au tableau de bord) et référence copiable pour le support.
 * Fonctionne hors du cadre applicatif et hors du routeur : le retour à l'accueil est un lien
 * ordinaire (rechargement complet), jamais `next/link`.
 */
export function MessageErreur({ erreur, reessayer }: MessageErreurProps) {
  const t = useT();
  const titre = useRef<HTMLHeadingElement>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [copie, setCopie] = useState<"non" | "oui" | "echec">("non");

  // Le focus va au titre : un lecteur d'écran l'annonce, un clavier repart de l'erreur.
  useEffect(() => {
    titre.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const maj = () => setHorsLigne(!navigator.onLine);
    maj();
    window.addEventListener("online", maj);
    window.addEventListener("offline", maj);
    return () => {
      window.removeEventListener("online", maj);
      window.removeEventListener("offline", maj);
    };
  }, []);

  async function copier() {
    if (!erreur.digest) return;
    setCopie((await copierTexte(erreur.digest)) ? "oui" : "echec");
  }

  // En production, Next masque le message des erreurs serveur : on n'affiche que la référence.
  return (
    <div className="mp-page mp-page--message mp-erreur">
      <Icone nom="attention" taille={40} className="mp-page__icone" />
      <h1 className="mp-page__titre" ref={titre} tabIndex={-1}>
        {t("Cette page n'a pas pu s'afficher", "This page could not be displayed")}
      </h1>
      <Alerte
        tonalite="danger"
        titre={t("Une erreur est survenue", "An error occurred")}
        annonce="aucune"
      >
        <p>
          {horsLigne
            ? t(
                "Vous semblez hors connexion. Rétablissez le réseau, puis réessayez.",
                "You appear to be offline. Restore your connection, then try again.",
              )
            : t(
                "Vérifiez votre connexion, puis réessayez. Si le problème persiste, transmettez la référence ci-dessous au support de votre cabinet.",
                "Check your connection, then try again. If the problem persists, send the reference below to your firm's support.",
              )}
        </p>
        {erreur.digest ? (
          <p className="mp-erreur__reference">
            <span className="mp-texte-doux">{t("Référence :", "Reference:")}</span>{" "}
            <code>{erreur.digest}</code>
            <button type="button" className="mp-erreur__copier" onClick={copier}>
              <Icone nom="copie" taille={16} />
              {t("Copier la référence", "Copy reference")}
            </button>
            <span className="mp-erreur__copie" role="status">
              {copie === "oui" ? t("Référence copiée.", "Reference copied.") : null}
              {copie === "echec"
                ? t(
                    "Copie impossible : sélectionnez la référence.",
                    "Copy failed: select the text.",
                  )
                : null}
            </span>
          </p>
        ) : null}
      </Alerte>
      <div className="mp-erreur__actions">
        <Bouton onClick={reessayer}>{t("Réessayer", "Try again")}</Bouton>
        <Bouton variante="secondaire" onClick={() => window.location.reload()}>
          {t("Recharger la page", "Reload page")}
        </Bouton>
        <a href="/" className={classesBouton("discret")}>
          {t("Retour au tableau de bord", "Back to the dashboard")}
        </a>
      </div>
    </div>
  );
}
