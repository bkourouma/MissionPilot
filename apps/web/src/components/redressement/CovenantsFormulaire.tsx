"use client";

import { useState, type FormEvent } from "react";
import {
  RED_COVENANT_FREQUENCE_LIBELLES,
  RED_COVENANT_FREQUENCES,
  RED_COVENANT_OPERATEUR_LIBELLES,
  RED_COVENANT_OPERATEURS,
  RED_COVENANT_RATIO_LIBELLES,
  RED_COVENANT_RATIOS,
  RED_COVENANTS_PAR_VERSION_MAX,
  type RedCovenantFrequence,
  type RedCovenantOperateur,
  type RedCovenantRatio,
  type RedCovenantsVersionVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { messageRedressement } from "../../lib/redressement";
import { cheminVersionsCovenants } from "../../lib/redressement-financement";
import {
  corpsCovenantsDepuisFormulaire,
  covenantVide,
  saisieCovenantsDepuis,
  uniteSeuilCovenant,
  type ChampCovenants,
  type SaisieCovenant,
  type SaisieCovenants,
} from "../../lib/redressement-financement-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const options = <T extends string>(valeurs: readonly T[], libelles: Record<T, string>) =>
  valeurs.map((v) => ({ valeur: v, libelle: libelles[v] }));
const OPTIONS_RATIOS = options(RED_COVENANT_RATIOS, RED_COVENANT_RATIO_LIBELLES);
const OPTIONS_OPERATEURS = options(RED_COVENANT_OPERATEURS, RED_COVENANT_OPERATEUR_LIBELLES);
const OPTIONS_FREQUENCES = options(RED_COVENANT_FREQUENCES, RED_COVENANT_FREQUENCE_LIBELLES);

/**
 * Nouvelle version de covenants (0 à 12 lignes) : ajout seul, la version précédente reste dans
 * l'historique. Préremplie depuis la version courante. Les seuils se saisissent dans l'unité du
 * ratio (rapport ou pourcentage) ; l'évaluation est un constat arithmétique fait par l'API.
 */
export function CovenantsFormulaire({
  dossierId,
  version,
}: {
  dossierId: string;
  version: RedCovenantsVersionVue | null;
}) {
  const f = useFormulaire<ChampCovenants>();
  const [s, setS] = useState<SaisieCovenants>(() => saisieCovenantsDepuis(version));

  const maj = (cle: string, valeur: Partial<SaisieCovenant>) =>
    setS((x) => ({
      ...x,
      covenants: x.covenants.map((c) => (c.cle === cle ? { ...c, ...valeur } : c)),
    }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsCovenantsDepuisFormulaire(s),
      (charge) => api.post(cheminVersionsCovenants(dossierId), charge),
      {
        succes: "Nouvelle version de covenants enregistrée.",
        messageSpecifique: messageRedressement,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvelle version de covenants"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      {f.erreurs.covenants ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{f.erreurs.covenants}</p>
        </Alerte>
      ) : null}
      {s.covenants.length === 0 ? (
        <p className="mp-texte-doux">
          Aucun covenant : enregistrer cette version retire tous les covenants de l&apos;évaluation.
        </p>
      ) : (
        <ul className="mp-red-lignes">
          {s.covenants.map((c, i) => (
            <li key={c.cle} className="mp-red-ligne">
              <p className="mp-red-ligne__reference">Covenant {i + 1}</p>
              <Select
                libelle="Ratio"
                value={c.ratio}
                onChange={(e) => maj(c.cle, { ratio: e.target.value as RedCovenantRatio })}
                options={OPTIONS_RATIOS}
              />
              <Select
                libelle="Opérateur"
                value={c.operateur}
                onChange={(e) => maj(c.cle, { operateur: e.target.value as RedCovenantOperateur })}
                options={OPTIONS_OPERATEURS}
              />
              <Champ
                libelle="Seuil"
                inputMode="decimal"
                autoComplete="off"
                value={c.seuil}
                onChange={(e) => maj(c.cle, { seuil: e.target.value })}
                aide={`Unité : ${uniteSeuilCovenant(c.ratio)}.`}
              />
              <Select
                libelle="Fréquence"
                value={c.frequence}
                onChange={(e) => maj(c.cle, { frequence: e.target.value as RedCovenantFrequence })}
                options={OPTIONS_FREQUENCES}
              />
              <Champ
                libelle="Prêteur (facultatif)"
                maxLength={120}
                autoComplete="off"
                value={c.preteur}
                onChange={(e) => maj(c.cle, { preteur: e.target.value })}
              />
              <Bouton
                variante="discret"
                aria-label={`Retirer le covenant ${i + 1} (${RED_COVENANT_RATIO_LIBELLES[c.ratio]})`}
                onClick={() =>
                  setS((x) => ({ ...x, covenants: x.covenants.filter((y) => y.cle !== c.cle) }))
                }
              >
                Retirer
              </Bouton>
            </li>
          ))}
        </ul>
      )}
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          disabled={s.covenants.length >= RED_COVENANTS_PAR_VERSION_MAX}
          onClick={() => setS((x) => ({ ...x, covenants: [...x.covenants, covenantVide()] }))}
        >
          Ajouter un covenant
        </Bouton>
        <span className="mp-texte-doux mp-texte-petit">
          {s.covenants.length} sur {RED_COVENANTS_PAR_VERSION_MAX} au plus.
        </span>
      </div>
      <ZoneTexte
        libelle="Motif (facultatif)"
        maxLength={500}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la nouvelle version
        </Bouton>
      </div>
    </form>
  );
}
