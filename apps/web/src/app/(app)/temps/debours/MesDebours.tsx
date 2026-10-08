"use client";

import { useState } from "react";
import {
  FormulaireDebours,
  type MissionDebours,
} from "../../../../components/facturation/FormulaireDebours";
import { LigneDebours } from "../../../../components/facturation/LigneDebours";
import { Bouton } from "../../../../components/ui/Bouton";
import { saisieDeboursVide, type Debours } from "../../../../lib/debours";
import { aujourdhuiIso } from "../../../../lib/missions";
import { aPermission, type Role } from "@missionpilot/shared";

/** Bouton puis formulaire de déclaration (mission à choisir). */
export function DeclarationDebours({ missions }: { missions: MissionDebours[] }) {
  const [ouvert, setOuvert] = useState(false);
  if (missions.length === 0) {
    return (
      <p className="mp-texte-doux">
        Aucune mission ouverte ne vous est accessible : un débours se déclare sur une mission dont
        vous faites partie.
      </p>
    );
  }
  if (!ouvert) {
    return (
      <div>
        <Bouton icone="plus" onClick={() => setOuvert(true)}>
          Nouvelle dépense
        </Bouton>
      </div>
    );
  }
  return (
    <FormulaireDebours
      titre="Nouvelle dépense"
      initial={saisieDeboursVide(aujourdhuiIso())}
      missions={missions}
      onFin={() => setOuvert(false)}
    />
  );
}

/** Liste de ses propres débours (toutes missions), avec leurs actions. */
export function ListeMesDebours({
  liste,
  missions,
  utilisateurId,
  roles,
}: {
  liste: Debours[];
  missions: MissionDebours[];
  utilisateurId: string;
  roles: Role[];
}) {
  const intitule = (id: string) => missions.find((m) => m.id === id)?.intitule ?? "Mission";
  // Avec « mission.lire », la liste des missions ouvertes est complète : une mission absente
  // est clôturée. Sinon (expert externe), l'API tranche à la soumission.
  const listeComplete = aPermission(roles, "mission.lire");
  return (
    <ul className="mp-liste-lignes" aria-label="Mes débours">
      {liste.map((d) => (
        <LigneDebours
          key={d.id}
          debours={d}
          missionIntitule={intitule(d.mission_id)}
          contexte={{
            roles,
            utilisateurId,
            // La validation se fait depuis l'onglet Débours de la mission.
            chefId: null,
            directeurId: null,
            missionCloturee: listeComplete && !missions.some((m) => m.id === d.mission_id),
          }}
        />
      ))}
    </ul>
  );
}
