"use client";

import { BoutonActionAo, seg } from "./ActionsAoBouton";
import { useState } from "react";
import { api } from "../../lib/api";
import { type EtapeAo } from "../../lib/appels-offres";
import { optionsPersonnes, type Personne } from "../../lib/personnes";
import { Select } from "../ui/Select";

/** Étape du rétro-planning : fait / à refaire, et confier par une tâche assignée. */
export function ActionsEtapeAo({
  etape,
  personnes,
  peutAssigner,
}: {
  etape: EtapeAo;
  personnes: readonly Personne[];
  peutAssigner: boolean;
}) {
  const [assignee, setAssignee] = useState(personnes[0]?.utilisateur_id ?? "");
  const url = `/api/appels-offres/retroplanning/${seg(etape.id)}`;
  return (
    <div className="mp-ao__actions">
      <BoutonActionAo action={() => api.patch(url, { faite: !etape.faite })}>
        {etape.faite ? "Rouvrir" : "Marquer faite"}
      </BoutonActionAo>
      {peutAssigner && !etape.tache_id && personnes.length > 0 ? (
        <>
          <Select
            libelle="Confier à"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={optionsPersonnes(personnes)}
          />
          <BoutonActionAo action={() => api.post(`${url}/tache`, { assignee_id: assignee })}>
            Créer la tâche
          </BoutonActionAo>
        </>
      ) : null}
      {peutAssigner && !etape.tache_id && personnes.length === 0 ? (
        <p className="mp-texte-doux mp-texte-petit">
          Aucune personne à qui confier cette étape : seules les personnes ayant accès aux appels
          d&apos;offres peuvent recevoir la tâche.
        </p>
      ) : null}
    </div>
  );
}
