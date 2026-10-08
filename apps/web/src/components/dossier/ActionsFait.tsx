"use client";

import { useState } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { api } from "../../lib/api";
import {
  cheminApiDossier,
  saisieRemplacement,
  validerDecisionFait,
  type ChampDecision,
  type Fait,
} from "../../lib/dossier";
import { FormulaireFait } from "./FormulaireFait";

/**
 * Actions sur un fait : confirmer ou rejeter une proposition (l'auteur ne confirme pas sa
 * propre proposition, l'API le refuse), ou remplacer un fait courant par une nouvelle valeur.
 */
export function ActionsFait({
  clientId,
  fait,
  utilisateurId,
}: {
  clientId: string;
  fait: Fait;
  utilisateurId: string;
}) {
  const [mode, setMode] = useState<"aucun" | "rejet" | "remplacement">("aucun");
  const [motif, setMotif] = useState("");
  const f = useFormulaire<ChampDecision>();
  const url = `${cheminApiDossier(clientId)}/faits/${encodeURIComponent(fait.id)}/decision`;
  const decider = (decision: "confirme" | "rejete") =>
    f.envoyer(validerDecisionFait(decision, motif), (charge) => api.post(url, charge), {
      succes: decision === "confirme" ? "Fait confirmé." : "Fait rejeté.",
      apres: () => setMode("aucun"),
    });
  const auteur = fait.auteur.id === utilisateurId && fait.origine === "saisie";

  if (mode === "remplacement") {
    return (
      <FormulaireFait
        clientId={clientId}
        saisieInitiale={saisieRemplacement(fait)}
        titre={`Remplacer le fait « ${fait.cle} »`}
        onTermine={() => setMode("aucun")}
      />
    );
  }
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {mode === "rejet" ? (
        <form
          className="mp-formulaire"
          noValidate
          aria-label="Rejeter le fait"
          onSubmit={(e) => {
            e.preventDefault();
            void decider("rejete");
          }}
        >
          <ZoneTexte
            libelle="Motif du rejet"
            rows={2}
            required
            maxLength={2000}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
          />
          <div className="mp-barre-actions">
            <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Rejet…">
              Rejeter
            </Bouton>
            <Bouton variante="discret" onClick={() => setMode("aucun")}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          {fait.statut === "propose" && !auteur ? (
            <Bouton
              chargement={f.enCours}
              texteChargement="Confirmation…"
              onClick={() => void decider("confirme")}
            >
              Confirmer
            </Bouton>
          ) : null}
          {fait.statut === "propose" ? (
            <Bouton variante="secondaire" onClick={() => setMode("rejet")}>
              {auteur ? "Retirer" : "Rejeter"}
            </Bouton>
          ) : null}
          {fait.statut === "propose" || fait.statut === "confirme" ? (
            <Bouton variante="discret" icone="crayon" onClick={() => setMode("remplacement")}>
              Remplacer
            </Bouton>
          ) : null}
        </div>
      )}
    </div>
  );
}
