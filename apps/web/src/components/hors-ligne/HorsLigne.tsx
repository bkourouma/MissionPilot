"use client";

import { useEffect, useState } from "react";
import { messageReseau } from "../../lib/hors-ligne/etats";
import { purgerDonneesHorsLigne } from "../../lib/hors-ligne/magasins";
import "./hors-ligne.css";

const DUREE_RETOUR_MS = 6_000;

/**
 * Monté une fois dans le layout racine :
 * - enregistre le service worker (`public/sw.js`, portée `/`), sans bloquer l'affichage ;
 * - vide la file hors ligne quand le service worker signale une déconnexion ;
 * - affiche l'état du réseau dans une zone `role="status"` toujours présente (annonce polie
 *   aux lecteurs d'écran), visible seulement hors connexion et au retour du réseau.
 */
export function HorsLigne() {
  const [enLigne, setEnLigne] = useState(true);
  const [retour, setRetour] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const conteneur = navigator.serviceWorker;
      const message = (e: MessageEvent) => {
        if ((e.data as { type?: unknown } | null)?.type === "mp-purger-hors-ligne") {
          void purgerDonneesHorsLigne();
        }
      };
      conteneur.addEventListener("message", message);
      const enregistrer = () =>
        conteneur.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
          // Navigateur sans service worker ou script inaccessible : l'application reste
          // utilisable en ligne, la file de saisie fonctionne sans lui.
        });
      if (document.readyState === "complete") void enregistrer();
      else window.addEventListener("load", enregistrer, { once: true });
      return () => conteneur.removeEventListener("message", message);
    }
  }, []);

  useEffect(() => {
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    setEnLigne(navigator.onLine);
    const horsLigne = () => {
      clearTimeout(minuterie);
      setRetour(false);
      setEnLigne(false);
    };
    const enLigneDeNouveau = () => {
      setEnLigne(true);
      setRetour(true);
      clearTimeout(minuterie);
      minuterie = setTimeout(() => setRetour(false), DUREE_RETOUR_MS);
    };
    window.addEventListener("offline", horsLigne);
    window.addEventListener("online", enLigneDeNouveau);
    return () => {
      clearTimeout(minuterie);
      window.removeEventListener("offline", horsLigne);
      window.removeEventListener("online", enLigneDeNouveau);
    };
  }, []);

  const texte = messageReseau(enLigne, retour);
  return (
    <div
      className={`mp-reseau${texte ? (enLigne ? " mp-reseau--retour" : " mp-reseau--hors-ligne") : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {texte ? <p className="mp-reseau__texte">{texte}</p> : null}
    </div>
  );
}
