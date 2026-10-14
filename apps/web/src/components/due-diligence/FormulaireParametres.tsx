"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PARAMETRES_DIMENSIONNEMENT, type MethodeDimensionnement } from "@missionpilot/shared";
import { api, ErreurApi } from "../../lib/api";
import {
  cheminCalculDimensionnement,
  cheminDimensionnements,
  cheminVersionsDimensionnement,
  libelleParametre,
  messageDd,
  uniteParametre,
  type ParametreDimensionnement,
  type PreuveChoix,
  type ResultatDimensionnement,
  type ReponseEcriture,
} from "../../lib/due-diligence";
import {
  AJUSTEMENTS_MAX,
  MOTIF_MAX,
  saisieDepuisDimensionnement,
  saisieParametresVides,
  TITRE_MAX,
  validerDimensionnement,
  type ChampDimensionnement,
  type SaisieAjustement,
  type SaisieDimensionnement,
  type SaisieParametre,
} from "../../lib/due-diligence-saisie";
import { aideMontant } from "../../lib/saisie";
import type { Devise } from "../../lib/format";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ResultatMarche } from "./ResultatMarche";

const DELAI_APERCU_MS = 600;
const SOURCE_AVIS = "avis_expert";

export interface FormulaireParametresProps {
  dossierId: string;
  methode: MethodeDimensionnement;
  devise: Devise;
  /** Preuves de la mission, choisies par leur libellé (jamais un identifiant saisi). */
  preuves: PreuveChoix[];
  /** Message si les preuves n'ont pas pu être chargées (seul l'avis d'expert reste possible). */
  erreurPreuves: string | null;
  /** Présent : nouvelle version de ce dimensionnement (motif exigé). */
  dimensionnement?: {
    id: string;
    version: number;
    libelle: string;
    parametres: ParametreDimensionnement[];
    ajustements: { libelle: string; facteur_bp: number; motif: string }[];
  };
}

const tronquer = (t: string, max = 90) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

function aideUnite(code: ParametreDimensionnement["code"], devise: Devise): string {
  const unite = uniteParametre(code);
  if (unite === "pourcentage_bp") return "En % (de 0 à 100), par exemple 25,5.";
  if (unite === "montant") return `En ${devise}. ${aideMontant(devise)}`;
  return "Nombre entier.";
}

/**
 * Dimensionnement de marché (DD-12) : quatre paramètres par méthode, chacun avec une fourchette
 * (basse, centrale, haute) et sa source (une preuve de la mission, choisie par son libellé, ou un
 * avis d'expert motivé), plus des ajustements d'expert motivés. L'aperçu à chaque modification
 * vient du moteur (`POST /api/dd/dimensionnements/calculer`, sans écriture) : aucun calcul ici.
 */
export function FormulaireParametres({
  dossierId,
  methode,
  devise,
  preuves,
  erreurPreuves,
  dimensionnement,
}: FormulaireParametresProps) {
  const f = useFormulaire<ChampDimensionnement>();
  const version = dimensionnement !== undefined;
  const [s, setS] = useState<SaisieDimensionnement>(() =>
    dimensionnement
      ? saisieDepuisDimensionnement({ methode, ...dimensionnement }, devise)
      : {
          methode,
          libelle: "",
          parametres: saisieParametresVides(methode),
          ajustements: [],
          motif: "",
        },
  );
  const [apercu, setApercu] = useState<ResultatDimensionnement | null>(null);
  const [erreurApercu, setErreurApercu] = useState<string | null>(null);
  const [calcul, setCalcul] = useState(false);

  const optionsSource = useMemo(
    () => [
      { valeur: SOURCE_AVIS, libelle: "Avis d'expert (sans preuve)" },
      ...preuves.map((p) => ({
        valeur: p.id,
        libelle: tronquer(
          p.date_preuve ? `${p.source_precise} (${p.date_preuve})` : p.source_precise,
        ),
      })),
    ],
    [preuves],
  );

  // Aperçu du moteur, avec anti-rebond : seulement quand la saisie est lisible.
  useEffect(() => {
    const v = validerDimensionnement(s, devise, "apercu");
    if (!v.ok) {
      setApercu(null);
      setErreurApercu(null);
      setCalcul(false);
      return;
    }
    const ctrl = new AbortController();
    const minuterie = setTimeout(async () => {
      setCalcul(true);
      try {
        const r = await api.post<ResultatDimensionnement>(
          cheminCalculDimensionnement(),
          {
            methode: v.charge.methode,
            parametres: v.charge.parametres,
            ajustements: v.charge.ajustements,
          },
          { signal: ctrl.signal },
        );
        setApercu(r);
        setErreurApercu(null);
      } catch (e) {
        if (e instanceof ErreurApi && e.code === "ANNULE") return;
        setApercu(null);
        setErreurApercu(messageDd(e));
      } finally {
        if (!ctrl.signal.aborted) setCalcul(false);
      }
    }, DELAI_APERCU_MS);
    return () => {
      clearTimeout(minuterie);
      ctrl.abort();
    };
  }, [s, devise]);

  const majParametre = (code: string, partiel: Partial<SaisieParametre>) =>
    setS((x) => ({
      ...x,
      parametres: x.parametres.map((p) => (p.code === code ? { ...p, ...partiel } : p)),
    }));
  const majAjustement = (i: number, partiel: Partial<SaisieAjustement>) =>
    setS((x) => ({
      ...x,
      ajustements: x.ajustements.map((a, j) => (j === i ? { ...a, ...partiel } : a)),
    }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerDimensionnement(s, devise, version ? "version" : "creation"),
      (charge) =>
        dimensionnement
          ? api.post<ReponseEcriture>(cheminVersionsDimensionnement(dimensionnement.id), {
              libelle: charge.libelle,
              parametres: charge.parametres,
              ajustements: charge.ajustements,
              motif: charge.motif,
              version_courante: dimensionnement.version,
            })
          : api.post<ReponseEcriture>(cheminDimensionnements(dossierId), {
              methode: charge.methode,
              libelle: charge.libelle,
              parametres: charge.parametres,
              ajustements: charge.ajustements,
            }),
      {
        succes: version
          ? "Nouvelle version enregistrée ; l'ancienne reste dans l'historique."
          : "Dimensionnement enregistré.",
        messageSpecifique: messageDd,
        apres: () =>
          setS(
            version
              ? (x) => ({ ...x, motif: "" })
              : {
                  methode,
                  libelle: "",
                  parametres: saisieParametresVides(methode),
                  ajustements: [],
                  motif: "",
                },
          ),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={version ? "Nouvelle version du dimensionnement" : "Nouveau dimensionnement"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Dimensionnement refusé"
      />
      {erreurPreuves ? (
        <Alerte tonalite="attention" titre="Preuves indisponibles" annonce="aucune">
          <p>{`${erreurPreuves} Seul l'avis d'expert motivé est proposé comme source.`}</p>
        </Alerte>
      ) : null}
      <Champ
        libelle="Intitulé du dimensionnement"
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
        erreur={f.erreurs.libelle}
        aide="Par exemple « Marché du cacao transformé, hypothèse centrale »."
      />
      {f.erreurs.parametres ? (
        <Alerte tonalite="danger" titre="Paramètres à corriger" annonce="alert">
          <p>{f.erreurs.parametres}</p>
        </Alerte>
      ) : null}
      {PARAMETRES_DIMENSIONNEMENT[methode].map((def) => {
        const p = s.parametres.find((x) => x.code === def.code)!;
        const nom = libelleParametre(def.code);
        const valeurSource = p.source_type === "preuve" ? p.preuve_id : p.source_type;
        return (
          <fieldset key={def.code} className="mp-parametre">
            <legend>{nom}</legend>
            <p className="mp-texte-doux mp-texte-petit">{aideUnite(def.code, devise)}</p>
            <div className="mp-grille-champs mp-grille-champs--serree">
              <Champ
                libelle="Valeur basse"
                inputMode="decimal"
                value={p.bas}
                onChange={(e) => majParametre(def.code, { bas: e.target.value })}
              />
              <Champ
                libelle="Valeur centrale"
                inputMode="decimal"
                value={p.base}
                onChange={(e) => majParametre(def.code, { base: e.target.value })}
              />
              <Champ
                libelle="Valeur haute"
                inputMode="decimal"
                value={p.haut}
                onChange={(e) => majParametre(def.code, { haut: e.target.value })}
              />
            </div>
            <Select
              libelle="Source"
              invite="Choisir la source…"
              options={optionsSource}
              value={valeurSource}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") majParametre(def.code, { source_type: "", preuve_id: "" });
                else if (v === SOURCE_AVIS)
                  majParametre(def.code, { source_type: "avis_expert", preuve_id: "" });
                else
                  majParametre(def.code, { source_type: "preuve", preuve_id: v, avis_motif: "" });
              }}
              aide="Une preuve de la mission, ou un avis d'expert motivé."
            />
            {p.source_type === "avis_expert" ? (
              <ZoneTexte
                libelle={`Motif de l'avis d'expert : ${nom}`}
                rows={2}
                maxLength={MOTIF_MAX}
                value={p.avis_motif}
                onChange={(e) => majParametre(def.code, { avis_motif: e.target.value })}
                aide="10 caractères au moins."
              />
            ) : null}
          </fieldset>
        );
      })}

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Ajustements d&apos;expert (facultatifs)</legend>
        <p className="mp-champ__aide">
          Un facteur multiplicatif appliqué au résultat (90 % réduit de 10 %), motivé. Chaque
          ajustement est tracé dans l&apos;onglet « Ajustements ».
        </p>
        {f.erreurs.ajustements ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.ajustements}</p>
          </Alerte>
        ) : null}
        {s.ajustements.map((a, i) => (
          <div key={i} className="mp-ajustement">
            <Champ
              libelle="Libellé"
              maxLength={120}
              value={a.libelle}
              onChange={(e) => majAjustement(i, { libelle: e.target.value })}
            />
            <Champ
              libelle="Facteur (%)"
              inputMode="decimal"
              value={a.facteur}
              onChange={(e) => majAjustement(i, { facteur: e.target.value })}
              aide="De 0,01 à 200."
            />
            <ZoneTexte
              libelle="Motif"
              rows={2}
              value={a.motif}
              onChange={(e) => majAjustement(i, { motif: e.target.value })}
              aide="10 caractères au moins."
            />
            <Bouton
              variante="discret"
              onClick={() =>
                setS((x) => ({ ...x, ajustements: x.ajustements.filter((_, j) => j !== i) }))
              }
              aria-label={`Retirer l'ajustement ${i + 1}`}
            >
              Retirer
            </Bouton>
          </div>
        ))}
        {s.ajustements.length < AJUSTEMENTS_MAX ? (
          <div>
            <Bouton
              variante="secondaire"
              icone="plus"
              onClick={() =>
                setS((x) => ({
                  ...x,
                  ajustements: [...x.ajustements, { libelle: "", facteur: "", motif: "" }],
                }))
              }
            >
              Ajouter un ajustement
            </Bouton>
          </div>
        ) : null}
      </fieldset>

      <section className="mp-dd-pile" aria-labelledby={`apercu-${methode}`} aria-live="polite">
        <h4 id={`apercu-${methode}`} className="mp-sous-formulaire__titre">
          Aperçu du moteur
        </h4>
        {calcul ? <p className="mp-texte-doux">Calcul en cours…</p> : null}
        {erreurApercu ? (
          <Alerte tonalite="attention" titre="Aperçu indisponible" annonce="aucune">
            <p>{erreurApercu}</p>
          </Alerte>
        ) : null}
        {apercu ? (
          <ResultatMarche resultat={apercu} devise={devise} />
        ) : !erreurApercu && !calcul ? (
          <p className="mp-texte-doux">
            Renseignez les trois valeurs de chaque paramètre : le moteur calcule la fourchette, la
            sensibilité et la couverture des sources. Les sources sont facultatives pour
            l&apos;aperçu, exigées à l&apos;enregistrement.
          </p>
        ) : null}
      </section>

      {version ? (
        <ZoneTexte
          libelle="Motif de la correction"
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique des versions."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {version ? "Enregistrer la nouvelle version" : "Enregistrer le dimensionnement"}
        </Bouton>
      </div>
    </form>
  );
}
