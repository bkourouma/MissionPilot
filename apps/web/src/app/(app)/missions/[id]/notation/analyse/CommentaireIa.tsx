"use client";

import { useState } from "react";
import { PanneauContenuIa } from "../../../../../../components/ia/PanneauContenuIa";
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
  const [generation, setGeneration] = useState<GenerationIa | null>(initial);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");

  async function generer() {
    setEnCours(true);
    setErreur(null);
    setAnnonce("Génération du brouillon en cours.");
    try {
      const r = await api.post<CommentaireExplication>(
        `/api/notations/${encodeURIComponent(notationId)}/explication/commentaire`,
        { version: numero, ...(cible ? { cible } : {}) },
      );
      setGeneration(r.commentaire);
      setAnnonce("Brouillon généré : à relire et valider avant tout usage.");
    } catch (e) {
      setErreur(messageErreurIa(e));
      setAnnonce("");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-notation__section">
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
        <Alerte tonalite="danger" titre="Commentaire non généré">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {generation ? (
        <PanneauContenuIa
          key={generation.id}
          generation={generation}
          utilisateur={utilisateur}
          titre="Commentaire de l'IA (brouillon)"
          niveauTitre={3}
        />
      ) : (
        <p className="mp-texte-doux">
          Aucun commentaire n&apos;a encore été généré pour cette version.
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
            {generation ? "Générer un nouveau brouillon" : "Générer un brouillon de commentaire"}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
