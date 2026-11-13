"use client";

import { useState } from "react";
import { useT } from "../../../../../components/i18n/FournisseurLangue";
import { FormulaireDebours } from "../../../../../components/facturation/FormulaireDebours";
import { LigneDebours } from "../../../../../components/facturation/LigneDebours";
import { Bouton } from "../../../../../components/ui/Bouton";
import { saisieDeboursVide, type ContexteDebours, type Debours } from "../../../../../lib/debours";
import type { Devise } from "../../../../../lib/format";
import { aujourdhuiIso } from "../../../../../lib/missions";

/** Déclaration d'un débours sur cette mission (mission imposée). */
export function DeclarationDeboursMission({
  mission,
  ouverte,
}: {
  mission: { id: string; intitule: string; devise: Devise };
  ouverte: boolean;
}) {
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  if (!ouverte)
    return (
      <p className="mp-texte-doux">
        {t("Mission clôturée : plus de nouveau débours.", "Engagement closed: no new expenses.")}
      </p>
    );
  if (!ouvert) {
    return (
      <div>
        <Bouton icone="plus" onClick={() => setOuvert(true)}>
          {t("Déclarer un débours", "Declare an expense")}
        </Bouton>
      </div>
    );
  }
  return (
    <FormulaireDebours
      titre={t("Nouveau débours", "New expense")}
      initial={saisieDeboursVide(aujourdhuiIso())}
      missions={[mission]}
      onFin={() => setOuvert(false)}
    />
  );
}

export function ListeDeboursMission({
  liste,
  contexte,
  avecAuteur,
}: {
  liste: Debours[];
  contexte: ContexteDebours;
  avecAuteur: boolean;
}) {
  const t = useT();
  return (
    <ul className="mp-liste-lignes" aria-label={t("Débours de la mission", "Engagement expenses")}>
      {liste.map((d) => (
        <LigneDebours key={d.id} debours={d} contexte={contexte} avecAuteur={avecAuteur} />
      ))}
    </ul>
  );
}
