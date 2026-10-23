"use client";

import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { api } from "../../../../../lib/api";
import { formaterJours } from "../../../../../lib/format";

export function BoutonsOrdre({
  libelle,
  rang,
  total,
  monter,
  descendre,
}: {
  libelle: string;
  rang: number;
  total: number;
  monter: () => void;
  descendre: () => void;
}) {
  return (
    <>
      <Bouton
        variante="discret"
        icone="flecheHaut"
        disabled={rang === 0}
        onClick={monter}
        aria-label={`Monter ${libelle}`}
      >
        Monter
      </Bouton>
      <Bouton
        variante="discret"
        icone="flecheBas"
        disabled={rang === total - 1}
        onClick={descendre}
        aria-label={`Descendre ${libelle}`}
      >
        Descendre
      </Bouton>
    </>
  );
}

export function Suppression({
  libelle,
  chemin,
  question,
}: {
  libelle: string;
  chemin: string;
  question: string;
}) {
  const f = useFormulaire<never>();
  return (
    <>
      <BoutonConfirmation
        libelle="Supprimer"
        variante="discret"
        icone="corbeille"
        ariaLabel={`Supprimer ${libelle}`}
        question={question}
        libelleConfirmation="Oui, supprimer"
        texteChargement="Suppression…"
        action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
      />
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Suppression impossible"
      />
    </>
  );
}

export function TotalJours({ valeur }: { valeur: number | undefined }) {
  if (valeur === undefined) return null;
  return (
    <span className="mp-total-jours">
      <span className="mp-visuellement-cache">Budget : </span>
      {formaterJours(valeur)}
    </span>
  );
}
