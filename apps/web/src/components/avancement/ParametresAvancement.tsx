"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  AIDE_ENVOI_EMAIL,
  CHEMIN_API_PARAMETRES_AVANCEMENT,
  LIBELLE_ENVOI_EMAIL,
  messageAvancement,
  type ParametresAvancement as Parametres,
} from "../../lib/avancement";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { CaseACocher } from "../ui/CaseACocher";

/**
 * Paramètre du cabinet (droit « automatisation.gerer ») : rapports hebdomadaires actifs ou non.
 * L'envoi par e-mail au client est visible mais DÉSACTIVÉ et non branché : il n'est jamais envoyé
 * à l'API (seule la valeur `false` serait acceptée).
 */
export function ParametresAvancement({ parametres }: { parametres: Parametres }) {
  const { rafraichir, enAttente } = useRafraichir();
  const [actif, setActif] = useState(parametres.actif);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const verrou = useRef(false);
  const refAlerte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    if (verrou.current) return;
    verrou.current = true;
    setEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      await api.put(CHEMIN_API_PARAMETRES_AVANCEMENT, { actif });
      setSucces("Paramètre enregistré.");
      rafraichir();
    } catch (err) {
      setErreur(messageAvancement(err));
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  return (
    <Carte titre="Paramètre du cabinet" niveauTitre={2}>
      <form className="mp-pile" onSubmit={(e) => void enregistrer(e)}>
        <RetourFormulaire
          erreur={erreur}
          succes={succes}
          refAlerte={refAlerte}
          titreErreur="Paramètre non enregistré"
        />
        <CaseACocher
          libelle="Préparer chaque semaine un rapport d'avancement pour les missions en cours"
          aide="Le brouillon est généré automatiquement ; un chef de mission le relit puis le valide."
          checked={actif}
          onChange={(e) => setActif(e.target.checked)}
        />
        <CaseACocher
          libelle={LIBELLE_ENVOI_EMAIL}
          aide={AIDE_ENVOI_EMAIL}
          checked={false}
          disabled
          readOnly
        />
        <div>
          <Bouton
            type="submit"
            chargement={enCours || enAttente}
            texteChargement="Enregistrement…"
            disabled={actif === parametres.actif}
          >
            Enregistrer
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}
