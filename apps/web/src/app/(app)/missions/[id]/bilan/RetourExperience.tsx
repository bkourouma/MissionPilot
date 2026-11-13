"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { Bouton } from "../../../../../components/ui/Bouton";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { api, ErreurApi } from "../../../../../lib/api";
import { validerRetourExperience } from "../../../../../lib/bilan";

const messageRetour = (e: unknown) =>
  e instanceof ErreurApi && (e.code === "DELAI_DEPASSE" || e.code === "INTERDIT")
    ? e.message
    : null;

/** Retour d'expérience : éditable 30 jours après la clôture (directeur ou associé). */
export function RetourExperience({
  missionId,
  texte,
  modifiable,
  raison,
  cle,
}: {
  missionId: string;
  texte: string | null;
  modifiable: boolean;
  raison: string | null;
  cle: string;
}) {
  const t = useT();
  const langue = useLangue();
  const [valeur, setValeur] = useState(texte ?? "");
  const form = useFormulaire<"texte">();
  const [attente, marquer] = useAttenteRafraichissement(cle);

  if (!modifiable) {
    return (
      <div className="mp-pile">
        {texte ? (
          <p className="mp-texte-preserve">{texte}</p>
        ) : (
          <p className="mp-texte-doux">
            {t(
              "Aucun retour d'expérience n'a été rédigé.",
              "No lessons learned have been written.",
            )}
          </p>
        )}
        {raison ? <p className="mp-texte-doux mp-texte-petit">{raison}</p> : null}
      </div>
    );
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerRetourExperience(valeur, langue),
      (c) => api.patch(`/api/missions/${encodeURIComponent(missionId)}/bilan/retour-experience`, c),
      {
        succes: t("Retour d'expérience enregistré.", "Lessons learned saved."),
        messageSpecifique: messageRetour,
        apres: marquer,
      },
    );
  }

  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Retour d'expérience", "Lessons learned")}
    >
      <RetourFormulaire
        erreur={form.erreurGlobale}
        succes={form.succes}
        refAlerte={form.refAlerte}
      />
      <ZoneTexte
        libelle={t("Retour d'expérience", "Lessons learned")}
        aide={t(
          "Ce qui a bien fonctionné, les écarts et leurs causes, ce qu'il faudra refaire ou éviter.",
          "What worked well, the variances and their causes, what to repeat or avoid.",
        )}
        required
        rows={8}
        maxLength={10_000}
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        erreur={form.erreurs.texte}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={form.enCours || attente}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
      </div>
    </form>
  );
}
