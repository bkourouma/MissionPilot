"use client";

import { useState, type FormEvent } from "react";
import type { RedCausesVersionVue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import { libelleDomaine } from "../../lib/redressement";
import {
  acquittementRequis,
  cartographieModifiable,
  cheminCartographie,
  cheminValidationCauses,
  corpsValidationCauses,
  libelleConfianceCause,
  libelleRangHistorique,
  messageDiagnostic,
  raisonValidationBloquee,
  TEXTE_CAUSES_GABARIT,
  TEXTE_CAUSES_GABARIT_AIDE,
  TEXTE_CAUSES_LECTURE_SEULE,
  validationProposee,
} from "../../lib/redressement-diagnostic";
import {
  corpsCauses,
  saisieCausesDepuis,
  type SaisieCause,
} from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeContenuIa } from "../ia/BadgeContenuIa";
import { BandeauChiffresNonVerifies } from "../ia/BandeauChiffresNonVerifies";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { CausesEditeur } from "./CausesEditeur";

/**
 * Une cartographie de causes racines : statut de contenu (brouillon IA, modifié, validé),
 * bandeau permanent « proposition de l'IA », repli sans IA, nombres non vérifiés à attester,
 * édition d'un brouillon, validation et historique des rangs. Une cartographie validée est en
 * lecture seule. Monter avec une `key` qui change quand la version change côté serveur.
 */
export function CausesCartographie({
  version: v,
  peutEcrire,
  peutValider,
}: {
  version: RedCausesVersionVue;
  peutEcrire: boolean;
  peutValider: boolean;
}) {
  const modifiable = cartographieModifiable(v, peutEcrire);
  const validable = validationProposee(v, peutValider);
  const [causes, setCauses] = useState<SaisieCause[]>(() => saisieCausesDepuis(v.causes));
  const [coche, setCoche] = useState(v.chiffres_acquittes);
  const enregistrement = useFormulaire<string>();
  const validation = useFormulaire<"acquittement">();
  const modifie = JSON.stringify(causes) !== JSON.stringify(saisieCausesDepuis(v.causes));
  const raison = raisonValidationBloquee(v, coche);

  async function enregistrer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await enregistrement.envoyer(
      corpsCauses(causes),
      (charge) => api.patch(cheminCartographie(v.id), charge),
      { succes: "Modifications enregistrées.", messageSpecifique: messageDiagnostic },
    );
  }

  async function valider() {
    await validation.envoyer(
      raison
        ? { ok: false as const, erreurs: { acquittement: raison } }
        : { ok: true as const, charge: corpsValidationCauses(v, coche) },
      (charge) => api.post(cheminValidationCauses(v.id), charge),
      { succes: "Cartographie validée.", messageSpecifique: messageDiagnostic },
    );
  }

  return (
    <div className="mp-red-carte-corps">
      <div className="mp-diag-meta">
        <strong>Version {v.version}</strong>
        <BadgeContenuIa statut={v.statut_contenu} />
        {v.gabarit ? (
          <span title={TEXTE_CAUSES_GABARIT_AIDE}>
            <BadgeStatut tonalite="neutre">{TEXTE_CAUSES_GABARIT}</BadgeStatut>
          </span>
        ) : null}
        <span className="mp-texte-doux">
          Proposée par {v.cree_par.nom}, le {formaterDateHeure(v.cree_le)}
        </span>
        {v.valide_par ? (
          <span className="mp-texte-doux">
            Validée par {v.valide_par.nom}, le {formaterDateHeure(v.valide_le)}
          </span>
        ) : null}
      </div>

      {v.gabarit ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>{TEXTE_CAUSES_GABARIT_AIDE}</p>
        </Alerte>
      ) : null}

      {v.chiffres_non_verifies && validable ? (
        <BandeauChiffresNonVerifies
          nombres={v.nombres_non_verifies}
          acquitte={coche}
          onAcquitteChange={setCoche}
          desactive={v.chiffres_acquittes}
          erreur={validation.erreurs.acquittement}
        />
      ) : v.chiffres_non_verifies ? (
        <Alerte tonalite="attention" annonce="aucune" titre="Nombres non vérifiés">
          <p>
            {acquittementRequis(v)
              ? "Des nombres de la proposition ne viennent pas d'un moteur de calcul : ils doivent être vérifiés avant la validation."
              : "Les nombres de la proposition ont été vérifiés et attestés."}
          </p>
        </Alerte>
      ) : null}

      {modifiable ? (
        <form
          ref={enregistrement.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={enregistrer}
          aria-label={`Modifier la cartographie, version ${v.version}`}
        >
          <RetourFormulaire
            erreur={enregistrement.erreurGlobale}
            succes={enregistrement.succes}
            refAlerte={enregistrement.refAlerte}
            titreErreur="Enregistrement impossible"
          />
          {enregistrement.erreurs.global ? (
            <Alerte tonalite="danger" annonce="alert">
              <p>{enregistrement.erreurs.global}</p>
            </Alerte>
          ) : null}
          <CausesEditeur causes={causes} onChange={setCauses} erreurs={enregistrement.erreurs} />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="secondaire"
              chargement={enregistrement.enCours}
              texteChargement="Enregistrement…"
              disabled={!modifie}
            >
              Enregistrer les modifications
            </Bouton>
            {!modifie ? (
              <span className="mp-texte-doux mp-texte-petit">
                Aucune modification à enregistrer.
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          <ul className="mp-diag-liste" aria-label={`Causes racines, version ${v.version}`}>
            {v.causes.map((c) => (
              <li key={c.id} className="mp-diag-cause">
                <div className="mp-diag-cause__entete">
                  <strong>{c.libelle}</strong>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleDomaine(c.domaine)}
                  </BadgeStatut>
                  <span className="mp-texte-doux mp-texte-petit">
                    {libelleConfianceCause(c.confiance)}
                  </span>
                </div>
                <p className="mp-diag-cause__texte">{c.description}</p>
              </li>
            ))}
          </ul>
          {v.statut === "valide" ? (
            <p className="mp-texte-doux">{TEXTE_CAUSES_LECTURE_SEULE}</p>
          ) : null}
        </>
      )}

      {validable ? (
        <div className="mp-pile">
          <RetourFormulaire
            erreur={validation.erreurGlobale}
            succes={validation.succes}
            refAlerte={validation.refAlerte}
            titreErreur="Validation impossible"
          />
          <div className="mp-actions-formulaire">
            <Bouton
              variante="primaire"
              chargement={validation.enCours}
              texteChargement="Validation…"
              disabled={modifie}
              onClick={() => void valider()}
            >
              Valider
            </Bouton>
            {modifie ? (
              <span className="mp-texte-doux mp-texte-petit">
                Enregistrez vos modifications avant de valider.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <details className="mp-diag-details">
        <summary>Historique ({v.historique.length})</summary>
        <ol className="mp-diag-historique" aria-label="Historique des rangs">
          {v.historique.map((r) => (
            <li key={r.rang}>
              {libelleRangHistorique(r)}, le {formaterDateHeure(r.cree_le)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
