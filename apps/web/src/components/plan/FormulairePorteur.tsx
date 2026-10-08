"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { cheminPorteur, messageCascade } from "../../lib/plan-cascade";
import { optionsResponsables, type PersonnePlan } from "../../lib/plan-elements";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";

export interface FormulairePorteurProps {
  planId: string;
  elementId: string;
  titre: string;
  porteurId: string | null;
  personnes: readonly PersonnePlan[];
}

/**
 * Porteur de la vision, d'un axe ou d'un objectif (PLA-12) : nouvelle version de la
 * désignation, « Non désigné » la retire. L'API refuse un porteur inconnu ou du portail.
 */
export function FormulairePorteur({
  planId,
  elementId,
  titre,
  porteurId,
  personnes,
}: FormulairePorteurProps) {
  const f = useFormulaire<"porteur_id">();
  const [valeur, setValeur] = useState(porteurId ?? "");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation: Resultat<{ porteur_id: string | null }, "porteur_id"> =
      valeur === (porteurId ?? "")
        ? { ok: false, erreurs: { porteur_id: "Choisissez un autre porteur." } }
        : { ok: true, charge: { porteur_id: valeur || null } };
    await f.envoyer(validation, (charge) => api.put(cheminPorteur(planId, elementId), charge), {
      succes: "Porteur enregistré.",
      messageSpecifique: messageCascade,
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Porteur de « ${titre} »`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Désignation refusée"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Porteur"
          options={optionsResponsables(personnes, porteurId)}
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          erreur={f.erreurs.porteur_id}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Désigner
        </Bouton>
      </div>
    </form>
  );
}
