"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageErreurIa } from "../../lib/ia";
import type { GenerationIa, UtilisateurIa } from "../../lib/ia-contenu";
import { cheminExplication } from "../../lib/plan-vivant";
import { PanneauContenuIa } from "../ia/PanneauContenuIa";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

/**
 * Explication de l'IA sur les écarts d'une re-prévision (PLA-18) : un BROUILLON qui commente les
 * chiffres du moteur sans en calculer aucun, jamais transmis au client ni repris dans un rapport tant
 * qu'un consultant ne l'a pas validé. La relecture, la modification et la validation passent par le
 * panneau des générations (/api/ia/generations/:id), qui applique la séparation des tâches.
 */
export function ExplicationReprevision({
  planId,
  reprevisionId,
  initiale,
  peutGenerer,
  utilisateur,
}: {
  planId: string;
  reprevisionId: string;
  initiale: GenerationIa | null;
  peutGenerer: boolean;
  utilisateur: UtilisateurIa;
}) {
  const [generation, setGeneration] = useState<GenerationIa | null>(initiale);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");

  async function generer() {
    setEnCours(true);
    setErreur(null);
    setAnnonce("Génération du brouillon en cours.");
    try {
      const r = await api.post<{ explication: GenerationIa }>(
        cheminExplication(planId, reprevisionId),
        {},
      );
      setGeneration(r.explication);
      setAnnonce("Brouillon généré : à relire et valider avant tout usage.");
    } catch (e) {
      setErreur(messageErreurIa(e));
      setAnnonce("");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pv">
      <Alerte tonalite="info" annonce="aucune">
        <p>
          Brouillon de l&apos;IA : il commente les chiffres du moteur sans en calculer aucun. Il
          n&apos;est ni transmis au client ni repris dans un rapport tant qu&apos;un consultant ne
          l&apos;a pas validé.
        </p>
      </Alerte>
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>
      {erreur ? (
        <Alerte tonalite="danger" titre="Explication non générée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {generation ? (
        <PanneauContenuIa
          key={generation.id}
          generation={generation}
          utilisateur={utilisateur}
          titre="Explication de l'IA (brouillon)"
          niveauTitre={4}
        />
      ) : (
        <p className="mp-texte-doux">
          Aucune explication n&apos;a encore été générée pour cette re-prévision.
        </p>
      )}
      {peutGenerer ? (
        <div>
          <Bouton
            type="button"
            variante={generation ? "secondaire" : "primaire"}
            chargement={enCours}
            texteChargement="Génération…"
            onClick={generer}
          >
            {generation ? "Générer un nouveau brouillon" : "Générer un brouillon d'explication"}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
