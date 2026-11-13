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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { RetourAction } from "./RetourAction";
import { useActionQualite } from "./useActionQualite";

const QUALITES_SIGNATAIRE_EN: Record<string, string> = {
  directeur_mission: "engagement director",
  associe: "partner",
};

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
  const t = useT();
  const langue = useLangue();
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
    const v = validerCommentaire(commentaire, { obligatoire: false }, langue);
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
      t(
        `Étape franchie : ${libelleEtape(etape)}.`,
        `Step completed: ${libelleEtape(etape, "en")}.`,
      ),
    );
    if (r !== undefined) setCommentaire("");
  }

  async function signer() {
    const v = validerCommentaire(commentaire, { obligatoire: false }, langue);
    if (!v.ok) {
      setErreurChamp(v.erreurs.commentaire);
      return;
    }
    setErreurChamp(undefined);
    const r = await a.agir(
      () =>
        api.post(cheminActionSuivi(suivi.id, "signature"), { commentaire: v.charge.commentaire }),
      t(
        "Livrable signé : l'empreinte du contenu est enregistrée.",
        "Deliverable signed: the content fingerprint is recorded.",
      ),
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
        titreErreur={t("Étape refusée", "Step refused")}
      />

      {garde.automatique ? (
        <p>
          {t(
            "Classe R0 : garde automatique, journalisée, sans étape humaine.",
            "Class R0: automatic, logged safeguard, no human step.",
          )}
        </p>
      ) : (
        <ol className="mp-qualite-etapes" aria-label={t("Étapes de la garde", "Safeguard steps")}>
          {garde.etapes_requises.map((e) => {
            const faite = validations.find((v) => v.etape === e);
            const courante = e === prochaine;
            return (
              <li key={e} aria-current={courante ? "step" : undefined}>
                <span className="mp-qualite-etapes__nom">{libelleEtape(e, langue)}</span>
                {faite ? (
                  <span className="mp-texte-doux mp-texte-petit">
                    {faite.acteur_nom ?? "—"} ·{" "}
                    {formaterDateHeure(faite.valide_le, undefined, langue)}
                    {faite.commentaire ? ` · « ${faite.commentaire} »` : ""}
                    {faite.a_reconfirmer ? (
                      <>
                        {" "}
                        <BadgeStatut tonalite="attention">
                          {t("À reconfirmer", "To reconfirm")}
                        </BadgeStatut>
                      </>
                    ) : null}
                  </span>
                ) : courante ? (
                  <BadgeStatut tonalite="attention">{t("Étape suivante", "Next step")}</BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">{t("À venir", "Upcoming")}</BadgeStatut>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {garde.etapes_a_reconfirmer.length > 0 ? (
        <p className="mp-texte-doux">
          {t(
            `Des éléments ont été déposés dans la revue après ${garde.etapes_a_reconfirmer.length} étape(s) déjà franchie(s) : leurs auteurs les parcourent pour les reconfirmer avant la validation du livrable.`,
            `Items were added to the review after ${garde.etapes_a_reconfirmer.length} step(s) already completed: their authors go through them to reconfirm before the deliverable is approved.`,
          )}
        </p>
      ) : null}

      {garde.violations.length > 0 ? (
        <p className="mp-texte-doux">
          {t(
            `La garde enregistrée présente ${garde.violations.length} anomalie(s) de séparation des tâches : consultez le directeur de mission.`,
            `The recorded safeguard shows ${garde.violations.length} segregation-of-duties anomaly(ies): consult the engagement director.`,
          )}
        </p>
      ) : null}

      {signature ? (
        <div
          className="mp-qualite-signature"
          role="group"
          aria-label={t("Signature du livrable", "Deliverable signature")}
        >
          <p>
            <strong>{t("Signé", "Signed")}</strong> {t("par", "by")}{" "}
            {signature.signataire_nom ?? "—"} (
            {langue === "en"
              ? (QUALITES_SIGNATAIRE_EN[signature.qualite] ?? signature.qualite.replace("_", " "))
              : signature.qualite.replace("_", " ")}
            ) {t("le", "on")} {formaterDateHeure(signature.signe_le, undefined, langue)},{" "}
            {t("version", "version")} {signature.version}.
          </p>
          <p className="mp-texte-petit">
            {t("Empreinte SHA-256", "SHA-256 fingerprint")}{" "}
            {signature.portee_empreinte === "contenu"
              ? t("du contenu", "of the content")
              : t(
                  "du dossier de revue (contenu non lisible par le module)",
                  "of the review file (content not readable by the module)",
                )}{" "}
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
            libelle={t("Commentaire (facultatif)", "Comment (optional)")}
            rows={2}
            maxLength={2000}
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            erreur={erreurChamp}
          />
          <div className="mp-qualite__actions-ligne">
            {peutValider && prochaine ? (
              <Bouton
                type="submit"
                chargement={a.enCours}
                texteChargement={t("Validation…", "Approving…")}
              >
                {t(
                  `Valider : ${libelleEtape(prochaine)}`,
                  `Approve: ${libelleEtape(prochaine, "en")}`,
                )}
              </Bouton>
            ) : (
              <Bouton
                type="submit"
                chargement={a.enCours}
                texteChargement={t("Signature…", "Signing…")}
              >
                {t("Signer le livrable", "Sign the deliverable")}
              </Bouton>
            )}
          </div>
          <p className="mp-texte-doux mp-texte-petit">
            {peutValider
              ? t(
                  "Vous devez avoir parcouru tous les éléments obligatoires de la revue, et la définition de terminé doit être satisfaite.",
                  "You must have gone through all mandatory review items, and the definition of done must be satisfied.",
                )
              : t(
                  "Le signataire parcourt lui aussi tous les éléments obligatoires. La signature est définitive.",
                  "The signer also goes through all mandatory items. The signature is final.",
                )}
          </p>
        </form>
      ) : suivi.statut === "en_revue" && prochaine && !garde.automatique ? (
        <p className="mp-texte-doux">
          {t("Prochaine étape", "Next step")} : {libelleEtape(prochaine, langue)}.{" "}
          {prochaine === "signature_directeur_mission"
            ? t(
                "Elle suivra la validation des étapes précédentes.",
                "It will follow the approval of the previous steps.",
              )
            : t(
                "Vous n'êtes pas habilité à la franchir sur cette mission, ou elle revient à une autre personne.",
                "You are not authorized to complete it on this engagement, or it belongs to someone else.",
              )}
        </p>
      ) : suivi.statut === "brouillon" ? (
        <p className="mp-texte-doux">
          {t(
            "Lancez d'abord la vérification de la définition de terminé : la revue humaine s'ouvre ensuite.",
            "First run the definition-of-done verification: the human review opens afterwards.",
          )}
        </p>
      ) : null}
    </div>
  );
}
