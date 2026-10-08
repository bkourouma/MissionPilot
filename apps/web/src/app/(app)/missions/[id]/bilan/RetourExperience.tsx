"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
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
  const [valeur, setValeur] = useState(texte ?? "");
  const form = useFormulaire<"texte">();
  const [attente, marquer] = useAttenteRafraichissement(cle);

  if (!modifiable) {
    return (
      <div className="mp-pile">
        {texte ? (
          <p className="mp-texte-preserve">{texte}</p>
        ) : (
          <p className="mp-texte-doux">Aucun retour d&apos;expérience n&apos;a été rédigé.</p>
        )}
        {raison ? <p className="mp-texte-doux mp-texte-petit">{raison}</p> : null}
      </div>
    );
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerRetourExperience(valeur),
      (c) => api.patch(`/api/missions/${encodeURIComponent(missionId)}/bilan/retour-experience`, c),
      {
        succes: "Retour d'expérience enregistré.",
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
      aria-label="Retour d'expérience"
    >
      <RetourFormulaire
        erreur={form.erreurGlobale}
        succes={form.succes}
        refAlerte={form.refAlerte}
      />
      <ZoneTexte
        libelle="Retour d'expérience"
        aide="Ce qui a bien fonctionné, les écarts et leurs causes, ce qu'il faudra refaire ou éviter."
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
          texteChargement="Enregistrement…"
        >
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}
