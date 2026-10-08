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
  const a = useActionQualite();
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [erreurChamp, setErreurChamp] = useState<string | undefined>();

  async function attester(item: ItemDefinition) {
    const v = validerCommentaire(commentaire, { obligatoire: true });
    if (!v.ok) {
      setErreurChamp(v.erreurs.commentaire);
      return;
    }
    setErreurChamp(undefined);
    const r = await a.agir(
      () => api.post(cheminAttestation(suiviId, item.id), { commentaire: v.charge.commentaire }),
      "Attestation enregistrée.",
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
          Aucune définition de terminé n&apos;est attachée à ce type de livrable : la revue humaine
          est la seule porte.
        </p>
        {ouvert && peutAttester ? (
          <Bouton
            chargement={a.enCours}
            texteChargement="Vérification…"
            onClick={() => a.agir(() => api.post(cheminActionSuivi(suiviId, "verification")))}
          >
            {enRevue ? "Relancer la vérification" : "Ouvrir la revue"}
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
        titreErreur="Vérification impossible"
      />
      <p className="mp-texte-doux">
        {definition.libelle} (version {definition.version}).{" "}
        {definition.satisfaite
          ? "Tous les items obligatoires sont satisfaits."
          : "Des items obligatoires restent à satisfaire avant toute validation."}
      </p>
      <ul className="mp-liste-lignes">
        {definition.items.map((i) => (
          <li key={i.id} className="mp-liste-lignes__ligne mp-qualite__item">
            <div className="mp-liste-lignes__texte">
              <span>
                {i.libelle}
                {i.obligatoire ? "" : " (facultatif)"}
              </span>
              <span className="mp-texte-doux mp-texte-petit">
                {i.controle === "manuel" ? "Attesté par le relecteur" : "Contrôlé par le code"}
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
                    libelle="Attestation motivée"
                    required
                    rows={2}
                    maxLength={1000}
                    value={commentaire}
                    onChange={(e) => setCommentaire(e.target.value)}
                    erreur={erreurChamp}
                    aide="Dites ce que vous avez vérifié ; le commentaire est conservé dans l'historique."
                  />
                  <div className="mp-qualite__actions-ligne">
                    <Bouton type="submit" chargement={a.enCours} texteChargement="Enregistrement…">
                      Attester
                    </Bouton>
                    <Bouton variante="discret" onClick={() => setOuverte(null)}>
                      Annuler
                    </Bouton>
                  </div>
                </form>
              ) : null}
            </div>
            <BadgeStatut tonalite={tonaliteVerification(i.statut)}>
              {libelleVerification(i.statut)}
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
                Attester
              </Bouton>
            ) : null}
          </li>
        ))}
      </ul>
      {ouvert && peutAttester ? (
        <Bouton
          chargement={a.enCours}
          texteChargement="Vérification…"
          onClick={() =>
            a.agir(
              () => api.post(cheminActionSuivi(suiviId, "verification")),
              "Vérification effectuée par le code.",
            )
          }
        >
          {enRevue ? "Relancer la vérification" : "Lancer la vérification et ouvrir la revue"}
        </Bouton>
      ) : null}
    </div>
  );
}
