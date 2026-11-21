"use client";

import { useState } from "react";
import {
  FormulaireDebours,
  type MissionDebours,
} from "../../../../components/facturation/FormulaireDebours";
import { useT } from "../../../../components/i18n/FournisseurLangue";
import { LigneDebours } from "../../../../components/facturation/LigneDebours";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { saisieDeboursVide, type Debours } from "../../../../lib/debours";
import { aujourdhuiIso } from "../../../../lib/missions";
import { aPermission, type Role } from "@missionpilot/shared";

/** Bouton puis formulaire de déclaration (mission à choisir). */
export function DeclarationDebours({ missions }: { missions: MissionDebours[] }) {
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  if (missions.length === 0) {
    return (
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre={t("Déclaration impossible pour l'instant", "Declaration not possible for now")}
      >
        <p>
          {t(
            "Aucune mission ouverte ne vous est accessible : un débours se déclare sur une mission dont vous faites partie.",
            "No open engagement is available to you: an expense is declared on an engagement you are part of.",
          )}
        </p>
      </Alerte>
    );
  }
  if (!ouvert) {
    return (
      <div>
        <Bouton icone="plus" onClick={() => setOuvert(true)}>
          {t("Nouvelle dépense", "New expense")}
        </Bouton>
      </div>
    );
  }
  return (
    <FormulaireDebours
      titre={t("Nouvelle dépense", "New expense")}
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
  const t = useT();
  const intitule = (id: string) =>
    missions.find((m) => m.id === id)?.intitule ?? t("Mission", "Engagement");
  // Avec « mission.lire », la liste des missions ouvertes est complète : une mission absente
  // est clôturée. Sinon (expert externe), l'API tranche à la soumission.
  const listeComplete = aPermission(roles, "mission.lire");
  return (
    <ul className="mp-liste-lignes" aria-label={t("Mes débours", "My expenses")}>
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
