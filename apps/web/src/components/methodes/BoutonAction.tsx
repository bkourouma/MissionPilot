"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, messageErreur } from "../../lib/api";
import { hrefVersion, messageMethodes } from "../../lib/methodes";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Alerte } from "../ui/Alerte";
import { Bouton, type VarianteBouton } from "../ui/Bouton";
import type { NomIcone } from "../ui/Icone";

export interface BoutonActionProps {
  libelle: string;
  /** Chemin de l'API (`/api/...`). */
  chemin: string;
  methode?: "POST" | "DELETE";
  corps?: unknown;
  /** Action sensible : confirmation en deux temps. */
  confirmation?: { question: string; libelleConfirmation: string };
  /** Page à ouvrir après succès (à partir de la réponse) ; sinon rafraîchissement. */
  destination?: (reponse: unknown) => string;
  /**
   * Variante sérialisable de `destination` pour un appel depuis un composant serveur (une fonction
   * ne peut pas lui être passée) : champ de la réponse qui porte l'identifiant de la version à ouvrir.
   */
  versionDans?: "id" | "version_id";
  variante?: VarianteBouton;
  icone?: NomIcone;
  texteChargement?: string;
}

/** Action ponctuelle sur l'API (publier, créer une variante, supprimer…) avec retour d'erreur. */
export function BoutonAction({
  libelle,
  chemin,
  methode = "POST",
  corps,
  confirmation,
  destination,
  versionDans,
  variante = "secondaire",
  icone,
  texteChargement: texteChargementProp,
}: BoutonActionProps) {
  const t = useT();
  const langue = useLangue();
  const texteChargement = texteChargementProp ?? t("En cours…", "In progress…");
  const router = useRouter();
  const { rafraichir, enAttente } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const refAlerte = useRef<HTMLDivElement>(null);

  async function agir(): Promise<boolean> {
    setErreur(null);
    setEnCours(true);
    try {
      const r =
        methode === "DELETE"
          ? await api.supprimer(chemin)
          : await api.post<unknown>(chemin, corps ?? {});
      if (destination) router.push(destination(r));
      else if (versionDans)
        router.push(hrefVersion((r as Record<string, string>)[versionDans] ?? ""));
      else rafraichir();
      return true;
    } catch (e) {
      setErreur(messageMethodes(e, langue) ?? messageErreur(e));
      setTimeout(() => refAlerte.current?.focus(), 0);
      return false;
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      {confirmation ? (
        <BoutonConfirmation
          libelle={libelle}
          question={confirmation.question}
          libelleConfirmation={confirmation.libelleConfirmation}
          action={agir}
          variante={variante}
          icone={icone}
          texteChargement={texteChargement}
        />
      ) : (
        <Bouton
          variante={variante}
          icone={icone}
          chargement={enCours}
          texteChargement={texteChargement}
          onClick={() => void agir()}
        >
          {libelle}
        </Bouton>
      )}
      {erreur ? (
        <Alerte
          ref={refAlerte}
          tonalite="danger"
          titre={t("Action impossible", "Action not possible")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
