"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../../components/ui/Bouton";
import { Champ } from "../../../../../../components/ui/Champ";
import { api } from "../../../../../../lib/api";
import { messageNotation } from "../../../../../../lib/notation";
import { cheminPlansAction, validerCapacite } from "../../../../../../lib/notation-augmentee";

/**
 * Enregistre le plan d'action priorisé d'une version (NOT-17) : l'API recalcule la priorisation
 * par le moteur et fige le résultat (ajout seul). Seule la capacité du client est saisie ici.
 */
export function EnregistrerPlan({
  notationId,
  numero,
  capaciteInitiale,
}: {
  notationId: string;
  numero: number;
  capaciteInitiale: number;
}) {
  const f = useFormulaire<"capacite">();
  const [capacite, setCapacite] = useState(String(capaciteInitiale));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCapacite(capacite),
      (charge) => api.post(cheminPlansAction(notationId), { ...charge, version: numero }),
      {
        succes:
          "Plan d'action enregistré : la priorisation du moteur est figée pour cette version.",
        messageSpecifique: messageNotation,
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Plan non enregistré"
      />
      <Champ
        libelle="Capacité du client (somme des efforts, 1 à 100)"
        inputMode="numeric"
        required
        value={capacite}
        onChange={(e) => setCapacite(e.target.value)}
        erreur={f.erreurs.capacite}
      />
      <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
        Enregistrer le plan d&apos;action
      </Bouton>
    </form>
  );
}
