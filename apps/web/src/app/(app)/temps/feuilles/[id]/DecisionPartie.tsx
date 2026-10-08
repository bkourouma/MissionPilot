"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { api } from "../../../../../lib/api";
import { validerMotif } from "../../../../../lib/temps";

/**
 * Décision sur une partie d'une feuille (une mission ou les activités internes) : valider, ou
 * rejeter avec un motif obligatoire transmis au collaborateur (TPS-03).
 */
export function DecisionPartie({
  feuilleId,
  missionId,
  intitule,
}: {
  feuilleId: string;
  missionId: string | null;
  intitule: string;
}) {
  const [rejet, setRejet] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const base = `/api/feuilles-temps/${encodeURIComponent(feuilleId)}`;
  const partie = missionId ? { mission_id: missionId } : { interne: true as const };

  async function rejeter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif), (c) => api.post(`${base}/rejeter`, { ...partie, ...c }), {
      succes: "Partie rejetée : le collaborateur est prévenu et peut corriger sa feuille.",
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Décision impossible"
      />
      {rejet ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={rejeter}>
          <ZoneTexte
            libelle="Motif du rejet"
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide="Précisez quoi corriger : le motif est envoyé au collaborateur."
          />
          <div className="mp-barre-actions">
            <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Rejet…">
              Rejeter
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setRejet(false)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-barre-actions">
          <Bouton
            icone="succes"
            chargement={f.enCours}
            texteChargement="Validation…"
            aria-label={`Valider : ${intitule}`}
            onClick={() =>
              f.envoyer({ ok: true, charge: partie }, (c) => api.post(`${base}/valider`, c), {
                succes: "Partie validée.",
              })
            }
          >
            Valider
          </Bouton>
          <Bouton
            variante="secondaire"
            icone="fermer"
            aria-label={`Rejeter : ${intitule}`}
            onClick={() => setRejet(true)}
          >
            Rejeter…
          </Bouton>
        </div>
      )}
    </div>
  );
}
