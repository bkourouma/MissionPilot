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
  const trimestres = trimestresSaisissables(realises.map((g) => g.trimestre));
  return (
    <div className="mp-pv">
      <p className="mp-texte-doux">
        Saisissez les montants réalisés de chaque trimestre dans l&apos;ordre. Le résultat net et la
        trésorerie de fin de trimestre sont facultatifs : sans eux, les projections qui en dépendent
        ne sont pas calculées.
      </p>
      {trimestres.map((t) => (
        <FormulaireTrimestre
          key={`${exercice}-${t}`}
          planId={planId}
          exercice={exercice}
          devise={devise}
          trimestre={t}
          groupe={realises.find((g) => g.trimestre === t) ?? null}
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
    const v = validerRealise(s, devise);
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
      setConfirmation(`${LIBELLE_TRIMESTRE(trimestre)} enregistré (version ${r.version}).`);
      rafraichir();
    } catch (err) {
      setErreur(messagePlanVivant(err));
      refErreur.current?.focus();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      onSubmit={enregistrer}
      noValidate
      aria-label={`Réalisé du ${LIBELLE_TRIMESTRE(trimestre).toLowerCase()}`}
    >
      <fieldset className="mp-pv__trimestre">
        <legend>{LIBELLE_TRIMESTRE(trimestre)}</legend>
        {groupe ? (
          <p className="mp-texte-doux">
            Version {groupe.courant.version} saisie par {groupe.courant.auteur_nom} le{" "}
            {formaterDateHeure(groupe.courant.cree_le)}. Enregistrer une correction crée une
            nouvelle version.
          </p>
        ) : null}
        {erreur ? (
          <Alerte ref={refErreur} tonalite="danger" titre="Réalisé refusé">
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        <div className="mp-grille-champs">
          <Champ
            libelle={`Chiffre d'affaires réalisé (${unite})`}
            aide={aideSaisieMontant(devise)}
            required
            {...champ("chiffre_affaires")}
          />
          <Champ
            libelle={`EBE réalisé (${unite})`}
            aide="Négatif en cas de perte d'exploitation."
            required
            {...champ("ebe")}
          />
          <Champ
            libelle={`Résultat net réalisé (${unite}), facultatif`}
            {...champ("resultat_net")}
          />
          <Champ
            libelle={`Trésorerie de fin de trimestre (${unite}), facultative`}
            {...champ("tresorerie_fin")}
          />
        </div>
        <ZoneTexte
          id={`${p}-commentaire`}
          libelle="Commentaire (facultatif)"
          aide="Contexte utile à la lecture des écarts. Texte libre, 1 000 caractères au plus."
          value={s.commentaire}
          onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
          erreur={erreurs.commentaire}
          rows={2}
        />
        <div>
          <Bouton type="submit" chargement={enCours} texteChargement="Enregistrement…">
            {groupe
              ? `Corriger le ${LIBELLE_TRIMESTRE(trimestre).toLowerCase()}`
              : `Enregistrer le ${LIBELLE_TRIMESTRE(trimestre).toLowerCase()}`}
          </Bouton>
        </div>
        <p className="mp-texte-doux" role="status">
          {confirmation}
        </p>
        {groupe && groupe.versions.length > 1 ? (
          <details>
            <summary>Historique des versions ({groupe.versions.length})</summary>
            <ul className="mp-pv__historique">
              {groupe.versions.map((v) => (
                <li key={v.id}>
                  Version {v.version}, {formaterDateHeure(v.cree_le)}, {v.auteur_nom} : chiffre
                  d&apos;affaires {montantOuNonSaisi(v.chiffre_affaires, devise)}, EBE{" "}
                  {montantOuNonSaisi(v.ebe, devise)}, résultat net{" "}
                  {montantOuNonSaisi(v.resultat_net, devise)}, trésorerie{" "}
                  {montantOuNonSaisi(v.tresorerie_fin, devise)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </fieldset>
    </form>
  );
}
