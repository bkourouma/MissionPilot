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
  hrefKpi,
  hrefTableauKpi,
  messageKpi,
  NATURE_LIBELLES,
  PERSPECTIVE_LIBELLES,
  SENS_LIBELLES,
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
          { valeur: initial.proprietaire_id, libelle: "Propriétaire actuel (hors de l'équipe)" },
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
      const v = validerModificationKpi(s, initial, ctx);
      if (!v.ok && v.inchange) {
        setInchange(true);
        return;
      }
      await f.envoyer(v, (charge) => api.patch<DetailKpi>(cheminKpi(initial.id), charge), {
        messageSpecifique: messageKpi,
        rafraichir: false,
        apres: (r) => router.push(hrefKpi(missionId, r.id, { modifie: "1" })),
      });
      return;
    }
    await f.envoyer(
      validerCreationKpi(s, ctx),
      (charge) => api.post<DetailKpi>(cheminKpiMission(missionId), charge),
      {
        messageSpecifique: messageKpi,
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
      aria-label={creation ? "Définir un KPI" : `Modifier le KPI ${initial.libelle}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={creation ? "Création refusée" : "Modification refusée"}
      />
      {inchange ? (
        <Alerte tonalite="info" annonce="status">
          <p>Aucune modification à enregistrer.</p>
        </Alerte>
      ) : null}

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Identification</legend>
        <div className="mp-grille-champs">
          <Champ libelle="Libellé" required maxLength={LIBELLE_MAX} {...texte("libelle")} />
          <Champ
            libelle="Unité"
            required
            maxLength={UNITE_MAX}
            aide="Ex. FCFA, kFCFA, %, jours, clients."
            {...texte("unite")}
          />
          <Select
            libelle="Perspective"
            invite="Sans perspective"
            options={options(PERSPECTIVES_KPI, PERSPECTIVE_LIBELLES)}
            aide="Regroupement du tableau de bord prospectif."
            {...texte("perspective")}
          />
        </div>
        <ZoneTexte
          libelle="Description"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          aide="Définition, source et mode de calcul de la valeur saisie."
          {...texte("description")}
        />
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Lecture et périodicité</legend>
        {creation ? (
          <>
            <p className="mp-texte-doux">
              Ces quatre réglages sont figés une fois le KPI créé : ils déterminent le calcul de
              chaque période.
            </p>
            <div className="mp-grille-champs">
              <Select
                libelle="Sens de lecture"
                required
                options={options(SENS_LECTURE_KPI, SENS_LIBELLES)}
                {...texte("sens")}
              />
              <Select
                libelle="Nature"
                required
                options={options(NATURES_KPI, NATURE_LIBELLES)}
                {...texte("nature")}
              />
              <Select
                libelle="Fréquence de mesure"
                required
                options={options(FREQUENCES_KPI, FREQUENCE_LIBELLES)}
                {...texte("frequence")}
              />
              <Champ
                libelle="Début du suivi"
                type="date"
                required
                min={ilYaDixAns(aujourdhui)}
                aide={`Ramené au premier jour de sa période ; au plus 10 ans en arrière (pas avant le ${formaterDate(ilYaDixAns(aujourdhui))}).`}
                {...texte("debut_suivi")}
              />
            </div>
          </>
        ) : (
          <dl className="mp-liste-def">
            <div>
              <dt>Sens de lecture</dt>
              <dd>{SENS_LIBELLES[initial.sens]}</dd>
            </div>
            <div>
              <dt>Nature</dt>
              <dd>{NATURE_LIBELLES[initial.nature]}</dd>
            </div>
            <div>
              <dt>Fréquence</dt>
              <dd>{FREQUENCE_LIBELLES[initial.frequence]}</dd>
            </div>
            <div>
              <dt>Début du suivi</dt>
              <dd>{formaterDate(initial.debut_suivi)} (figé)</dd>
            </div>
          </dl>
        )}
        <div className="mp-grille-champs">
          <Champ
            libelle="Fin du suivi"
            type="date"
            aide="Facultative : après cette date, plus aucune mesure n'est attendue."
            {...texte("fin_suivi")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Cible et pondération</legend>
        <div className="mp-grille-champs">
          {creation ? (
            <Champ
              libelle="Cible initiale"
              inputMode="decimal"
              autoComplete="off"
              aide="Facultative ; 15 chiffres significatifs et 6 décimales au plus. Les cibles suivantes se versionnent depuis la fiche du KPI."
              {...texte("cible")}
            />
          ) : null}
          <Champ
            libelle="Pondération"
            required
            inputMode="decimal"
            autoComplete="off"
            aide="Poids dans le score composite (0 à 1 000 ; 0 : suivi sans effet sur le score)."
            {...texte("ponderation")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Seuils de statut (facultatifs)</legend>
        <p className="mp-texte-doux">
          En pourcentage d&apos;atteinte de la cible. Sans seuils propres : vert dès 95 %, orange de
          80 % à 95 %, rouge en dessous.
        </p>
        <div className="mp-grille-champs">
          <Champ
            libelle="Vert à partir de (%)"
            inputMode="decimal"
            autoComplete="off"
            {...texte("seuil_vert")}
          />
          <Champ
            libelle="Orange à partir de (%)"
            inputMode="decimal"
            autoComplete="off"
            aide="Inférieur au seuil vert."
            {...texte("seuil_orange")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Seuils d&apos;alerte (facultatifs)</legend>
        <div className="mp-grille-champs">
          <Champ
            libelle="Alerte si la valeur dépasse"
            inputMode="decimal"
            autoComplete="off"
            {...texte("alerte_haut")}
          />
          <Champ
            libelle="Alerte si la valeur passe sous"
            inputMode="decimal"
            autoComplete="off"
            {...texte("alerte_bas")}
          />
          <Champ
            libelle="Variation maximale d'une période à l'autre (%)"
            inputMode="decimal"
            autoComplete="off"
            aide="Ex. 20 : alerte si la valeur varie de plus de 20 % (à la hausse ou à la baisse)."
            {...texte("alerte_variation")}
          />
        </div>
      </fieldset>

      <fieldset className="mp-groupe-section">
        <legend className="mp-groupe-section__titre">Suivi</legend>
        <div className="mp-grille-champs">
          <Select
            libelle="Propriétaire"
            invite="Aucun propriétaire"
            options={choixProprietaires}
            aide="Reçoit les alertes et les rappels ; choisi parmi le directeur, le chef et l'équipe de la mission."
            {...texte("proprietaire_id")}
          />
        </div>
        <CaseACocher
          libelle="Rappels de saisie actifs pour ce KPI"
          aide="Rappels au propriétaire et aux contributeurs du client quand une mesure est en retard (si les rappels du cabinet sont actifs)."
          checked={s.rappels_actifs}
          onChange={(e) => maj("rappels_actifs", e.target.checked)}
        />
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {creation ? "Créer le KPI" : "Enregistrer les modifications"}
        </Bouton>
        <Link
          href={initial ? hrefKpi(missionId, initial.id) : hrefTableauKpi(missionId)}
          className={classesBouton("discret")}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
