"use client";

import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  return (
    <>
      <Bouton
        variante="discret"
        icone="flecheHaut"
        disabled={rang === 0}
        onClick={monter}
        aria-label={`${t("Monter", "Move up")} ${libelle}`}
      >
        {t("Monter", "Move up")}
      </Bouton>
      <Bouton
        variante="discret"
        icone="flecheBas"
        disabled={rang === total - 1}
        onClick={descendre}
        aria-label={`${t("Descendre", "Move down")} ${libelle}`}
      >
        {t("Descendre", "Move down")}
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
  const t = useT();
  const f = useFormulaire<never>();
  return (
    <>
      <BoutonConfirmation
        libelle={t("Supprimer", "Delete")}
        variante="discret"
        icone="corbeille"
        ariaLabel={`${t("Supprimer", "Delete")} ${libelle}`}
        question={question}
        libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
        texteChargement={t("Suppression…", "Deleting…")}
        action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
      />
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Suppression impossible", "Deletion not possible")}
      />
    </>
  );
}

export function TotalJours({ valeur }: { valeur: number | undefined }) {
  const t = useT();
  const langue = useLangue();
  if (valeur === undefined) return null;
  return (
    <span className="mp-total-jours">
      <span className="mp-visuellement-cache">{t("Budget : ", "Budget: ")}</span>
      {formaterJours(valeur, langue)}
    </span>
  );
}
