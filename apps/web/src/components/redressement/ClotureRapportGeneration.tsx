"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { DELAI_GENERATION_MS, peutEtreCree } from "../../lib/rapports";
import {
  cheminGenerationRapportCloture,
  FORMAT_RAPPORT_CLOTURE_LIBELLES,
  FORMATS_RAPPORT_CLOTURE,
  messageCloture,
  type FormatRapportCloture,
  type RapportClotureCree,
} from "../../lib/redressement-cloture";
import { FichierJoint } from "../fichiers/FichierJoint";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

const ATTENTE: Record<FormatRapportCloture, string> = {
  pdf: "Génération du PDF en cours : cela peut prendre une trentaine de secondes.",
  docx: "Génération du document Word en cours.",
};

/**
 * Génération du rapport de clôture (PDF ou Word) d'un bilan VALIDÉ. Un seul envoi à la fois ;
 * l'erreur est annoncée et focalisée ; en cas de délai dépassé le rapport a pu être créé : la
 * liste est à actualiser avant de relancer. Le fichier se télécharge par la liste des rapports.
 */
export function ClotureRapportGeneration({
  clotureId,
  desactiveParce,
}: {
  clotureId: string;
  /** Raison affichée quand la génération n'est pas possible (bilan non validé, mission clôturée). */
  desactiveParce?: string;
}) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<FormatRapportCloture | null>(null);
  const [erreur, setErreur] = useState<{ message: string; actualiser: boolean } | null>(null);
  const [cree, setCree] = useState<RapportClotureCree | null>(null);
  const verrou = useRef(false);
  const refErreur = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);

  async function generer(format: FormatRapportCloture) {
    if (verrou.current || desactiveParce) return;
    verrou.current = true;
    setErreur(null);
    setCree(null);
    setEnCours(format);
    try {
      const r = await api.post<RapportClotureCree>(
        cheminGenerationRapportCloture(clotureId, format),
        undefined,
        { delaiMs: DELAI_GENERATION_MS },
      );
      setCree(r);
      router.refresh();
    } catch (e) {
      setErreur({ message: messageCloture(e), actualiser: peutEtreCree(e) });
    } finally {
      verrou.current = false;
      setEnCours(null);
    }
  }

  return (
    <div className="mp-pile">
      <p className="mp-visuellement-cache" role="status">
        {enCours ? ATTENTE[enCours] : ""}
      </p>
      <div className="mp-clo-rapport-formats">
        {FORMATS_RAPPORT_CLOTURE.map((f) => (
          <Bouton
            key={f}
            variante="secondaire"
            icone="telechargement"
            chargement={enCours === f}
            texteChargement="Génération en cours…"
            disabled={Boolean(desactiveParce) || (enCours !== null && enCours !== f)}
            onClick={() => void generer(f)}
          >
            {`Générer le rapport (${FORMAT_RAPPORT_CLOTURE_LIBELLES[f]})`}
          </Bouton>
        ))}
      </div>
      {desactiveParce ? <p className="mp-texte-doux mp-texte-petit">{desactiveParce}</p> : null}
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Génération impossible">
          <p>{erreur.message}</p>
          {erreur.actualiser ? (
            <Bouton variante="secondaire" icone="historique" onClick={() => router.refresh()}>
              Actualiser la liste
            </Bouton>
          ) : null}
        </Alerte>
      ) : null}
      {cree ? (
        <Alerte tonalite="succes" titre="Rapport généré" annonce="status">
          <FichierJoint fichier={cree.fichier} contexte="(rapport qui vient d'être généré)" />
        </Alerte>
      ) : null}
    </div>
  );
}
