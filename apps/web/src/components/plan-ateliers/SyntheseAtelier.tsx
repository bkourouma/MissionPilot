"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageErreurIa } from "../../lib/ia";
import type { GenerationIa, UtilisateurIa } from "../../lib/ia-contenu";
import { cheminSynthese } from "../../lib/plan-ateliers";
import { PanneauContenuIa } from "../ia/PanneauContenuIa";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

export interface SyntheseAtelierProps {
  planId: string;
  atelierId: string;
  /** Dernière synthèse (brouillon IA, modifiée ou validée), ou null. */
  initiale: GenerationIa | null;
  peutGenerer: boolean;
  utilisateur: UtilisateurIa;
}

/**
 * Synthèse de l'atelier clos rédigée par l'IA (PLA-15) : un BROUILLON qui commente les chiffres du
 * moteur sans en calculer aucun. Il n'est jamais transmis au client avant validation par un autre
 * consultant ; la relecture et la validation passent par le panneau des générations.
 */
export function SyntheseAtelier({
  planId,
  atelierId,
  initiale,
  peutGenerer,
  utilisateur,
}: SyntheseAtelierProps) {
  const [generation, setGeneration] = useState<GenerationIa | null>(initiale);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");

  async function generer() {
    setEnCours(true);
    setErreur(null);
    setAnnonce("Génération du brouillon en cours.");
    try {
      const r = await api.post<{ synthese: GenerationIa }>(cheminSynthese(planId, atelierId));
      setGeneration(r.synthese);
      setAnnonce("Brouillon généré : à relire et valider avant tout usage.");
    } catch (e) {
      setErreur(messageErreurIa(e));
      setAnnonce("");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <Alerte tonalite="info" annonce="aucune">
        <p>
          Brouillon de l&apos;IA : il commente les résultats du moteur sans calculer aucun chiffre.
          Il n&apos;est ni transmis au client ni repris dans un rapport tant qu&apos;un consultant
          ne l&apos;a pas validé. Les libellés des options et la consigne sont traités comme des
          données.
        </p>
      </Alerte>
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>
      {erreur ? (
        <Alerte tonalite="danger" titre="Synthèse non générée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {generation ? (
        <PanneauContenuIa
          key={generation.id}
          generation={generation}
          utilisateur={utilisateur}
          titre="Synthèse de l'atelier (brouillon)"
          niveauTitre={3}
        />
      ) : (
        <p className="mp-texte-doux">
          Aucune synthèse n&apos;a encore été générée pour cet atelier.
        </p>
      )}
      {peutGenerer ? (
        <div>
          <Bouton
            variante={generation ? "secondaire" : "primaire"}
            chargement={enCours}
            texteChargement="Génération…"
            onClick={generer}
          >
            {generation ? "Générer un nouveau brouillon" : "Générer une synthèse"}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
