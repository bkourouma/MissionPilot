"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import { validerMotif } from "../../../../lib/temps";

/** Clôture d'un mois (temps.cloturer) ou réouverture motivée (associé). */
export function ActionsPeriode({
  mois,
  libelle,
  cloturer,
  rouvrir,
}: {
  mois: string;
  libelle: string;
  cloturer: boolean;
  rouvrir: boolean;
}) {
  const [motifOuvert, setMotifOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const base = `/api/temps/periodes/${encodeURIComponent(mois)}`;

  async function rouvrirPeriode(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif), (c) => api.post(`${base}/rouvrir`, c), {
      succes: `${libelle} rouvert : la saisie et les corrections directes sont de nouveau possibles.`,
      apres: () => setMotifOuvert(false),
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {cloturer ? (
        <BoutonConfirmation
          libelle="Clôturer"
          ariaLabel={`Clôturer ${libelle}`}
          icone="cadenas"
          question={`Clôturer ${libelle} ? Les temps du mois seront verrouillés ; toute modification passera par une correction tracée.`}
          libelleConfirmation="Oui, clôturer"
          texteChargement="Clôture…"
          action={() =>
            f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/cloturer`), {
              succes: `${libelle} clôturé.`,
            })
          }
        />
      ) : null}
      {rouvrir && !motifOuvert ? (
        <div>
          <Bouton
            variante="secondaire"
            aria-label={`Rouvrir ${libelle}`}
            onClick={() => setMotifOuvert(true)}
          >
            Rouvrir…
          </Bouton>
        </div>
      ) : null}
      {rouvrir && motifOuvert ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={rouvrirPeriode}>
          <ZoneTexte
            libelle="Motif de la réouverture"
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide="La réouverture est journalisée avec son motif."
          />
          <div className="mp-barre-actions">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement="Réouverture…"
            >
              Rouvrir la période
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={f.enCours}
              onClick={() => setMotifOuvert(false)}
            >
              Annuler
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
