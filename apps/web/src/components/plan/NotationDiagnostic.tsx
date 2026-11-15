"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminLienNotation,
  libelleNotation,
  libelleScoreNotation,
  listeDimensions,
  mentionLien,
  messageLienNotation,
  optionsNotations,
  type LienNotation,
  type NotationsProposees,
} from "../../lib/plan-diagnostic";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";

export interface NotationDiagnosticProps {
  planId: string;
  lien: LienNotation;
  /** Notations publiées proposées (null : pas le droit de changer le lien). */
  proposees: NotationsProposees | null;
  /** Lien vers la notation de la mission liée (page notation), si accessible. */
  hrefNotation: string | null;
  partage: boolean;
}

/**
 * Notation publiée liée au diagnostic du plan (PLA-02) : score, classe, points forts et
 * faibles venus du moteur de notation ; choix parmi les versions publiées du client, ou
 * retrait du lien. L'API vérifie la publication, le client et la visibilité de la mission.
 */
export function NotationDiagnostic({
  planId,
  lien,
  proposees,
  hrefNotation,
  partage,
}: NotationDiagnosticProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const courant = lien.lien;
  const [choix, setChoix] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const [attente, attendre] = useAttenteRafraichissement(lien.modifie_le);
  const refErreur = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);

  async function changer(versionId: string | null): Promise<boolean> {
    if (attente || enCours) return false;
    setErreur(null);
    setSucces(null);
    setEnCours(true);
    try {
      await api.put<LienNotation>(cheminLienNotation(planId), { notation_version_id: versionId });
      const base = versionId
        ? t("Notation liée au diagnostic.", "Rating linked to the diagnostic.")
        : t("Lien vers la notation retiré.", "Link to the rating removed.");
      setSucces(
        partage
          ? `${base} ${t("Le partage au client a été retiré.", "Sharing with the client was withdrawn.")}`
          : base,
      );
      setChoix("");
      attendre();
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messageLienNotation(e, langue));
      rafraichir();
      return false;
    } finally {
      setEnCours(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!choix) {
      setErreur(t("Choisissez une notation publiée.", "Choose a published rating."));
      return;
    }
    await changer(choix);
  }

  const options = proposees ? optionsNotations(proposees, langue) : [];
  const autres = options.filter((o) => o.valeur !== courant?.notation?.version_id);

  return (
    <section className="mp-plan__section" aria-labelledby="titre-notation-diagnostic">
      <h4 id="titre-notation-diagnostic" className="mp-plan__intertitre">
        {t("Notation de référence", "Reference rating")}
      </h4>
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre={t("Lien refusé", "Link refused")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}

      {!courant ? (
        <p className="mp-texte-doux">
          {t(
            "Aucune notation liée : le diagnostic peut s'appuyer sur une notation publiée de l'entreprise (score et points forts et faibles calculés par le moteur).",
            "No rating linked: the diagnostic can rely on a published rating of the company (score and strengths and weaknesses computed by the engine).",
          )}
        </p>
      ) : !courant.accessible || !courant.notation ? (
        <p className="mp-texte-doux">
          {t(
            `${mentionLien(courant)}. La notation liée n'est pas accessible avec vos droits actuels.`,
            `${mentionLien(courant, langue)}. The linked rating is not accessible with your current rights.`,
          )}
        </p>
      ) : (
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Notation", "Rating")}</dt>
            <dd>
              {hrefNotation ? (
                <Link href={hrefNotation}>{libelleNotation(courant.notation, langue)}</Link>
              ) : (
                libelleNotation(courant.notation, langue)
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Score global", "Overall score")}</dt>
            <dd>{libelleScoreNotation(courant.notation, langue)}</dd>
          </div>
          <div>
            <dt>{t("Points forts", "Strengths")}</dt>
            <dd>{listeDimensions(courant.notation.forces, langue)}</dd>
          </div>
          <div>
            <dt>{t("Points faibles", "Weaknesses")}</dt>
            <dd>{listeDimensions(courant.notation.faiblesses, langue)}</dd>
          </div>
          <div>
            <dt>{t("Lien", "Link")}</dt>
            <dd>{mentionLien(courant, langue)}</dd>
          </div>
        </dl>
      )}

      {proposees ? (
        autres.length ? (
          <form className="mp-plan-formulaire-ligne" noValidate onSubmit={soumettre}>
            <Select
              libelle={
                courant
                  ? t(
                      "Remplacer par une autre notation publiée",
                      "Replace with another published rating",
                    )
                  : t("Lier une notation publiée", "Link a published rating")
              }
              invite={t("Choisir une version publiée", "Choose a published version")}
              value={choix}
              onChange={(e) => setChoix(e.target.value)}
              options={autres}
            />
            <Bouton
              type="submit"
              variante="secondaire"
              chargement={enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
            >
              {t("Lier au diagnostic", "Link to diagnostic")}
            </Bouton>
          </form>
        ) : !courant ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Aucune notation publiée de ce client ne vous est accessible pour l'instant.",
              "No published rating for this client is accessible to you for now.",
            )}
          </p>
        ) : null
      ) : null}
      {proposees && courant ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={t("Retirer le lien", "Remove the link")}
            question={t(
              `Retirer le lien entre le diagnostic et la notation ?${partage ? " Le partage au client sera retiré." : ""}`,
              `Remove the link between the diagnostic and the rating?${partage ? " Sharing with the client will be withdrawn." : ""}`,
            )}
            libelleConfirmation={t("Oui, retirer", "Yes, remove")}
            texteChargement={t("Retrait…", "Removing…")}
            icone="fermer"
            action={() => changer(null)}
          />
        </div>
      ) : null}
    </section>
  );
}
