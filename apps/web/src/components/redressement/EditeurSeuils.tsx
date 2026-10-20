"use client";

import { useState, type FormEvent } from "react";
import {
  RED_CRITERES_ALERTE,
  RED_CRITERE_ALERTE_SENS,
  type RedSecteur,
  type RedSeuils,
  type RedSeuilsVersionVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  CHEMIN_SEUILS_RED,
  libelleCritere,
  libelleSensCritere,
  messageRedressement,
  uniteCritere,
} from "../../lib/redressement";
import {
  corpsSeuilsDepuisFormulaire,
  saisieSeuilsDepuis,
  sommeDesPoids,
  type ChampSeuils,
  type SaisieSeuils,
} from "../../lib/redressement-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Éditeur de seuils d'alerte d'un secteur (droit « paramétrer »). Part de la version en vigueur
 * ou des valeurs par défaut du moteur ; les rapports sont saisis en rapport (1,20), les marges en
 * pourcentage. La somme des poids doit valoir 100 (contrôle de saisie : l'API revalide tout).
 * « Enregistrer un brouillon » ne change aucun score : la publication est une étape séparée.
 */
export function EditeurSeuils({ secteur, depart }: { secteur: RedSecteur; depart: RedSeuils }) {
  const f = useFormulaire<ChampSeuils>();
  const [s, setS] = useState<SaisieSeuils>(() => saisieSeuilsDepuis(depart));
  const somme = sommeDesPoids(s.criteres);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsSeuilsDepuisFormulaire(secteur, s),
      (charge) => api.post<RedSeuilsVersionVue>(CHEMIN_SEUILS_RED, charge),
      {
        succes: "Brouillon enregistré : publiez-le depuis la liste des versions.",
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
      aria-label="Rédiger un brouillon de seuils"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <div className="mp-red-seuils">
        {RED_CRITERES_ALERTE.map((c) => (
          <fieldset key={c} className="mp-red-seuil">
            <legend className="mp-red-seuil__titre">{libelleCritere(c)}</legend>
            <p className="mp-texte-doux mp-texte-petit">
              {libelleSensCritere(RED_CRITERE_ALERTE_SENS[c])}. Unité : {uniteCritere(c)}.
            </p>
            <div className="mp-grille-champs mp-grille-champs--serree">
              <Champ
                libelle="Seuil orange"
                inputMode="decimal"
                autoComplete="off"
                value={s.criteres[c].orange}
                onChange={(e) =>
                  setS((x) => ({
                    ...x,
                    criteres: { ...x.criteres, [c]: { ...x.criteres[c], orange: e.target.value } },
                  }))
                }
                erreur={f.erreurs[`${c}.orange`]}
              />
              <Champ
                libelle="Seuil rouge"
                inputMode="decimal"
                autoComplete="off"
                value={s.criteres[c].rouge}
                onChange={(e) =>
                  setS((x) => ({
                    ...x,
                    criteres: { ...x.criteres, [c]: { ...x.criteres[c], rouge: e.target.value } },
                  }))
                }
                erreur={f.erreurs[`${c}.rouge`]}
              />
              <Champ
                libelle="Poids"
                inputMode="numeric"
                autoComplete="off"
                value={s.criteres[c].poids}
                onChange={(e) =>
                  setS((x) => ({
                    ...x,
                    criteres: { ...x.criteres, [c]: { ...x.criteres[c], poids: e.target.value } },
                  }))
                }
                erreur={f.erreurs[`${c}.poids`]}
              />
            </div>
          </fieldset>
        ))}
      </div>

      <p role="status" aria-live="polite" className={somme === 100 ? "mp-texte-doux" : undefined}>
        Somme des poids : {somme} sur 100
        {somme === 100 ? "" : " : à corriger avant l'enregistrement"}.
      </p>
      {f.erreurs.poids ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{f.erreurs.poids}</p>
        </Alerte>
      ) : null}

      <div className="mp-grille-champs">
        <Champ
          libelle="Niveau « Modéré » à partir de (sur 100)"
          inputMode="numeric"
          autoComplete="off"
          value={s.niveaux.modere}
          onChange={(e) =>
            setS((x) => ({ ...x, niveaux: { ...x.niveaux, modere: e.target.value } }))
          }
        />
        <Champ
          libelle="Niveau « Élevé » à partir de (sur 100)"
          inputMode="numeric"
          autoComplete="off"
          value={s.niveaux.eleve}
          onChange={(e) =>
            setS((x) => ({ ...x, niveaux: { ...x.niveaux, eleve: e.target.value } }))
          }
        />
        <Champ
          libelle="Niveau « Critique » à partir de (sur 100)"
          inputMode="numeric"
          autoComplete="off"
          value={s.niveaux.critique}
          onChange={(e) =>
            setS((x) => ({ ...x, niveaux: { ...x.niveaux, critique: e.target.value } }))
          }
          erreur={f.erreurs.niveaux}
        />
        <Champ
          libelle="Part minimale de poids évalué (%)"
          inputMode="numeric"
          autoComplete="off"
          value={s.part_minimale_evaluee_pct}
          onChange={(e) => setS((x) => ({ ...x, part_minimale_evaluee_pct: e.target.value }))}
          erreur={f.erreurs.part}
          aide="Sous cette part de poids évalué, le score est « Données insuffisantes »."
        />
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
          Enregistrer un brouillon
        </Bouton>
      </div>
    </form>
  );
}
