"use client";

import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { formaterDateHeure, type Devise } from "../../lib/format";
import {
  aideSaisieMontant,
  cheminRealise,
  LIBELLE_TRIMESTRE,
  messagePlanVivant,
  montantOuNonSaisi,
  saisieDepuisRealise,
  trimestresSaisissables,
  validerRealise,
  type ChampRealise,
  type GroupeRealise,
  type SaisieRealise,
} from "../../lib/plan-vivant";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";

export interface FormulaireRealisesProps {
  planId: string;
  exercice: number;
  devise: Devise;
  /** Réalisés déjà saisis de l'exercice, avec leur historique de versions. */
  realises: readonly GroupeRealise[];
}

/**
 * Saisie des réalisés trimestriels (PLA-18) : un formulaire par trimestre, dans l'ordre et sans trou
 * (le trimestre suivant n'apparaît qu'une fois le précédent saisi). Corriger un réalisé crée une
 * nouvelle version ; les anciennes restent lisibles. Montants en unités usuelles de la devise du plan.
 */
export function FormulaireRealises({
  planId,
  exercice,
  devise,
  realises,
}: FormulaireRealisesProps) {
  const t = useT();
  const trimestres = trimestresSaisissables(realises.map((g) => g.trimestre));
  return (
    <div className="mp-pv">
      <p className="mp-texte-doux">
        {t(
          "Saisissez les montants réalisés de chaque trimestre dans l'ordre. Le résultat net et la trésorerie de fin de trimestre sont facultatifs : sans eux, les projections qui en dépendent ne sont pas calculées.",
          "Enter the actual amounts for each quarter in order. Net income and quarter-end cash are optional: without them, the projections that depend on them are not computed.",
        )}
      </p>
      {trimestres.map((tri) => (
        <FormulaireTrimestre
          key={`${exercice}-${tri}`}
          planId={planId}
          exercice={exercice}
          devise={devise}
          trimestre={tri}
          groupe={realises.find((g) => g.trimestre === tri) ?? null}
        />
      ))}
    </div>
  );
}

function FormulaireTrimestre({
  planId,
  exercice,
  devise,
  trimestre,
  groupe,
}: {
  planId: string;
  exercice: number;
  devise: Devise;
  trimestre: number;
  groupe: GroupeRealise | null;
}) {
  const t = useT();
  const langue = useLangue();
  const libTrimestre = LIBELLE_TRIMESTRE(trimestre, langue);
  const { rafraichir, enAttente } = useRafraichir();
  const [s, setS] = useState<SaisieRealise>(() =>
    saisieDepuisRealise(groupe?.courant ?? null, devise),
  );
  const [erreurs, setErreurs] = useState<Partial<Record<ChampRealise, string>>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const refErreur = useRef<HTMLDivElement>(null);
  const p = `pv-${exercice}-${trimestre}`;
  const unite = devise === "XOF" || devise === "XAF" ? "FCFA" : devise;

  const champ = (nom: ChampRealise) => ({
    id: `${p}-${nom}`,
    value: s[nom],
    onChange: (e: { target: { value: string } }) => setS((x) => ({ ...x, [nom]: e.target.value })),
    erreur: erreurs[nom],
    inputMode: "decimal" as const,
  });

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setConfirmation("");
    const v = validerRealise(s, devise, langue);
    setErreurs(v.erreurs);
    if (!v.corps) {
      const premier = (Object.keys(v.erreurs) as ChampRealise[])[0];
      if (premier) document.getElementById(`${p}-${premier}`)?.focus();
      return;
    }
    setEnCours(true);
    try {
      const r = await api.put<{ version: number }>(
        cheminRealise(planId, exercice, trimestre),
        v.corps,
      );
      setConfirmation(
        langue === "en"
          ? `${libTrimestre} saved (version ${r.version}).`
          : `${libTrimestre} enregistré (version ${r.version}).`,
      );
      rafraichir();
    } catch (err) {
      setErreur(messagePlanVivant(err, langue));
      refErreur.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      onSubmit={enregistrer}
      noValidate
      aria-label={`${t("Réalisé du", "Actuals for")} ${libTrimestre.toLowerCase()}`}
    >
      <fieldset className="mp-pv__trimestre">
        <legend>{libTrimestre}</legend>
        {groupe ? (
          <p className="mp-texte-doux">
            {t("Version", "Version")} {groupe.courant.version} {t("saisie par", "entered by")}{" "}
            {groupe.courant.auteur_nom} {t("le", "on")}{" "}
            {formaterDateHeure(groupe.courant.cree_le, undefined, langue)}.{" "}
            {t(
              "Enregistrer une correction crée une nouvelle version.",
              "Saving a correction creates a new version.",
            )}
          </p>
        ) : null}
        {erreur ? (
          <Alerte ref={refErreur} tonalite="danger" titre={t("Réalisé refusé", "Actuals rejected")}>
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <div className="mp-grille-champs">
          <Champ
            libelle={`${t("Chiffre d'affaires réalisé", "Actual revenue")} (${unite})`}
            aide={aideSaisieMontant(devise, langue)}
            required
            {...champ("chiffre_affaires")}
          />
          <Champ
            libelle={`${t("EBE réalisé", "Actual EBITDA")} (${unite})`}
            aide={t(
              "Négatif en cas de perte d'exploitation.",
              "Negative in case of an operating loss.",
            )}
            required
            {...champ("ebe")}
          />
          <Champ
            libelle={`${t("Résultat net réalisé", "Actual net income")} (${unite}), ${t("facultatif", "optional")}`}
            {...champ("resultat_net")}
          />
          <Champ
            libelle={`${t("Trésorerie de fin de trimestre", "Quarter-end cash")} (${unite}), ${t("facultative", "optional")}`}
            {...champ("tresorerie_fin")}
          />
        </div>
        <ZoneTexte
          id={`${p}-commentaire`}
          libelle={t("Commentaire (facultatif)", "Comment (optional)")}
          aide={t(
            "Contexte utile à la lecture des écarts. Texte libre, 1 000 caractères au plus.",
            "Context useful for reading the variances. Free text, 1,000 characters at most.",
          )}
          value={s.commentaire}
          onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
          erreur={erreurs.commentaire}
          rows={2}
        />
        <div>
          <Bouton
            type="submit"
            chargement={enCours}
            texteChargement={t("Enregistrement…", "Saving…")}
          >
            {groupe
              ? `${t("Corriger le", "Correct")} ${libTrimestre.toLowerCase()}`
              : `${t("Enregistrer le", "Save")} ${libTrimestre.toLowerCase()}`}
          </Bouton>
        </div>
        <p className="mp-texte-doux" role="status">
          {confirmation}
        </p>
        {groupe && groupe.versions.length > 1 ? (
          <details>
            <summary>
              {t("Historique des versions", "Version history")} ({groupe.versions.length})
            </summary>
            <ul className="mp-pv__historique">
              {groupe.versions.map((v) => (
                <li key={v.id}>
                  {t("Version", "Version")} {v.version},{" "}
                  {formaterDateHeure(v.cree_le, undefined, langue)}, {v.auteur_nom} :{" "}
                  {t("chiffre d'affaires", "revenue")}{" "}
                  {montantOuNonSaisi(v.chiffre_affaires, devise, langue)}, EBE{" "}
                  {montantOuNonSaisi(v.ebe, devise, langue)}, {t("résultat net", "net income")}{" "}
                  {montantOuNonSaisi(v.resultat_net, devise, langue)}, {t("trésorerie", "cash")}{" "}
                  {montantOuNonSaisi(v.tresorerie_fin, devise, langue)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </fieldset>
    </form>
  );
}
