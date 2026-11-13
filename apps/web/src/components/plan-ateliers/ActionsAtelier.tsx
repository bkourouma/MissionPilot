"use client";

import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminCloreAtelier,
  cheminOuvrirAtelier,
  messageAtelier,
  type StatutAtelier,
} from "../../lib/plan-ateliers";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { useLangue, useT } from "../i18n/FournisseurLangue";

export interface ActionsAtelierProps {
  planId: string;
  atelierId: string;
  statut: StatutAtelier;
  /** Raison pour laquelle l'ouverture est impossible (null : possible). */
  raisonOuverture: string | null;
}

/** Ouvrir (brouillon) ou clore (ouvert) l'atelier ; la clôture fige les résultats du moteur. */
export function ActionsAtelier({
  planId,
  atelierId,
  statut,
  raisonOuverture,
}: ActionsAtelierProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const refAlerte = useRef<HTMLDivElement>(null);

  async function executer(chemin: string): Promise<boolean> {
    setErreur(null);
    try {
      await api.post(chemin);
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messageAtelier(e, langue));
      refAlerte.current?.focus();
      return false;
    }
  }

  if (statut === "clos") return null;
  return (
    <div className="mp-pile">
      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre={t("Action refusée", "Action refused")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {statut === "brouillon" ? (
        <div className="mp-barre-actions">
          <Bouton
            icone="succes"
            disabled={raisonOuverture !== null}
            chargement={enCours}
            texteChargement={t("Ouverture…", "Opening…")}
            onClick={async () => {
              setEnCours(true);
              await executer(cheminOuvrirAtelier(planId, atelierId));
              setEnCours(false);
            }}
          >
            {t("Ouvrir l'atelier aux participants", "Open the workshop to participants")}
          </Bouton>
          {raisonOuverture ? (
            <p className="mp-texte-doux mp-texte-petit">{raisonOuverture}</p>
          ) : null}
        </div>
      ) : (
        <BoutonConfirmation
          libelle={t("Clore l'atelier", "Close the workshop")}
          question={t(
            "Clore l'atelier ? Les contributions sont figées et les résultats calculés. Cette action est définitive.",
            "Close the workshop? Contributions are frozen and the results are computed. This action is final.",
          )}
          libelleConfirmation={t("Oui, clore l'atelier", "Yes, close the workshop")}
          texteChargement={t("Clôture…", "Closing…")}
          variante="primaire"
          action={() => executer(cheminCloreAtelier(planId, atelierId))}
        />
      )}
    </div>
  );
}
