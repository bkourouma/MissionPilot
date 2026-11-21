"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import {
  CONTROLE_LIBELLES,
  libelleControle,
  validerActivite,
  validerParametresTemps,
  type ParametresTemps,
} from "../../../../lib/temps-admin";
import type { ActiviteInterne } from "../../../../lib/temps";

export function FormulaireParametresTemps({ parametres }: { parametres: ParametresTemps }) {
  const t = useT();
  const langue = useLangue();
  const [saisie, setSaisie] = useState({
    controle_capacite: parametres.controle_capacite,
    seuil_consommation_pct: String(parametres.seuil_consommation_pct),
  });
  const f = useFormulaire<"controle_capacite" | "seuil_consommation_pct">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerParametresTemps(saisie, langue),
      (c) => api.patch("/api/temps/parametres", c),
      { succes: t("Paramètres des temps enregistrés.", "Time settings saved.") },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Paramètres de saisie des temps", "Time entry settings")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Journée au-delà de la capacité", "Day beyond capacity")}
          options={Object.keys(CONTROLE_LIBELLES).map((valeur) => ({
            valeur,
            libelle: libelleControle(valeur as ParametresTemps["controle_capacite"], langue),
          }))}
          value={saisie.controle_capacite}
          onChange={(e) =>
            setSaisie((s) => ({
              ...s,
              controle_capacite: e.target.value as ParametresTemps["controle_capacite"],
            }))
          }
          erreur={f.erreurs.controle_capacite}
        />
        <Champ
          libelle={t("Seuil d'alerte de consommation (%)", "Consumption alert threshold (%)")}
          inputMode="numeric"
          autoComplete="off"
          value={saisie.seuil_consommation_pct}
          onChange={(e) => setSaisie((s) => ({ ...s, seuil_consommation_pct: e.target.value }))}
          erreur={f.erreurs.seuil_consommation_pct}
          aide={t(
            "Le chef et le directeur de mission sont alertés quand le réalisé atteint ce pourcentage du budget (ex. 80).",
            "The engagement manager and director are alerted when actuals reach this percentage of the budget (e.g. 80).",
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
      </div>
    </form>
  );
}

export function AjoutActivite() {
  const t = useT();
  const langue = useLangue();
  const vide = { code: "", libelle: "", est_absence: false };
  const [saisie, setSaisie] = useState(vide);
  const f = useFormulaire<"code" | "libelle">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerActivite(saisie, langue),
      (c) => api.post("/api/activites-internes", c),
      {
        succes: t(
          `Activité « ${saisie.libelle.trim()} » ajoutée.`,
          `Activity "${saisie.libelle.trim()}" added.`,
        ),
        apres: () => setSaisie(vide),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-labelledby="titre-ajout-activite"
    >
      <h3 id="titre-ajout-activite" className="mp-sous-formulaire__titre">
        {t("Ajouter une activité interne", "Add an internal activity")}
      </h3>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Ajout impossible", "Could not add")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé", "Label")}
          required
          maxLength={120}
          value={saisie.libelle}
          onChange={(e) => setSaisie((s) => ({ ...s, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
          aide={t(
            "Ex. Formation, Prospection, Administration.",
            "E.g. Training, Business development, Administration.",
          )}
        />
        <Champ
          libelle={t("Code", "Code")}
          required
          maxLength={40}
          autoComplete="off"
          value={saisie.code}
          onChange={(e) => setSaisie((s) => ({ ...s, code: e.target.value }))}
          erreur={f.erreurs.code}
          aide={t(
            "Minuscules, chiffres et tiret bas (ex. prospection).",
            "Lowercase letters, digits and underscores (e.g. prospecting).",
          )}
        />
      </div>
      <CaseACocher
        libelle={t(
          "C'est une absence (congé, maladie…)",
          "This is an absence (leave, sick leave…)",
        )}
        aide={t(
          "Exclue du contrôle de capacité journalière.",
          "Excluded from the daily capacity check.",
        )}
        checked={saisie.est_absence}
        onChange={(e) => setSaisie((s) => ({ ...s, est_absence: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Ajout…", "Adding…")}
        >
          {t("Ajouter l'activité", "Add the activity")}
        </Bouton>
      </div>
    </form>
  );
}

export function BasculeActivite({ activite }: { activite: ActiviteInterne }) {
  const t = useT();
  const f = useFormulaire<never>();
  const actif = activite.actif !== false;
  return (
    <div className="mp-liste-lignes__actions">
      <Bouton
        variante="discret"
        icone={actif ? "fermer" : "succes"}
        chargement={f.enCours}
        texteChargement={t("Enregistrement…", "Saving…")}
        aria-label={t(
          `${actif ? "Désactiver" : "Réactiver"} l'activité ${activite.libelle}`,
          `${actif ? "Deactivate" : "Reactivate"} the activity ${activite.libelle}`,
        )}
        onClick={() =>
          f.envoyer(
            { ok: true, charge: { actif: !actif } },
            (c) => api.patch(`/api/activites-internes/${encodeURIComponent(activite.id)}`, c),
            {
              succes: actif
                ? t(
                    `Activité ${activite.libelle} désactivée.`,
                    `Activity ${activite.libelle} deactivated.`,
                  )
                : t(
                    `Activité ${activite.libelle} réactivée.`,
                    `Activity ${activite.libelle} reactivated.`,
                  ),
            },
          )
        }
      >
        {actif ? t("Désactiver", "Deactivate") : t("Réactiver", "Reactivate")}
      </Bouton>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Modification impossible", "Could not update")}
      />
    </div>
  );
}
