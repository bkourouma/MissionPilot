"use client";

import { useState } from "react";
import { Bouton } from "../../../../components/ui/Bouton";
import type { OptionSelect } from "../../../../components/ui/Select";
import type { TacheCollaboration } from "../../../../lib/taches-collaboration";
import { FormulaireTache } from "../FormulaireTache";

/** Modification d'une tâche par son créateur (titre, description, assigné, échéance). */
export function EditionTache({
  tache,
  personnes,
}: {
  tache: TacheCollaboration;
  personnes: OptionSelect[];
}) {
  const [ouvert, setOuvert] = useState(false);
  if (!ouvert) {
    return (
      <div>
        <Bouton variante="secondaire" icone="crayon" onClick={() => setOuvert(true)}>
          Modifier la tâche
        </Bouton>
      </div>
    );
  }
  // L'assigné actuel reste proposé même s'il n'est plus dans la liste des collaborateurs.
  const options = personnes.some((p) => p.valeur === tache.assignee_id)
    ? personnes
    : [{ valeur: tache.assignee_id, libelle: tache.assignee_nom }, ...personnes];
  return (
    <FormulaireTache
      tache={tache}
      initial={{
        titre: tache.titre,
        description: tache.description ?? "",
        assignee_id: tache.assignee_id,
        echeance: tache.echeance ?? "",
        entite: "",
      }}
      personnes={options}
      entites={[]}
      onAnnuler={() => setOuvert(false)}
    />
  );
}
