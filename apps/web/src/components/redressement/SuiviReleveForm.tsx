"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  RED_SUIVI_RATIOS,
  RED_SUIVI_SOURCES_RELEVE,
  type RedSuiviJalonVue,
  type RedSuiviSourceReleve,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminRelevesSuivi,
  libelleJalon,
  libelleRatioSuivi,
  libelleSourceReleve,
  messageSuivi,
  textesSuivi,
} from "../../lib/redressement-suivi";
import {
  corpsReleve,
  releveVide,
  type ChampReleve,
  type SaisieReleve,
} from "../../lib/redressement-suivi-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Enregistrement d'un relevé : indicateurs saisis (au moins un ratio) ou instantané des ratios du
 * dernier état accepté (calculé par le serveur). La comparaison à la clôture est faite par l'API.
 */
export function SuiviReleveForm({
  dossierId,
  jalons,
  jalonId,
  aujourdhui,
}: {
  dossierId: string;
  jalons: readonly Pick<RedSuiviJalonVue, "id" | "rang" | "libelle">[];
  /** Jalon préchoisi (formulaire placé dans la carte d'un jalon). */
  jalonId?: string;
  aujourdhui: string;
}) {
  const t = useT();
  const langue = useLangue();
  const tx = textesSuivi(langue);
  const f = useFormulaire<ChampReleve>();
  const [s, setS] = useState<SaisieReleve>(() => releveVide(aujourdhui, jalonId ?? ""));
  const verrou = useRef(false);
  const idErreurRatios = useId();

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verrou.current) return;
    verrou.current = true;
    try {
      await f.envoyer(
        corpsReleve(s, langue),
        (charge) => api.post(cheminRelevesSuivi(dossierId), charge),
        {
          succes: t("Relevé enregistré.", "Reading saved."),
          messageSpecifique: (e) => messageSuivi(e, langue),
          apres: () => setS((x) => ({ ...x, ratios: {}, commentaire: "" })),
        },
      );
    } finally {
      verrou.current = false;
    }
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Enregistrer un relevé", "Save a reading")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Relevé impossible", "Reading not possible")}
      />
      {jalonId ? null : (
        <Select
          libelle={t("Jalon", "Milestone")}
          invite={t("Choisir un jalon…", "Choose a milestone…")}
          value={s.jalon_id}
          onChange={(e) => setS({ ...s, jalon_id: e.target.value })}
          erreur={f.erreurs.jalon_id}
          options={jalons.map((j) => ({ valeur: j.id, libelle: libelleJalon(j, langue) }))}
          required
        />
      )}
      <Champ
        libelle={t("Date du relevé", "Reading date")}
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        value={s.date_releve}
        onChange={(e) => setS({ ...s, date_releve: e.target.value })}
        erreur={f.erreurs.date_releve}
        required
      />
      <Select
        libelle={t("Source du relevé", "Reading source")}
        value={s.source}
        onChange={(e) => setS({ ...s, source: e.target.value as RedSuiviSourceReleve })}
        options={RED_SUIVI_SOURCES_RELEVE.map((v) => ({
          valeur: v,
          libelle: libelleSourceReleve(v, langue),
        }))}
        aide={s.source === "saisie" ? tx.releveSaisie : tx.releveInstantane}
      />
      {s.source === "saisie" ? (
        <fieldset
          className="mp-sui-ratios"
          aria-describedby={f.erreurs.ratios ? idErreurRatios : undefined}
        >
          <legend className="mp-champ__libelle">{t("Ratios relevés", "Ratios read")}</legend>
          {f.erreurs.ratios ? (
            <p id={idErreurRatios} className="mp-champ__erreur" role="alert">
              {f.erreurs.ratios}
            </p>
          ) : null}
          {RED_SUIVI_RATIOS.map((r) => (
            <Champ
              key={r}
              libelle={libelleRatioSuivi(r, langue)}
              type="text"
              inputMode="decimal"
              value={s.ratios[r] ?? ""}
              onChange={(e) => setS({ ...s, ratios: { ...s.ratios, [r]: e.target.value } })}
              erreur={f.erreurs[`ratio.${r}`]}
            />
          ))}
        </fieldset>
      ) : null}
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
        value={s.commentaire}
        onChange={(e) => setS({ ...s, commentaire: e.target.value })}
        erreur={f.erreurs.commentaire}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le relevé", "Save the reading")}
        </Bouton>
      </div>
    </form>
  );
}
