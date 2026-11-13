"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PUBLICS_ITEM_NOTATION, type ItemBanqueDonnees } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  AIDE_ANCRAGES_LONGUEUR_MAX,
  ANCRAGE_LONGUEUR_MAX,
  CHEMIN_BANQUE,
  FORMULATION_LONGUEUR_MAX,
  INTITULE_LONGUEUR_MAX,
  LIBELLE_NIVEAU_LONGUEUR_MAX,
  NIVEAUX_ITEM_MAX,
  NIVEAUX_ITEM_MIN,
  aideDepuisAncrages,
  cheminItemBanque,
  compteurCaracteres,
  hrefItemBanque,
  libellePublicItem,
  messageNotationAugmentee,
  saisieDepuisItem,
  saisieItemVide,
  validerSaisieItem,
  type ItemBanqueDetail,
  type SaisieItemBanque,
} from "../../lib/notation-augmentee";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import type { SuggestionDimension } from "./suggestions";

export interface FormulaireItemBanqueProps {
  /** Brouillon à modifier (PUT) ; `null` : nouvel item ou nouvelle version (POST). */
  itemId: string | null;
  /** Contenu enregistré qui préremplit le formulaire (et dont les exemples et l'étalonnage sont conservés). */
  base: ItemBanqueDonnees | null;
  /** Code, dimension et pratique d'une version ne changent pas : champs en lecture seule. */
  identifiantsFiges: boolean;
  suggestions: SuggestionDimension[];
  /** Avertissement affiché au-dessus du formulaire (ex. nouvelle version préremplie). */
  avertissement?: string | null;
}

/**
 * Rédaction d'un item de la banque en brouillon (NOT-09) : identification, échelle avec un
 * comportement observable (ancrage) par niveau, formulations par public, paramètres de sélection.
 * Les longueurs et formats sont contrôlés ici (confort) puis par le schéma partagé et le moteur de
 * l'API, dont les refus sont affichés en français. La validation par un expert métier est une
 * action distincte, sur la version enregistrée.
 */
export function FormulaireItemBanque({
  itemId,
  base,
  identifiantsFiges,
  suggestions,
  avertissement = null,
}: FormulaireItemBanqueProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [saisie, setSaisie] = useState<SaisieItemBanque>(() =>
    base ? saisieDepuisItem(base) : saisieItemVide(),
  );
  const maj = <K extends keyof SaisieItemBanque>(cle: K, valeur: SaisieItemBanque[K]) =>
    setSaisie((s) => ({ ...s, [cle]: valeur }));
  const majListe = (cle: "libelles" | "ancrages", rang: number, valeur: string) =>
    setSaisie((s) => ({ ...s, [cle]: s[cle].map((v, i) => (i === rang ? valeur : v)) }));

  const niveauxSaisis = Number(saisie.niveaux);
  const nombre =
    Number.isInteger(niveauxSaisis) &&
    niveauxSaisis >= NIVEAUX_ITEM_MIN &&
    niveauxSaisis <= NIVEAUX_ITEM_MAX
      ? niveauxSaisis
      : NIVEAUX_ITEM_MIN;
  const niveaux = Array.from({ length: nombre }, (_, i) => i + 1);
  const reuni = aideDepuisAncrages(
    niveaux.map((n) => ({ niveau: n, comportement: saisie.ancrages[n - 1]?.trim() ?? "" })),
  ).length;
  const dimensionConnue = suggestions.find((d) => d.id === saisie.dimension.trim());

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerSaisieItem(saisie, base, langue),
      (charge) =>
        itemId
          ? api.put<ItemBanqueDetail>(cheminItemBanque(itemId), charge)
          : api.post<ItemBanqueDetail>(CHEMIN_BANQUE, charge),
      {
        succes: itemId
          ? t(
              "Brouillon enregistré. Vous en êtes désormais le dernier modificateur : un autre expert métier devra le valider.",
              "Draft saved. You are now its last editor: another business expert will have to approve it.",
            )
          : t("Brouillon créé : ouverture de l'item.", "Draft created: opening the item."),
        messageSpecifique: (err) => messageNotationAugmentee(err, langue),
        rafraichir: itemId !== null,
        apres: (item) => {
          if (!itemId) router.push(hrefItemBanque(item.id));
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-na-formulaire"
      noValidate
      onSubmit={soumettre}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {avertissement ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{avertissement}</p>
        </Alerte>
      ) : null}

      <fieldset className="mp-na-groupe">
        <legend>{t("Identification", "Identification")}</legend>
        {identifiantsFiges ? (
          <p className="mp-na-groupe__aide">
            {t(
              "Le code, la dimension et la pratique ne changent pas d'une version à l'autre.",
              "The code, dimension and practice do not change from one version to the next.",
            )}
          </p>
        ) : (
          <p className="mp-na-groupe__aide">
            {t(
              "Identifiants en minuscules sans accent (lettres, chiffres, « _ », « . » ou « - »). La dimension et la pratique proposent celles de la grille générique, mais la saisie reste libre.",
              'Identifiers in lowercase without accents (letters, digits, "_", "." or "-"). Dimension and practice suggest those of the generic framework, but entry remains free.',
            )}
          </p>
        )}
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Code de l'item", "Item code")}
            required
            value={saisie.code}
            onChange={(e) => maj("code", e.target.value)}
            erreur={f.erreurs.code}
            readOnly={identifiantsFiges}
            maxLength={80}
            autoComplete="off"
            aide={t("Ex. pilotage_revue_mensuelle", "E.g. steering_monthly_review")}
          />
          <Champ
            libelle={t("Dimension", "Dimension")}
            required
            value={saisie.dimension}
            onChange={(e) => maj("dimension", e.target.value)}
            erreur={f.erreurs.dimension}
            readOnly={identifiantsFiges}
            maxLength={80}
            autoComplete="off"
            list="na-dimensions"
            aide={t("Ex. pilotage", "E.g. steering")}
          />
          <Champ
            libelle={t("Pratique évaluée", "Practice assessed")}
            required
            value={saisie.pratique}
            onChange={(e) => maj("pratique", e.target.value)}
            erreur={f.erreurs.pratique}
            readOnly={identifiantsFiges}
            maxLength={80}
            autoComplete="off"
            list="na-pratiques"
            aide={t(
              "Une seule question par pratique dans un questionnaire.",
              "One question per practice in a questionnaire.",
            )}
          />
        </div>
        <datalist id="na-dimensions">
          {suggestions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.libelle}
            </option>
          ))}
        </datalist>
        <datalist id="na-pratiques">
          {(dimensionConnue?.pratiques ?? []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <Champ
          libelle={t("Intitulé de la pratique (énoncé)", "Practice title (statement)")}
          required
          value={saisie.intitule}
          onChange={(e) => maj("intitule", e.target.value)}
          erreur={f.erreurs.intitule}
          maxLength={INTITULE_LONGUEUR_MAX + 50}
          aide={compteurCaracteres(saisie.intitule, INTITULE_LONGUEUR_MAX, langue)}
        />
      </fieldset>

      <fieldset className="mp-na-groupe">
        <legend>{t("Échelle et ancrages comportementaux", "Scale and behavioral anchors")}</legend>
        <p className="mp-na-groupe__aide">
          {t(
            "Chaque niveau est décrit par un comportement observable : deux évaluateurs doivent arriver au même niveau en lisant la même description.",
            "Each level is described by an observable behavior: two raters should reach the same level when reading the same description.",
          )}
        </p>
        <Select
          libelle={t("Nombre de niveaux", "Number of levels")}
          required
          value={saisie.niveaux}
          onChange={(e) => maj("niveaux", e.target.value)}
          erreur={f.erreurs.niveaux}
          options={Array.from({ length: NIVEAUX_ITEM_MAX - NIVEAUX_ITEM_MIN + 1 }, (_, i) => ({
            valeur: String(NIVEAUX_ITEM_MIN + i),
            libelle: String(NIVEAUX_ITEM_MIN + i),
          }))}
        />
        {niveaux.map((n) => (
          <div key={n} className="mp-na-niveau">
            <p className="mp-na-niveau__titre">
              {t("Niveau", "Level")} {n}
            </p>
            <Champ
              libelle={t(`Libellé du niveau ${n}`, `Label of level ${n}`)}
              required
              value={saisie.libelles[n - 1] ?? ""}
              onChange={(e) => majListe("libelles", n - 1, e.target.value)}
              erreur={f.erreurs[`libelle-${n}`]}
              maxLength={LIBELLE_NIVEAU_LONGUEUR_MAX + 30}
              aide={compteurCaracteres(
                saisie.libelles[n - 1] ?? "",
                LIBELLE_NIVEAU_LONGUEUR_MAX,
                langue,
              )}
            />
            <ZoneTexte
              libelle={t(
                `Comportement observable du niveau ${n}`,
                `Observable behavior of level ${n}`,
              )}
              required
              rows={3}
              value={saisie.ancrages[n - 1] ?? ""}
              onChange={(e) => majListe("ancrages", n - 1, e.target.value)}
              erreur={f.erreurs[`ancrage-${n}`] ?? (n === nombre ? f.erreurs.ancrages : undefined)}
              maxLength={ANCRAGE_LONGUEUR_MAX + 200}
              aide={compteurCaracteres(saisie.ancrages[n - 1] ?? "", ANCRAGE_LONGUEUR_MAX, langue)}
            />
          </div>
        ))}
        <p className="mp-na-aide" aria-live="polite">
          {t(
            `Ancrages réunis (aide de la question) : ${reuni} / ${AIDE_ANCRAGES_LONGUEUR_MAX} caractères.`,
            `Combined anchors (question help text): ${reuni} / ${AIDE_ANCRAGES_LONGUEUR_MAX} characters.`,
          )}
        </p>
      </fieldset>

      <fieldset className="mp-na-groupe">
        <legend>{t("Formulations par public", "Wordings by audience")}</legend>
        <p className="mp-na-groupe__aide">
          {t(
            "Une formulation par public visé ; à défaut, le questionnaire retient la formulation « Tous publics ». Laissez vide un public sans formulation propre. Au moins une est obligatoire.",
            'One wording per target audience; otherwise the questionnaire uses the "All audiences" wording. Leave an audience empty if it has no wording of its own. At least one is required.',
          )}
        </p>
        {PUBLICS_ITEM_NOTATION.map((p) => (
          <ZoneTexte
            key={p}
            libelle={libellePublicItem(p, langue)}
            rows={2}
            value={saisie.formulations[p]}
            onChange={(e) => maj("formulations", { ...saisie.formulations, [p]: e.target.value })}
            erreur={
              f.erreurs[`formulation-${p}`] ?? (p === "tous" ? f.erreurs.formulations : undefined)
            }
            maxLength={FORMULATION_LONGUEUR_MAX + 100}
            aide={compteurCaracteres(saisie.formulations[p], FORMULATION_LONGUEUR_MAX, langue)}
          />
        ))}
      </fieldset>

      <fieldset className="mp-na-groupe">
        <legend>{t("Sélection dans un questionnaire", "Selection in a questionnaire")}</legend>
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Poids", "Weight")}
            required
            inputMode="decimal"
            value={saisie.poids}
            onChange={(e) => maj("poids", e.target.value)}
            erreur={f.erreurs.poids}
            aide={t("Supérieur à 0, au plus 100.", "Greater than 0, at most 100.")}
          />
          <Champ
            libelle={t("Priorité", "Priority")}
            required
            inputMode="numeric"
            value={saisie.priorite}
            onChange={(e) => maj("priorite", e.target.value)}
            erreur={f.erreurs.priorite}
            aide={t("De 1 (cœur de la dimension) à 9.", "From 1 (core of the dimension) to 9.")}
          />
          <Champ
            libelle={t("Durée de réponse (secondes)", "Answer time (seconds)")}
            required
            inputMode="numeric"
            value={saisie.duree}
            onChange={(e) => maj("duree", e.target.value)}
            erreur={f.erreurs.duree}
            aide={t("De 5 à 600 secondes.", "From 5 to 600 seconds.")}
          />
        </div>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {itemId
            ? t("Enregistrer le brouillon", "Save draft")
            : t("Créer le brouillon", "Create draft")}
        </Bouton>
      </div>
    </form>
  );
}
