"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  cheminApiDepot,
  etatSuivant,
  relancerAuRetour,
  type ReponseDepot,
} from "../../../lib/salle-mission-portail";
import { televerser } from "../../../lib/televersement";
import { ChoixFichier } from "../../fichiers/ChoixFichier";
import { Alerte } from "../../ui/Alerte";
import { Bouton } from "../../ui/Bouton";

export interface DepotPieceProps {
  pieceId: string;
  libelle: string;
  /** Pièce rejetée : le libellé du bouton invite à redéposer. */
  redepot: boolean;
}

/**
 * Dépôt d'une pièce par le client, mobile d'abord (« Prendre une photo » ou « Choisir un
 * fichier »). Hors connexion, le fichier choisi reste sur la page (en mémoire seulement) et part
 * automatiquement au retour du réseau ; un envoi interrompu se renvoie sans risque de doublon
 * (l'API reconnaît le même fichier). Réussi : la page est rechargée (statut « reçue »).
 */
export function DepotPiece({ pieceId, libelle, redepot }: DepotPieceProps) {
  const router = useRouter();
  const [fichier, setFichier] = useState<File | null>(null);
  const [etat, envoyer] = useReducer(etatSuivant, { etape: "inactif" });
  const enCours = useRef(false);

  const lancer = useCallback(
    async (f: File) => {
      if (enCours.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        envoyer({ type: "hors_ligne" });
        return;
      }
      enCours.current = true;
      envoyer({ type: "demarrer" });
      try {
        const r = await televerser<ReponseDepot>(cheminApiDepot(pieceId), f, f.name, {
          onProgression: (fraction) => envoyer({ type: "progression", fraction }),
        });
        envoyer({ type: "succes", nouveau: r.nouveau });
        setFichier(null);
        router.refresh();
      } catch (e) {
        envoyer({ type: "erreur", erreur: e, enLigne: navigator.onLine });
      } finally {
        enCours.current = false;
      }
    },
    [pieceId, router],
  );

  // Retour du réseau : le fichier gardé sur la page repart seul.
  useEffect(() => {
    if (!fichier || !relancerAuRetour(etat)) return;
    const auRetour = () => void lancer(fichier);
    window.addEventListener("online", auRetour);
    return () => window.removeEventListener("online", auRetour);
  }, [etat, fichier, lancer]);

  const progression = etat.etape === "envoi" ? etat.progression : null;

  return (
    <div className="mp-pile">
      <ChoixFichier
        libelle={redepot ? `Nouvelle version de « ${libelle} »` : `Déposer « ${libelle} »`}
        fichier={fichier}
        onChoix={(f) => {
          setFichier(f);
          envoyer({ type: "annuler" });
        }}
        photo
        progression={progression}
      />
      {etat.etape === "attente_reseau" ? (
        <Alerte tonalite="attention" annonce="status">
          <p>{etat.message}</p>
        </Alerte>
      ) : null}
      {etat.etape === "echec" ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{etat.message}</p>
        </Alerte>
      ) : null}
      {etat.etape === "reussi" ? (
        <Alerte tonalite="succes" annonce="status">
          <p>
            {etat.rejoue
              ? "Ce fichier était déjà bien reçu : rien n'a été envoyé en double."
              : "Document envoyé. Un accusé de réception vous est adressé."}
          </p>
        </Alerte>
      ) : null}
      {fichier ? (
        <div>
          <Bouton
            className="mp-salle-portail__envoyer"
            icone="envoyer"
            chargement={progression !== null}
            texteChargement="Envoi en cours…"
            onClick={() => void lancer(fichier)}
          >
            {etat.etape === "attente_reseau" ? "Réessayer maintenant" : "Envoyer le document"}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
