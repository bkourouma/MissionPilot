"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  cheminActionSuivi,
  cheminAttestation,
  libelleVerification,
  tonaliteVerification,
  validerCommentaire,
  type DefinitionSuivi,
  type ItemDefinition,
} from "../../lib/qualite";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { RetourAction } from "./RetourAction";
import { useActionQualite } from "./useActionQualite";

export interface DefinitionTermineProps {
  suiviId: string;
  definition: DefinitionSuivi;
  /** La vérification et l'attestation sont ouvertes (statut brouillon ou en revue). */
  ouvert: boolean;
  /** L'utilisateur peut vérifier et attester (qualite.relire). */
  peutAttester: boolean;
  enRevue: boolean;
}

function peutEtreAttesteIci(i: ItemDefinition): boolean {
  return i.controle === "manuel" || i.statut === "non_evaluable";
}

/**
 * Définition de terminé (QUA-02) : chaque item est contrôlé par du code (présence des sections,
 * statut du contenu, chiffres tracés) ou attesté par un relecteur avec un commentaire motivé. Un
 * item non conforme se corrige dans le livrable, puis la vérification est relancée.
 */
export function DefinitionTermine({
  suiviId,
  definition,
  ouvert,
  peutAttester,
  enRevue,
}: DefinitionTermineProps) {
  const t = useT();
  const langue = useLangue();
  const a = useActionQualite();
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [erreurChamp, setErreurChamp] = useState<string | undefined>();

  async function attester(item: ItemDefinition) {
    const v = validerCommentaire(commentaire, { obligatoire: true }, langue);
    if (!v.ok) {
      setErreurChamp(v.erreurs.commentaire);
      return;
    }
    setErreurChamp(undefined);
    const r = await a.agir(
      () => api.post(cheminAttestation(suiviId, item.id), { commentaire: v.charge.commentaire }),
      t("Attestation enregistrée.", "Attestation recorded."),
    );
    if (r !== undefined) {
      setCommentaire("");
      setOuverte(null);
    }
  }

  if (definition.items.length === 0) {
    return (
      <div className="mp-qualite__section">
        <p className="mp-texte-doux">
          {t(
            "Aucune définition de terminé n'est attachée à ce type de livrable : la revue humaine est la seule porte.",
            "No definition of done is attached to this deliverable type: human review is the only gate.",
          )}
        </p>
        {ouvert && peutAttester ? (
          <Bouton
            chargement={a.enCours}
            texteChargement={t("Vérification…", "Verifying…")}
            onClick={() => a.agir(() => api.post(cheminActionSuivi(suiviId, "verification")))}
          >
            {enRevue
              ? t("Relancer la vérification", "Rerun the verification")
              : t("Ouvrir la revue", "Open the review")}
          </Bouton>
        ) : null}
        <RetourAction
          erreur={a.erreur}
          succes={a.succes}
          violations={a.violations}
          refAlerte={a.refAlerte}
        />
      </div>
    );
  }

  return (
    <div className="mp-qualite__section">
      <RetourAction
        erreur={a.erreur}
        succes={a.succes}
        violations={a.violations}
        refAlerte={a.refAlerte}
        titreErreur={t("Vérification impossible", "Verification failed")}
      />
      <p className="mp-texte-doux">
        {definition.libelle} ({t("version", "version")} {definition.version}).{" "}
        {definition.satisfaite
          ? t("Tous les items obligatoires sont satisfaits.", "All mandatory items are satisfied.")
          : t(
              "Des items obligatoires restent à satisfaire avant toute validation.",
              "Mandatory items remain to be satisfied before any approval.",
            )}
      </p>
      <ul className="mp-liste-lignes">
        {definition.items.map((i) => (
          <li key={i.id} className="mp-liste-lignes__ligne mp-qualite__item">
            <div className="mp-liste-lignes__texte">
              <span>
                {i.libelle}
                {i.obligatoire ? "" : ` (${t("facultatif", "optional")})`}
              </span>
              <span className="mp-texte-doux mp-texte-petit">
                {i.controle === "manuel"
                  ? t("Attesté par le relecteur", "Attested by the reviewer")
                  : t("Contrôlé par le code", "Checked by code")}
                {i.detail ? ` · ${i.detail}` : ""}
              </span>
              {ouverte === i.id ? (
                <form
                  className="mp-formulaire"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    void attester(i);
                  }}
                >
                  <ZoneTexte
                    libelle={t("Attestation motivée", "Reasoned attestation")}
                    required
                    rows={2}
                    maxLength={1000}
                    value={commentaire}
                    onChange={(e) => setCommentaire(e.target.value)}
                    erreur={erreurChamp}
                    aide={t(
                      "Dites ce que vous avez vérifié ; le commentaire est conservé dans l'historique.",
                      "State what you verified; the comment is kept in the history.",
                    )}
                  />
                  <div className="mp-qualite__actions-ligne">
                    <Bouton
                      type="submit"
                      chargement={a.enCours}
                      texteChargement={t("Enregistrement…", "Saving…")}
                    >
                      {t("Attester", "Attest")}
                    </Bouton>
                    <Bouton variante="discret" onClick={() => setOuverte(null)}>
                      {t("Annuler", "Cancel")}
                    </Bouton>
                  </div>
                </form>
              ) : null}
            </div>
            <BadgeStatut tonalite={tonaliteVerification(i.statut)}>
              {libelleVerification(i.statut, langue)}
            </BadgeStatut>
            {enRevue &&
            peutAttester &&
            peutEtreAttesteIci(i) &&
            i.statut !== "atteste" &&
            ouverte !== i.id ? (
              <Bouton
                variante="secondaire"
                onClick={() => {
                  setOuverte(i.id);
                  setCommentaire("");
                  setErreurChamp(undefined);
                }}
              >
                {t("Attester", "Attest")}
              </Bouton>
            ) : null}
          </li>
        ))}
      </ul>
      {ouvert && peutAttester ? (
        <Bouton
          chargement={a.enCours}
          texteChargement={t("Vérification…", "Verifying…")}
          onClick={() =>
            a.agir(
              () => api.post(cheminActionSuivi(suiviId, "verification")),
              t("Vérification effectuée par le code.", "Verification performed by code."),
            )
          }
        >
          {enRevue
            ? t("Relancer la vérification", "Rerun the verification")
            : t(
                "Lancer la vérification et ouvrir la revue",
                "Run the verification and open the review",
              )}
        </Bouton>
      ) : null}
    </div>
  );
}
