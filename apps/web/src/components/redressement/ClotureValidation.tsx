"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminClotures,
  cheminValidationCloture,
  clotureEstPerimee,
  messageCloture,
} from "../../lib/redressement-cloture";
import { corpsValidationCloture } from "../../lib/redressement-cloture-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionRed } from "./BoutonActionRed";

/**
 * Validation du bilan par le directeur de la mission. Le bouton est proposé à qui a le droit de
 * valider ; l'API reste seule juge (réserve au directeur, séparation des tâches, contrôles
 * bloquants, état du dossier inchangé) et son message s'affiche tel quel. Si le bilan est périmé,
 * un nouveau bilan peut être établi d'ici.
 */
export function ClotureValidation({
  clotureId,
  dossierId,
  peutEtablir,
}: {
  clotureId: string;
  dossierId: string;
  /** L'utilisateur peut établir un nouveau bilan (proposé si celui-ci est périmé). */
  peutEtablir: boolean;
}) {
  const { rafraichir, enAttente } = useRafraichir();
  const [motif, setMotif] = useState("");
  const [erreurChamp, setErreurChamp] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [perimee, setPerimee] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const verrou = useRef(false);
  const refAlerte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verrou.current) return;
    setErreur(null);
    setSucces(null);
    setPerimee(false);
    const corps = corpsValidationCloture(motif);
    if (!corps.ok) {
      setErreurChamp(corps.erreurs.motif);
      return;
    }
    setErreurChamp(undefined);
    verrou.current = true;
    setEnCours(true);
    try {
      await api.post(cheminValidationCloture(clotureId), corps.charge);
      setSucces("Bilan validé : il est figé.");
      rafraichir();
    } catch (err) {
      setErreur(messageCloture(err));
      setPerimee(clotureEstPerimee(err));
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  return (
    <form className="mp-formulaire" noValidate onSubmit={soumettre} aria-label="Valider le bilan">
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur="Validation impossible"
      />
      <ZoneTexte
        libelle="Motif ou commentaire de validation (facultatif)"
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={erreurChamp}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="primaire"
          chargement={enCours}
          texteChargement="Validation…"
        >
          Valider le bilan
        </Bouton>
      </div>
      {perimee && peutEtablir ? (
        <BoutonActionRed
          libelle="Établir un nouveau bilan"
          chemin={cheminClotures(dossierId)}
          succes="Nouveau bilan établi depuis l'état courant du dossier."
          titreErreur="Établissement impossible"
          texteChargement="Établissement…"
        />
      ) : null}
    </form>
  );
}
