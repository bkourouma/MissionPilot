"use client";

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
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";

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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [enCours, setEnCours] = useState<FormatRapportCloture | null>(null);
  const [erreur, setErreur] = useState<{ message: string; actualiser: boolean } | null>(null);
  const [cree, setCree] = useState<RapportClotureCree | null>(null);
  const verrou = useRef(false);
  const refErreur = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);

  const attente: Record<FormatRapportCloture, string> = {
    pdf: t(
      "Génération du PDF en cours : cela peut prendre une trentaine de secondes.",
      "PDF generation in progress: this may take about thirty seconds.",
    ),
    docx: t("Génération du document Word en cours.", "Word document generation in progress."),
  };

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
      rafraichir();
    } catch (e) {
      setErreur({ message: messageCloture(e, langue), actualiser: peutEtreCree(e) });
    } finally {
      verrou.current = false;
      setEnCours(null);
    }
  }

  return (
    <div className="mp-pile">
      <p className="mp-visuellement-cache" role="status">
        {enCours ? attente[enCours] : ""}
      </p>
      <div className="mp-clo-rapport-formats">
        {FORMATS_RAPPORT_CLOTURE.map((f) => (
          <Bouton
            key={f}
            variante="secondaire"
            icone="telechargement"
            chargement={enCours === f}
            texteChargement={t("Génération en cours…", "Generating…")}
            disabled={Boolean(desactiveParce) || (enCours !== null && enCours !== f)}
            onClick={() => void generer(f)}
          >
            {t(
              `Générer le rapport (${FORMAT_RAPPORT_CLOTURE_LIBELLES[f]})`,
              `Generate the report (${FORMAT_RAPPORT_CLOTURE_LIBELLES[f]})`,
            )}
          </Bouton>
        ))}
      </div>
      {desactiveParce ? <p className="mp-texte-doux mp-texte-petit">{desactiveParce}</p> : null}
      {erreur ? (
        <Alerte
          ref={refErreur}
          tonalite="danger"
          titre={t("Génération impossible", "Generation not possible")}
        >
          <p>{erreur.message}</p>
          {erreur.actualiser ? (
            <Bouton variante="secondaire" icone="historique" onClick={() => rafraichir()}>
              {t("Actualiser la liste", "Refresh the list")}
            </Bouton>
          ) : null}
        </Alerte>
      ) : null}
      {cree ? (
        <Alerte tonalite="succes" titre={t("Rapport généré", "Report generated")} annonce="status">
          <FichierJoint
            fichier={cree.fichier}
            contexte={t("(rapport qui vient d'être généré)", "(report just generated)")}
          />
        </Alerte>
      ) : null}
    </div>
  );
}
