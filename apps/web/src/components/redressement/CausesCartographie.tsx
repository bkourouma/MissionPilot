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
  TEXTE_CAUSES_GABARIT_AIDE_EN,
  TEXTE_CAUSES_GABARIT_EN,
  TEXTE_CAUSES_LECTURE_SEULE,
  TEXTE_CAUSES_LECTURE_SEULE_EN,
  validationProposee,
} from "../../lib/redressement-diagnostic";
import {
  corpsCauses,
  saisieCausesDepuis,
  type SaisieCause,
} from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  raisonValidation = null,
}: {
  version: RedCausesVersionVue;
  peutEcrire: boolean;
  peutValider: boolean;
  /** Valider est affiché mais désactivé : explication visible (séparation des tâches). */
  raisonValidation?: string | null;
}) {
  const t = useT();
  const langue = useLangue();
  const modifiable = cartographieModifiable(v, peutEcrire);
  const validable = validationProposee(v, peutValider);
  const [causes, setCauses] = useState<SaisieCause[]>(() => saisieCausesDepuis(v.causes));
  const [coche, setCoche] = useState(v.chiffres_acquittes);
  const enregistrement = useFormulaire<string>();
  const validation = useFormulaire<"acquittement">();
  const modifie = JSON.stringify(causes) !== JSON.stringify(saisieCausesDepuis(v.causes));
  const raison = raisonValidationBloquee(v, coche, langue);
  const aideGabarit = t(TEXTE_CAUSES_GABARIT_AIDE, TEXTE_CAUSES_GABARIT_AIDE_EN);

  async function enregistrer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await enregistrement.envoyer(
      corpsCauses(causes, langue),
      (charge) => api.patch(cheminCartographie(v.id), charge),
      {
        succes: t("Modifications enregistrées.", "Changes saved."),
        messageSpecifique: (e) => messageDiagnostic(e, langue),
      },
    );
  }

  async function valider() {
    await validation.envoyer(
      raison
        ? { ok: false as const, erreurs: { acquittement: raison } }
        : { ok: true as const, charge: corpsValidationCauses(v, coche) },
      (charge) => api.post(cheminValidationCauses(v.id), charge),
      {
        succes: t("Cartographie validée.", "Map approved."),
        messageSpecifique: (e) => messageDiagnostic(e, langue),
      },
    );
  }

  return (
    <div className="mp-red-carte-corps">
      <div className="mp-diag-meta">
        <strong>Version {v.version}</strong>
        <BadgeContenuIa statut={v.statut_contenu} />
        {v.gabarit ? (
          <span title={aideGabarit}>
            <BadgeStatut tonalite="neutre">
              {t(TEXTE_CAUSES_GABARIT, TEXTE_CAUSES_GABARIT_EN)}
            </BadgeStatut>
          </span>
        ) : null}
        <span className="mp-texte-doux">
          {t(
            `Proposée par ${v.cree_par.nom}, le ${formaterDateHeure(v.cree_le)}`,
            `Proposed by ${v.cree_par.nom}, on ${formaterDateHeure(v.cree_le, undefined, langue)}`,
          )}
        </span>
        {v.valide_par ? (
          <span className="mp-texte-doux">
            {t(
              `Validée par ${v.valide_par.nom}, le ${formaterDateHeure(v.valide_le)}`,
              `Approved by ${v.valide_par.nom}, on ${formaterDateHeure(v.valide_le, undefined, langue)}`,
            )}
          </span>
        ) : null}
      </div>

      {v.gabarit ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>{aideGabarit}</p>
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
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("Nombres non vérifiés", "Unverified numbers")}
        >
          <p>
            {acquittementRequis(v)
              ? t(
                  "Des nombres de la proposition ne viennent pas d'un moteur de calcul : ils doivent être vérifiés avant la validation.",
                  "Some numbers in the proposal do not come from a calculation engine: they must be verified before approval.",
                )
              : t(
                  "Les nombres de la proposition ont été vérifiés et attestés.",
                  "The numbers in the proposal have been verified and attested.",
                )}
          </p>
        </Alerte>
      ) : null}

      {modifiable ? (
        <form
          ref={enregistrement.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={enregistrer}
          aria-label={t(
            `Modifier la cartographie, version ${v.version}`,
            `Edit the map, version ${v.version}`,
          )}
        >
          <RetourFormulaire
            erreur={enregistrement.erreurGlobale}
            succes={enregistrement.succes}
            refAlerte={enregistrement.refAlerte}
            titreErreur={t("Enregistrement impossible", "Saving not possible")}
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
              texteChargement={t("Enregistrement…", "Saving…")}
              disabled={!modifie}
            >
              {t("Enregistrer les modifications", "Save changes")}
            </Bouton>
            {!modifie ? (
              <span className="mp-texte-doux mp-texte-petit">
                {t("Aucune modification à enregistrer.", "No changes to save.")}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          <ul
            className="mp-diag-liste"
            aria-label={t(
              `Causes racines, version ${v.version}`,
              `Root causes, version ${v.version}`,
            )}
          >
            {v.causes.map((c) => (
              <li key={c.id} className="mp-diag-cause">
                <div className="mp-diag-cause__entete">
                  <strong>{c.libelle}</strong>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleDomaine(c.domaine, langue)}
                  </BadgeStatut>
                  <span className="mp-texte-doux mp-texte-petit">
                    {libelleConfianceCause(c.confiance, langue)}
                  </span>
                </div>
                <p className="mp-diag-cause__texte">{c.description}</p>
              </li>
            ))}
          </ul>
          {v.statut === "valide" ? (
            <p className="mp-texte-doux">
              {t(TEXTE_CAUSES_LECTURE_SEULE, TEXTE_CAUSES_LECTURE_SEULE_EN)}
            </p>
          ) : null}
        </>
      )}

      {validable ? (
        <div className="mp-pile">
          <RetourFormulaire
            erreur={validation.erreurGlobale}
            succes={validation.succes}
            refAlerte={validation.refAlerte}
            titreErreur={t("Validation impossible", "Approval not possible")}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              variante="primaire"
              chargement={validation.enCours}
              texteChargement={t("Validation…", "Approving…")}
              disabled={modifie || raisonValidation !== null}
              onClick={() => void valider()}
            >
              {t("Valider", "Approve")}
            </Bouton>
            {raisonValidation ? (
              <span className="mp-texte-doux mp-texte-petit">{raisonValidation}</span>
            ) : null}
            {modifie ? (
              <span className="mp-texte-doux mp-texte-petit">
                {t(
                  "Enregistrez vos modifications avant de valider.",
                  "Save your changes before approving.",
                )}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <details className="mp-diag-details">
        <summary>
          {t("Historique", "History")} ({v.historique.length})
        </summary>
        <ol className="mp-diag-historique" aria-label={t("Historique des rangs", "Rank history")}>
          {v.historique.map((r) => (
            <li key={r.rang}>
              {libelleRangHistorique(r, langue)}
              {t(", le ", ", on ")}
              {formaterDateHeure(r.cree_le, undefined, langue)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
