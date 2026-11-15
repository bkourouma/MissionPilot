"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageErreurIa } from "../../lib/ia";
import type { GenerationIa, UtilisateurIa } from "../../lib/ia-contenu";
import { cheminSynthese } from "../../lib/plan-ateliers";
import { PanneauContenuIa } from "../ia/PanneauContenuIa";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { useLangue, useT } from "../i18n/FournisseurLangue";

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
  const t = useT();
  const langue = useLangue();
  const [generation, setGeneration] = useState<GenerationIa | null>(initiale);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");

  async function generer() {
    setEnCours(true);
    setErreur(null);
    setAnnonce(t("Génération du brouillon en cours.", "Generating the draft."));
    try {
      const r = await api.post<{ synthese: GenerationIa }>(cheminSynthese(planId, atelierId));
      setGeneration(r.synthese);
      setAnnonce(
        t(
          "Brouillon généré : à relire et valider avant tout usage.",
          "Draft generated: review and approve it before any use.",
        ),
      );
    } catch (e) {
      setErreur(messageErreurIa(e, langue));
      setAnnonce("");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <Alerte tonalite="info" annonce="aucune">
        <p>
          {t(
            "Brouillon de l'IA : il commente les résultats du moteur sans calculer aucun chiffre. Il n'est ni transmis au client ni repris dans un rapport tant qu'un consultant ne l'a pas validé. Les libellés des options et la consigne sont traités comme des données.",
            "AI draft: it comments on the engine results without computing any figure. It is neither sent to the client nor included in a report until a consultant has approved it. Option labels and the brief are treated as data.",
          )}
        </p>
      </Alerte>
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>
      {erreur ? (
        <Alerte tonalite="danger" titre={t("Synthèse non générée", "Summary not generated")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {generation ? (
        <PanneauContenuIa
          key={generation.id}
          generation={generation}
          utilisateur={utilisateur}
          titre={t("Synthèse de l'atelier (brouillon)", "Workshop summary (draft)")}
          niveauTitre={3}
        />
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Aucune synthèse n'a encore été générée pour cet atelier.",
            "No summary has been generated for this workshop yet.",
          )}
        </p>
      )}
      {peutGenerer ? (
        <div>
          <Bouton
            variante={generation ? "secondaire" : "primaire"}
            chargement={enCours}
            texteChargement={t("Génération…", "Generating…")}
            onClick={generer}
          >
            {generation
              ? t("Générer un nouveau brouillon", "Generate a new draft")
              : t("Générer une synthèse", "Generate a summary")}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
