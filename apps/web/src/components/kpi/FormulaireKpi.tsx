"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  FREQUENCES_KPI,
  NATURES_KPI,
  PERSPECTIVES_KPI,
  SENS_LECTURE_KPI,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import {
  FREQUENCE_LIBELLES,
  FREQUENCE_LIBELLES_EN,
  hrefKpi,
  hrefTableauKpi,
  libelleFrequence,
  libelleNature,
  libelleSens,
  messageKpi,
  NATURE_LIBELLES,
  NATURE_LIBELLES_EN,
  PERSPECTIVE_LIBELLES,
  PERSPECTIVE_LIBELLES_EN,
  SENS_LIBELLES,
  SENS_LIBELLES_EN,
  cheminKpi,
  cheminKpiMission,
  type DetailKpi,
  type OptionPersonne,
} from "../../lib/kpi";
import {
  DESCRIPTION_MAX,
  ilYaDixAns,
  LIBELLE_MAX,
  SAISIE_KPI_VIDE,
  saisieDepuisKpi,
  UNITE_MAX,
  validerCreationKpi,
  validerModificationKpi,
  type ChampKpi,
  type SaisieKpi,
} from "../../lib/kpi-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton, classesBouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireKpiProps {
  missionId: string;
  /** Absent : création ; présent : modification de ce KPI. */
  initial?: DetailKpi;
  proprietaires: readonly OptionPersonne[];
  aujourdhui: string;
}

const options = <T extends string>(liste: readonly T[], libelles: Record<T, string>) =>
  liste.map((v) => ({ valeur: v, libelle: libelles[v] }));

/**
 * Définition d'un KPI (KPI-01). En création : sens de lecture, nature, fréquence et début de
 * suivi (figés ensuite), cible initiale facultative. En modification : seuls les champs
 * changés partent ; les cibles se versionnent à part. Les seuils se saisissent en
 * pourcentage de la cible et sont transmis en fraction exacte.
 */
export function FormulaireKpi({
  missionId,
  initial,
  proprietaires,
  aujourdhui,
}: FormulaireKpiProps) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<ChampKpi>();
  const [s, setS] = useState<SaisieKpi>(() =>
    initial
      ? saisieDepuisKpi(initial)
      : { ...SAISIE_KPI_VIDE, debut_suivi: `${aujourdhui.slice(0, 8)}01` },
  );
  const [inchange, setInchange] = useState(false);
  const creation = !initial;
  // Propriétaire actuel sorti de l'équipe : gardé dans la liste pour ne pas l'effacer en silence.
  const choixProprietaires =
    initial?.proprietaire_id && !proprietaires.some((p) => p.valeur === initial.proprietaire_id)
      ? [
          ...proprietaires,
          {
            valeur: initial.proprietaire_id,
            libelle: t(
              "Propriétaire actuel (hors de l'équipe)",
              "Current owner (outside the team)",
            ),
          },
        ]
      : proprietaires;
  const maj = <K extends ChampKpi>(cle: K, v: SaisieKpi[K]) => {
    setInchange(false);
    setS((x) => ({ ...x, [cle]: v }));
  };
  const texte = (cle: Exclude<ChampKpi, "rappels_actifs">) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => maj(cle, e.target.value),
    erreur: f.erreurs[cle],
  });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ctx = { aujourdhui, proprietaires: proprietaires.map((p) => p.valeur) };
    if (initial) {
      const v = validerModificationKpi(s, initial, ctx, langue);
      if (!v.ok && v.inchange) {
        setInchange(true);
        return;
      }
      await f.envoyer(v, (charge) => api.patch<DetailKpi>(cheminKpi(initial.id), charge), {
        messageSpecifique: (e) => messageKpi(e, langue),
        rafraichir: false,
        apres: (r) => router.push(hrefKpi(missionId, r.id, { modifie: "1" })),
      });
      return;
    }
    await f.envoyer(
      validerCreationKpi(s, ctx, langue),
      (charge) => api.post<DetailKpi>(cheminKpiMission(missionId), charge),
      {
        messageSpecifique: (e) => messageKpi(e, langue),
        rafraichir: false,
        apres: (r) => router.push(hrefKpi(missionId, r.id, { cree: "1" })),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-kpi-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={
        creation
          ? t("Définir un KPI", "Define a KPI")
          : t(`Modifier le KPI ${initial.libelle}`, `Edit the KPI ${initial.libelle}`)
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={
          creation
            ? t("Création refusée", "Creation refused")
            : t("Modification refusée", "Edit refused")
        }
      />
      {inchange ? (
        <Alerte tonalite="info" annonce="status">
          <p>{t("Aucune modification à enregistrer.", "No change to save.")}</p>
        </Alerte>
      ) : null}

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">
          {t("Identification", "Identification")}
        </legend>
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Libellé", "Label")}
            required
            maxLength={LIBELLE_MAX}
            {...texte("libelle")}
          />
          <Champ
            libelle={t("Unité", "Unit")}
            required
            maxLength={UNITE_MAX}
            aide={t("Ex. FCFA, kFCFA, %, jours, clients.", "E.g. FCFA, kFCFA, %, days, clients.")}
            {...texte("unite")}
          />
          <Select
            libelle={t("Perspective", "Perspective")}
            invite={t("Sans perspective", "No perspective")}
            options={options(
              PERSPECTIVES_KPI,
              langue === "en" ? PERSPECTIVE_LIBELLES_EN : PERSPECTIVE_LIBELLES,
            )}
            aide={t(
              "Regroupement du tableau de bord prospectif.",
              "Grouping of the balanced scorecard.",
            )}
            {...texte("perspective")}
          />
        </div>
        <ZoneTexte
          libelle={t("Description", "Description")}
          rows={3}
          maxLength={DESCRIPTION_MAX}
          aide={t(
            "Définition, source et mode de calcul de la valeur saisie.",
            "Definition, source and calculation method of the entered value.",
          )}
          {...texte("description")}
        />
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">
          {t("Lecture et périodicité", "Reading and frequency")}
        </legend>
        {creation ? (
          <>
            <p className="mp-texte-doux">
              {t(
                "Ces quatre réglages sont figés une fois le KPI créé : ils déterminent le calcul de chaque période.",
                "These four settings are frozen once the KPI is created: they determine the calculation of each period.",
              )}
            </p>
            <div className="mp-grille-champs">
              <Select
                libelle={t("Sens de lecture", "Reading direction")}
                required
                options={options(
                  SENS_LECTURE_KPI,
                  langue === "en" ? SENS_LIBELLES_EN : SENS_LIBELLES,
                )}
                {...texte("sens")}
              />
              <Select
                libelle={t("Nature", "Type")}
                required
                options={options(
                  NATURES_KPI,
                  langue === "en" ? NATURE_LIBELLES_EN : NATURE_LIBELLES,
                )}
                {...texte("nature")}
              />
              <Select
                libelle={t("Fréquence de mesure", "Measurement frequency")}
                required
                options={options(
                  FREQUENCES_KPI,
                  langue === "en" ? FREQUENCE_LIBELLES_EN : FREQUENCE_LIBELLES,
                )}
                {...texte("frequence")}
              />
              <Champ
                libelle={t("Début du suivi", "Tracking start")}
                type="date"
                required
                min={ilYaDixAns(aujourdhui)}
                aide={t(
                  `Ramené au premier jour de sa période ; au plus 10 ans en arrière (pas avant le ${formaterDate(ilYaDixAns(aujourdhui), "UTC", langue)}).`,
                  `Moved back to the first day of its period; at most 10 years back (not before ${formaterDate(ilYaDixAns(aujourdhui), "UTC", langue)}).`,
                )}
                {...texte("debut_suivi")}
              />
            </div>
          </>
        ) : (
          <dl className="mp-liste-def">
            <div>
              <dt>{t("Sens de lecture", "Reading direction")}</dt>
              <dd>{libelleSens(initial.sens, langue)}</dd>
            </div>
            <div>
              <dt>{t("Nature", "Type")}</dt>
              <dd>{libelleNature(initial.nature, langue)}</dd>
            </div>
            <div>
              <dt>{t("Fréquence", "Frequency")}</dt>
              <dd>{libelleFrequence(initial.frequence, langue)}</dd>
            </div>
            <div>
              <dt>{t("Début du suivi", "Tracking start")}</dt>
              <dd>
                {formaterDate(initial.debut_suivi, "UTC", langue)} {t("(figé)", "(frozen)")}
              </dd>
            </div>
          </dl>
        )}
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Fin du suivi", "Tracking end")}
            type="date"
            aide={t(
              "Facultative : après cette date, plus aucune mesure n'est attendue.",
              "Optional: after this date, no more measurements are expected.",
            )}
            {...texte("fin_suivi")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">
          {t("Cible et pondération", "Target and weighting")}
        </legend>
        <div className="mp-grille-champs">
          {creation ? (
            <Champ
              libelle={t("Cible initiale", "Initial target")}
              inputMode="decimal"
              autoComplete="off"
              aide={t(
                "Facultative ; 15 chiffres significatifs et 6 décimales au plus. Les cibles suivantes se versionnent depuis la fiche du KPI.",
                "Optional; 15 significant digits and 6 decimals at most. Later targets are versioned from the KPI page.",
              )}
              {...texte("cible")}
            />
          ) : null}
          <Champ
            libelle={t("Pondération", "Weighting")}
            required
            inputMode="decimal"
            autoComplete="off"
            aide={t(
              "Poids dans le score composite (0 à 1 000 ; 0 : suivi sans effet sur le score).",
              "Weight in the composite score (0 to 1,000; 0: tracking with no effect on the score).",
            )}
            {...texte("ponderation")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">
          {t("Seuils de statut (facultatifs)", "Status thresholds (optional)")}
        </legend>
        <p className="mp-texte-doux">
          {t(
            "En pourcentage d'atteinte de la cible. Sans seuils propres : vert dès 95 %, orange de 80 % à 95 %, rouge en dessous.",
            "As a percentage of target attainment. Without own thresholds: green from 95%, orange from 80% to 95%, red below.",
          )}
        </p>
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Vert à partir de (%)", "Green from (%)")}
            inputMode="decimal"
            autoComplete="off"
            {...texte("seuil_vert")}
          />
          <Champ
            libelle={t("Orange à partir de (%)", "Orange from (%)")}
            inputMode="decimal"
            autoComplete="off"
            aide={t("Inférieur au seuil vert.", "Lower than the green threshold.")}
            {...texte("seuil_orange")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">
          {t("Seuils d'alerte (facultatifs)", "Alert thresholds (optional)")}
        </legend>
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Alerte si la valeur dépasse", "Alert if the value exceeds")}
            inputMode="decimal"
            autoComplete="off"
            {...texte("alerte_haut")}
          />
          <Champ
            libelle={t("Alerte si la valeur passe sous", "Alert if the value falls below")}
            inputMode="decimal"
            autoComplete="off"
            {...texte("alerte_bas")}
          />
          <Champ
            libelle={t(
              "Variation maximale d'une période à l'autre (%)",
              "Maximum change from one period to the next (%)",
            )}
            inputMode="decimal"
            autoComplete="off"
            aide={t(
              "Ex. 20 : alerte si la valeur varie de plus de 20 % (à la hausse ou à la baisse).",
              "E.g. 20: alert if the value changes by more than 20% (up or down).",
            )}
            {...texte("alerte_variation")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">{t("Suivi", "Follow-up")}</legend>
        <div className="mp-grille-champs">
          <Select
            libelle={t("Propriétaire", "Owner")}
            invite={t("Aucun propriétaire", "No owner")}
            options={choixProprietaires}
            aide={t(
              "Reçoit les alertes et les rappels ; choisi parmi le directeur, le chef et l'équipe de la mission.",
              "Receives alerts and reminders; chosen among the engagement director, manager and team.",
            )}
            {...texte("proprietaire_id")}
          />
        </div>
        <CaseACocher
          libelle={t(
            "Rappels de saisie actifs pour ce KPI",
            "Data entry reminders active for this KPI",
          )}
          aide={t(
            "Rappels au propriétaire et aux contributeurs du client quand une mesure est en retard (si les rappels du cabinet sont actifs).",
            "Reminders to the owner and the client's contributors when a measurement is overdue (if the firm's reminders are active).",
          )}
          checked={s.rappels_actifs}
          onChange={(e) => maj("rappels_actifs", e.target.checked)}
        />
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {creation
            ? t("Créer le KPI", "Create the KPI")
            : t("Enregistrer les modifications", "Save changes")}
        </Bouton>
        <Link
          href={initial ? hrefKpi(missionId, initial.id) : hrefTableauKpi(missionId)}
          className={classesBouton("discret")}
        >
          {t("Annuler", "Cancel")}
        </Link>
      </div>
    </form>
  );
}
