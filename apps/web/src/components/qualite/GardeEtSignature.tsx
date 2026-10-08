"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import {
  cheminActionSuivi,
  empreinteCourte,
  libelleEtape,
  validerCommentaire,
  type DetailSuivi,
  type DroitsQualite,
} from "../../lib/qualite";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { RetourAction } from "./RetourAction";
import { useActionQualite } from "./useActionQualite";

export interface GardeEtSignatureProps {
  detail: DetailSuivi;
  droits: DroitsQualite;
}

/**
 * Garde de la classe (QUA-01, QUA-04) et signature (QUA-06). Les étapes, leur ordre et la
 * séparation des tâches (auteur, cumuls, quatre yeux) sont jugés par l'API (moteur) : cet écran
 * affiche l'étape suivante, propose le bouton à qui est habilité, et restitue les violations.
 * La signature appose une empreinte SHA-256 et la mention de contribution de l'IA du cabinet.
 */
export function GardeEtSignature({ detail, droits }: GardeEtSignatureProps) {
  const { suivi, garde, validations, signature } = detail;
  const a = useActionQualite();
  const [commentaire, setCommentaire] = useState("");
  const [erreurChamp, setErreurChamp] = useState<string | undefined>();

  const prochaine = garde.prochaine_etape;
  const aSigner = suivi.statut === "valide" && (suivi.classe === "R2" || suivi.classe === "R3");
  const peutValider =
    suivi.statut === "en_revue" &&
    prochaine !== null &&
    prochaine !== "signature_directeur_mission" &&
    garde.peut_valider_prochaine_etape;

  async function valider(etape: NonNullable<typeof prochaine>) {
    const v = validerCommentaire(commentaire, { obligatoire: false });
    if (!v.ok) {
      setErreurChamp(v.erreurs.commentaire);
      return;
    }
    setErreurChamp(undefined);
    const r = await a.agir(
      () =>
        api.post(cheminActionSuivi(suivi.id, "validations"), {
          etape,
          commentaire: v.charge.commentaire,
        }),
      `Étape franchie : ${libelleEtape(etape)}.`,
    );
    if (r !== undefined) setCommentaire("");
  }

  async function signer() {
    const v = validerCommentaire(commentaire, { obligatoire: false });
    if (!v.ok) {
      setErreurChamp(v.erreurs.commentaire);
      return;
    }
    setErreurChamp(undefined);
    const r = await a.agir(
      () =>
        api.post(cheminActionSuivi(suivi.id, "signature"), { commentaire: v.charge.commentaire }),
      "Livrable signé : l'empreinte du contenu est enregistrée.",
    );
    if (r !== undefined) setCommentaire("");
  }

  return (
    <div className="mp-qualite__section">
      <RetourAction
        erreur={a.erreur}
        succes={a.succes}
        violations={a.violations}
        refAlerte={a.refAlerte}
        titreErreur="Étape refusée"
      />

      {garde.automatique ? (
        <p>Classe R0 : garde automatique, journalisée, sans étape humaine.</p>
      ) : (
        <ol className="mp-qualite-etapes" aria-label="Étapes de la garde">
          {garde.etapes_requises.map((e) => {
            const faite = validations.find((v) => v.etape === e);
            const courante = e === prochaine;
            return (
              <li key={e} aria-current={courante ? "step" : undefined}>
                <span className="mp-qualite-etapes__nom">{libelleEtape(e)}</span>
                {faite ? (
                  <span className="mp-texte-doux mp-texte-petit">
                    {faite.acteur_nom ?? "—"} · {formaterDateHeure(faite.valide_le)}
                    {faite.commentaire ? ` · « ${faite.commentaire} »` : ""}
                    {faite.a_reconfirmer ? (
                      <>
                        {" "}
                        <BadgeStatut tonalite="attention">À reconfirmer</BadgeStatut>
                      </>
                    ) : null}
                  </span>
                ) : courante ? (
                  <BadgeStatut tonalite="attention">Étape suivante</BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">À venir</BadgeStatut>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {garde.etapes_a_reconfirmer.length > 0 ? (
        <p className="mp-texte-doux">
          Des éléments ont été déposés dans la revue après {garde.etapes_a_reconfirmer.length}{" "}
          étape(s) déjà franchie(s) : leurs auteurs les parcourent pour les reconfirmer avant la
          validation du livrable.
        </p>
      ) : null}

      {garde.violations.length > 0 ? (
        <p className="mp-texte-doux">
          La garde enregistrée présente {garde.violations.length} anomalie(s) de séparation des
          tâches : consultez le directeur de mission.
        </p>
      ) : null}

      {signature ? (
        <div className="mp-qualite-signature" role="group" aria-label="Signature du livrable">
          <p>
            <strong>Signé</strong> par {signature.signataire_nom ?? "—"} (
            {signature.qualite.replace("_", " ")}) le {formaterDateHeure(signature.signe_le)},
            version {signature.version}.
          </p>
          <p className="mp-texte-petit">
            Empreinte SHA-256{" "}
            {signature.portee_empreinte === "contenu"
              ? "du contenu"
              : "du dossier de revue (contenu non lisible par le module)"}{" "}
            :{" "}
            <code title={signature.empreinte_sha256}>
              {empreinteCourte(signature.empreinte_sha256)}
            </code>
          </p>
          {signature.mention_ia ? (
            <p className="mp-texte-doux mp-texte-petit">{signature.mention_ia}</p>
          ) : null}
        </div>
      ) : null}

      {peutValider || (aSigner && droits.signer) ? (
        <form
          className="mp-formulaire"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (peutValider && prochaine) void valider(prochaine);
            else void signer();
          }}
        >
          <ZoneTexte
            libelle="Commentaire (facultatif)"
            rows={2}
            maxLength={2000}
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            erreur={erreurChamp}
          />
          <div className="mp-qualite__actions-ligne">
            {peutValider && prochaine ? (
              <Bouton type="submit" chargement={a.enCours} texteChargement="Validation…">
                {`Valider : ${libelleEtape(prochaine)}`}
              </Bouton>
            ) : (
              <Bouton type="submit" chargement={a.enCours} texteChargement="Signature…">
                Signer le livrable
              </Bouton>
            )}
          </div>
          <p className="mp-texte-doux mp-texte-petit">
            {peutValider
              ? "Vous devez avoir parcouru tous les éléments obligatoires de la revue, et la définition de terminé doit être satisfaite."
              : "Le signataire parcourt lui aussi tous les éléments obligatoires. La signature est définitive."}
          </p>
        </form>
      ) : suivi.statut === "en_revue" && prochaine && !garde.automatique ? (
        <p className="mp-texte-doux">
          Prochaine étape : {libelleEtape(prochaine)}.{" "}
          {prochaine === "signature_directeur_mission"
            ? "Elle suivra la validation des étapes précédentes."
            : "Vous n'êtes pas habilité à la franchir sur cette mission, ou elle revient à une autre personne."}
        </p>
      ) : suivi.statut === "brouillon" ? (
        <p className="mp-texte-doux">
          Lancez d&apos;abord la vérification de la définition de terminé : la revue humaine
          s&apos;ouvre ensuite.
        </p>
      ) : null}
    </div>
  );
}
