"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageDd } from "../../lib/due-diligence";
import { validerDecision } from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface ValidationDecisionProps {
  /** Route de validation (`/api/dd/verdicts/:id/validation` ou `/api/dd/notes/:id/validation`). */
  chemin: string;
  /** Champs fixes du corps (par exemple `{ version: 3 }` pour une note) : valeurs simples uniquement. */
  corps?: Record<string, number | string>;
  /** Objet validé, pour les libellés : « ce verdict », « cette version de la note ». */
  objet: string;
  succesValide: string;
  succesRejete: string;
}

/**
 * « Valider » / « Rejeter » une proposition (verdict, note) : un rejet se motive. L'affichage de ces
 * boutons suppose `dd.valider` et un valideur différent de l'auteur ; l'API reste seule juge
 * (séparation des tâches, doublée en base) et son refus s'affiche avec son message précis.
 */
export function ValidationDecision({
  chemin,
  corps = {},
  objet,
  succesValide,
  succesRejete,
}: ValidationDecisionProps) {
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");
  const [rejet, setRejet] = useState(false);

  async function decider(decision: "valide" | "rejete") {
    await f.envoyer(
      validerDecision(decision, motif),
      (charge) => api.post(chemin, { ...corps, ...charge }),
      {
        succes: decision === "valide" ? succesValide : succesRejete,
        messageSpecifique: messageDd,
        apres: () => {
          setMotif("");
          setRejet(false);
        },
      },
    );
  }

  return (
    <div className="mp-formulaire">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Décision refusée"
      />
      {rejet ? (
        <ZoneTexte
          libelle={`Motif du rejet de ${objet}`}
          required
          rows={2}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
          aide="Un rejet se motive ; le motif est conservé."
        />
      ) : null}
      <div className="mp-barre-actions">
        {rejet ? (
          <>
            <Bouton variante="danger" disabled={f.enCours} onClick={() => void decider("rejete")}>
              Confirmer le rejet
            </Bouton>
            <Bouton variante="discret" onClick={() => setRejet(false)}>
              Annuler
            </Bouton>
          </>
        ) : (
          <>
            <Bouton
              chargement={f.enCours}
              texteChargement="Enregistrement…"
              onClick={() => void decider("valide")}
            >
              Valider
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setRejet(true)}>
              Rejeter
            </Bouton>
          </>
        )}
      </div>
    </div>
  );
}
