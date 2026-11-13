"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  CHEMIN_API_PARAMETRES_AVANCEMENT,
  libellesAvancement,
  messageAvancement,
  type ParametresAvancement as Parametres,
} from "../../lib/avancement";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { CaseACocher } from "../ui/CaseACocher";

/**
 * Paramètre du cabinet (droit « automatisation.gerer ») : rapports hebdomadaires actifs ou non.
 * L'envoi par e-mail au client est visible mais DÉSACTIVÉ et non branché : il n'est jamais envoyé
 * à l'API (seule la valeur `false` serait acceptée).
 */
export function ParametresAvancement({ parametres }: { parametres: Parametres }) {
  const t = useT();
  const langue = useLangue();
  const libelles = libellesAvancement(langue);
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
      setSucces(t("Paramètre enregistré.", "Setting saved."));
      rafraichir();
    } catch (err) {
      setErreur(messageAvancement(err, langue));
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  return (
    <Carte titre={t("Paramètre du cabinet", "Firm setting")} niveauTitre={2}>
      <form className="mp-pile" onSubmit={(e) => void enregistrer(e)}>
        <RetourFormulaire
          erreur={erreur}
          succes={succes}
          refAlerte={refAlerte}
          titreErreur={t("Paramètre non enregistré", "Setting not saved")}
        />
        <CaseACocher
          libelle={t(
            "Préparer chaque semaine un rapport d'avancement pour les missions en cours",
            "Prepare a weekly progress report for engagements in progress",
          )}
          aide={t(
            "Le brouillon est généré automatiquement ; un chef de mission le relit puis le valide.",
            "The draft is generated automatically; an engagement manager reviews and approves it.",
          )}
          checked={actif}
          onChange={(e) => setActif(e.target.checked)}
        />
        <CaseACocher
          libelle={libelles.libelleEnvoiEmail}
          aide={libelles.aideEnvoiEmail}
          checked={false}
          disabled
          readOnly
        />
        <div>
          <Bouton
            type="submit"
            chargement={enCours || enAttente}
            texteChargement={t("Enregistrement…", "Saving…")}
            disabled={actif === parametres.actif}
          >
            {t("Enregistrer", "Save")}
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}
