"use client";

import { useState } from "react";
import { PanneauContenuIa } from "../../../../../../components/ia/PanneauContenuIa";
import { useLangue, useT } from "../../../../../../components/i18n/FournisseurLangue";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Bouton } from "../../../../../../components/ui/Bouton";
import { api } from "../../../../../../lib/api";
import { messageErreurIa } from "../../../../../../lib/ia";
import type { GenerationIa, UtilisateurIa } from "../../../../../../lib/ia-contenu";
import type { CommentaireExplication } from "../../../../../../lib/notation-augmentee";

/**
 * Commentaire de l'IA sur l'explication de la note (NOT-12) : un BROUILLON rédigé à partir des
 * seuls chiffres des moteurs, jamais transmis au client ni repris dans un rapport tant qu'un
 * consultant ne l'a pas validé. La relecture, la modification et la validation passent par le
 * panneau des générations (/api/ia/generations/:id), qui applique la séparation des tâches.
 */
export function CommentaireIa({
  notationId,
  numero,
  cible,
  initial,
  peutGenerer,
  utilisateur,
}: {
  notationId: string;
  numero: number;
  cible: string | null;
  initial: GenerationIa | null;
  peutGenerer: boolean;
  utilisateur: UtilisateurIa;
}) {
  const t = useT();
  const langue = useLangue();
  const [generation, setGeneration] = useState<GenerationIa | null>(initial);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");

  async function generer() {
    setEnCours(true);
    setErreur(null);
    setAnnonce(t("Génération du brouillon en cours.", "Generating the draft."));
    try {
      const r = await api.post<CommentaireExplication>(
        `/api/notations/${encodeURIComponent(notationId)}/explication/commentaire`,
        { version: numero, ...(cible ? { cible } : {}) },
      );
      setGeneration(r.commentaire);
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
    <div className="mp-notation__section">
      <Alerte tonalite="info" annonce="aucune">
        <p>
          {t(
            "Brouillon de l'IA : il commente les chiffres du moteur sans en calculer aucun. Il n'est ni transmis au client ni repris dans un rapport tant qu'un consultant ne l'a pas validé.",
            "AI draft: it comments on the engine's figures without computing any. It is neither sent to the client nor included in a report until a consultant has approved it.",
          )}
        </p>
      </Alerte>
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>
      {erreur ? (
        <Alerte tonalite="danger" titre={t("Commentaire non généré", "Comment not generated")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {generation ? (
        <PanneauContenuIa
          key={generation.id}
          generation={generation}
          utilisateur={utilisateur}
          titre={t("Commentaire de l'IA (brouillon)", "AI comment (draft)")}
          niveauTitre={3}
        />
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Aucun commentaire n'a encore été généré pour cette version.",
            "No comment has been generated for this version yet.",
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
              : t("Générer un brouillon de commentaire", "Generate a draft comment")}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
