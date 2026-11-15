"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const [motifOuvert, setMotifOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const base = `/api/temps/periodes/${encodeURIComponent(mois)}`;

  async function rouvrirPeriode(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerMotif(motif, langue), (c) => api.post(`${base}/rouvrir`, c), {
      succes: t(
        `${libelle} rouvert : la saisie et les corrections directes sont de nouveau possibles.`,
        `${libelle} reopened: entry and direct corrections are possible again.`,
      ),
      apres: () => setMotifOuvert(false),
    });
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action failed")}
      />
      {cloturer ? (
        <BoutonConfirmation
          libelle={t("Clôturer", "Close")}
          ariaLabel={t(`Clôturer ${libelle}`, `Close ${libelle}`)}
          icone="cadenas"
          question={t(
            `Clôturer ${libelle} ? Les temps du mois seront verrouillés ; toute modification passera par une correction tracée.`,
            `Close ${libelle}? The month's time entries will be locked; any change will go through a tracked correction.`,
          )}
          libelleConfirmation={t("Oui, clôturer", "Yes, close")}
          texteChargement={t("Clôture…", "Closing…")}
          action={() =>
            f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/cloturer`), {
              succes: t(`${libelle} clôturé.`, `${libelle} closed.`),
            })
          }
        />
      ) : null}
      {rouvrir && !motifOuvert ? (
        <div>
          <Bouton
            variante="secondaire"
            aria-label={t(`Rouvrir ${libelle}`, `Reopen ${libelle}`)}
            onClick={() => setMotifOuvert(true)}
          >
            {t("Rouvrir…", "Reopen…")}
          </Bouton>
        </div>
      ) : null}
      {rouvrir && motifOuvert ? (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={rouvrirPeriode}>
          <ZoneTexte
            libelle={t("Motif de la réouverture", "Reason for reopening")}
            required
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide={t(
              "La réouverture est journalisée avec son motif.",
              "The reopening is logged together with its reason.",
            )}
          />
          <div className="mp-barre-actions">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement={t("Réouverture…", "Reopening…")}
            >
              {t("Rouvrir la période", "Reopen the period")}
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={f.enCours}
              onClick={() => setMotifOuvert(false)}
            >
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
