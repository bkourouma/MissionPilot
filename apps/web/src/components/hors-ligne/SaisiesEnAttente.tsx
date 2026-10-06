"use client";

import { useCallback, useEffect, useState } from "react";
import { envoyerSaisie, rejouer } from "../../lib/hors-ligne/envoi";
import { libelleNombreEnAttente } from "../../lib/hors-ligne/etats";
import {
  abandonner,
  lister,
  purgerAutresUtilisateurs,
  renvoyer,
  type SaisieEnAttente,
} from "../../lib/hors-ligne/file-temps";
import { abonner, obtenirMagasin } from "../../lib/hors-ligne/magasins";
import { libelleDateCourte } from "../../lib/semaine";
import { Alerte } from "../ui/Alerte";
import { DecisionSaisie } from "./DecisionSaisie";

export interface SaisiesEnAttenteProps {
  utilisateurId: string;
  /** Feuille affichée sur la page : sa saisie est gérée par la grille, pas ici. */
  feuilleCouranteId?: string | null;
}

/**
 * Saisies d'autres semaines restées sur l'appareil : envoi au retour du réseau (dans l'ordre),
 * et décision pour celles qui n'ont pas pu être appliquées. Rien ne s'affiche quand la file
 * est vide. Les saisies d'un autre compte sont retirées (appareil partagé).
 */
export function SaisiesEnAttente({ utilisateurId, feuilleCouranteId }: SaisiesEnAttenteProps) {
  const [entrees, setEntrees] = useState<SaisieEnAttente[]>([]);

  const actualiser = useCallback(async () => {
    try {
      const m = await obtenirMagasin();
      const toutes = await lister(m, utilisateurId);
      setEntrees(toutes.filter((e) => e.feuilleId !== feuilleCouranteId));
    } catch {
      setEntrees([]);
    }
  }, [utilisateurId, feuilleCouranteId]);

  const envoyerTout = useCallback(async () => {
    try {
      const m = await obtenirMagasin();
      await rejouer({ magasin: m, utilisateurId, envoyer: envoyerSaisie });
    } catch {
      // Stockage indisponible : l'affichage ci-dessous reste juste.
    }
    await actualiser();
  }, [utilisateurId, actualiser]);

  useEffect(() => {
    void (async () => {
      try {
        await purgerAutresUtilisateurs(await obtenirMagasin(), utilisateurId);
      } catch {
        // Stockage indisponible.
      }
      await envoyerTout();
    })();
    const enLigne = () => void envoyerTout();
    window.addEventListener("online", enLigne);
    const desabonner = abonner(() => void actualiser());
    return () => {
      window.removeEventListener("online", enLigne);
      desabonner();
    };
  }, [utilisateurId, envoyerTout, actualiser]);

  const enAttente = entrees.filter((e) => e.etat === "en_attente" || e.etat === "a_corriger");
  const deCote = entrees.filter((e) => e.etat === "conflit" || e.etat === "refuse");
  if (entrees.length === 0) return null;

  return (
    <section className="mp-pile" aria-labelledby="saisies-en-attente-titre">
      <h2 id="saisies-en-attente-titre" className="mp-visuellement-cache">
        Saisies gardées sur cet appareil
      </h2>
      {enAttente.length > 0 ? (
        <Alerte tonalite="info" titre={libelleNombreEnAttente(enAttente.length)}>
          <p>
            {`Semaine(s) du ${enAttente.map((e) => libelleDateCourte(e.semaine)).join(", ")} : envoi automatique au retour du réseau.`}
          </p>
        </Alerte>
      ) : null}
      {deCote.map((e) => (
        <DecisionSaisie
          key={e.cle}
          entree={e}
          lienSemaine
          onRenvoyer={async () => {
            await renvoyer(await obtenirMagasin(), e.cle);
            await envoyerTout();
          }}
          onAbandonner={async () => {
            await abandonner(await obtenirMagasin(), e.cle);
            await actualiser();
          }}
        />
      ))}
    </section>
  );
}
