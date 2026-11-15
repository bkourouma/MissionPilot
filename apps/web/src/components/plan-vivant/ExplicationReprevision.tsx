"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageErreurIa } from "../../lib/ia";
import type { GenerationIa, UtilisateurIa } from "../../lib/ia-contenu";
import { cheminExplication } from "../../lib/plan-vivant";
import { PanneauContenuIa } from "../ia/PanneauContenuIa";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { useLangue, useT } from "../i18n/FournisseurLangue";

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
      const r = await api.post<{ explication: GenerationIa }>(
        cheminExplication(planId, reprevisionId),
        {},
      );
      setGeneration(r.explication);
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
    <div className="mp-pv">
      <Alerte tonalite="info" annonce="aucune">
        <p>
          {t(
            "Brouillon de l'IA : il commente les chiffres du moteur sans en calculer aucun. Il n'est ni transmis au client ni repris dans un rapport tant qu'un consultant ne l'a pas validé.",
            "AI draft: it comments on the engine figures without computing any. It is neither sent to the client nor included in a report until a consultant has approved it.",
          )}
        </p>
      </Alerte>
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>
      {erreur ? (
        <Alerte tonalite="danger" titre={t("Explication non générée", "Explanation not generated")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {generation ? (
        <PanneauContenuIa
          key={generation.id}
          generation={generation}
          utilisateur={utilisateur}
          titre={t("Explication de l'IA (brouillon)", "AI explanation (draft)")}
          niveauTitre={4}
        />
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Aucune explication n'a encore été générée pour cette re-prévision.",
            "No explanation has been generated for this re-forecast yet.",
          )}
        </p>
      )}
      {peutGenerer ? (
        <div>
          <Bouton
            type="button"
            variante={generation ? "secondaire" : "primaire"}
            chargement={enCours}
            texteChargement={t("Génération…", "Generating…")}
            onClick={generer}
          >
            {generation
              ? t("Générer un nouveau brouillon", "Generate a new draft")
              : t("Générer un brouillon d'explication", "Generate an explanation draft")}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
