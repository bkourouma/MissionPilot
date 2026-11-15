"use client";

import { useState, type FormEvent } from "react";
import {
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  type RedTresorerieVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import {
  abregerSemaine,
  cheminRealises,
  formaterSemaine,
  libelleCategorieFlux,
  messageRedressement,
} from "../../lib/redressement";
import {
  corpsRealiseDepuisFormulaire,
  saisieRealiseVide,
  type ChampRealise,
  type SaisieRealise as Saisie,
} from "../../lib/redressement-saisie";
import { aideMontant } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Saisie du réalisé d'une semaine de la fenêtre : montants encaissés et décaissés par catégorie
 * (vides ignorés), solde bancaire constaté facultatif, commentaire. Une saisie remplace la ligne
 * courante de la même semaine (ajout seul, corrections tracées) ; l'écart avec le prévu est
 * calculé par l'API.
 */
export function SaisieRealise({
  dossierId,
  devise,
  semaines,
  semaineParDefaut,
}: {
  dossierId: string;
  devise: Devise;
  semaines: { semaine: number; debut: string; fin: string; corrections: number | null }[];
  semaineParDefaut: string;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampRealise>();
  const [s, setS] = useState<Saisie>(() => saisieRealiseVide(semaineParDefaut));
  const courante = semaines.find((x) => x.debut === s.semaine_debut);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsRealiseDepuisFormulaire(s, devise, langue),
      (charge) => api.post<RedTresorerieVue>(cheminRealises(dossierId), charge),
      {
        succes: t(
          "Réalisé enregistré : l'écart avec la prévision est recalculé.",
          "Actuals saved: the variance against the forecast is recomputed.",
        ),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Saisie du réalisé", "Actuals entry")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Saisie impossible", "Could not enter")}
      />
      <Select
        libelle={t("Semaine", "Week")}
        required
        value={s.semaine_debut}
        onChange={(e) => setS((x) => ({ ...x, semaine_debut: e.target.value }))}
        options={semaines.map((w) => ({
          valeur: w.debut,
          libelle: `${abregerSemaine(w.semaine, langue)} : ${formaterSemaine(w.debut, w.fin, langue)}`,
        }))}
        erreur={f.erreurs.semaine_debut}
        aide={
          courante && courante.corrections !== null && courante.corrections > 0
            ? t(
                `Cette semaine a déjà un réalisé (${courante.corrections} correction(s)) : la nouvelle saisie le remplace.`,
                `This week already has actuals (${courante.corrections} correction(s)): the new entry replaces them.`,
              )
            : t(
                "La semaine précédente doit avoir son réalisé avant celle-ci.",
                "The previous week must have its actuals before this one.",
              )
        }
      />
      <p className="mp-texte-doux">{aideMontant(devise, langue)}</p>
      <fieldset className="mp-red-fiche">
        <legend>{t("Encaissements réalisés", "Actual receipts")}</legend>
        {f.erreurs.encaissement ? (
          <p className="mp-champ__erreur">{f.erreurs.encaissement}</p>
        ) : null}
        <div className="mp-grille-champs">
          {RED_CATEGORIES_ENCAISSEMENT.map((c) => (
            <Champ
              key={c}
              libelle={libelleCategorieFlux(c, langue)}
              inputMode="decimal"
              autoComplete="off"
              value={s.encaissement[c] ?? ""}
              onChange={(e) =>
                setS((x) => ({ ...x, encaissement: { ...x.encaissement, [c]: e.target.value } }))
              }
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="mp-red-fiche">
        <legend>{t("Décaissements réalisés", "Actual disbursements")}</legend>
        {f.erreurs.decaissement ? (
          <p className="mp-champ__erreur">{f.erreurs.decaissement}</p>
        ) : null}
        <div className="mp-grille-champs">
          {RED_CATEGORIES_DECAISSEMENT.map((c) => (
            <Champ
              key={c}
              libelle={libelleCategorieFlux(c, langue)}
              inputMode="decimal"
              autoComplete="off"
              value={s.decaissement[c] ?? ""}
              onChange={(e) =>
                setS((x) => ({ ...x, decaissement: { ...x.decaissement, [c]: e.target.value } }))
              }
            />
          ))}
        </div>
      </fieldset>
      <Champ
        libelle={t(
          "Solde bancaire constaté en fin de semaine (facultatif)",
          "Recorded bank balance at the end of the week (optional)",
        )}
        inputMode="decimal"
        autoComplete="off"
        value={s.solde_constate}
        onChange={(e) => setS((x) => ({ ...x, solde_constate: e.target.value }))}
        erreur={f.erreurs.solde_constate}
        aide={t(
          "Quand il est renseigné, il remplace le solde prévu comme point de départ de la semaine suivante.",
          "When provided, it replaces the projected balance as the starting point of the following week.",
        )}
      />
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
        maxLength={1000}
        value={s.commentaire}
        onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le réalisé", "Save the actuals")}
        </Bouton>
      </div>
    </form>
  );
}
