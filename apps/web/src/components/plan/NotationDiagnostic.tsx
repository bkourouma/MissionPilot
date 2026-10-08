"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const courant = lien.lien;
  const [choix, setChoix] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
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
      const base = versionId ? "Notation liée au diagnostic." : "Lien vers la notation retiré.";
      setSucces(partage ? `${base} Le partage au client a été retiré.` : base);
      setChoix("");
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageLienNotation(e));
      router.refresh();
      return false;
    } finally {
      setEnCours(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!choix) {
      setErreur("Choisissez une notation publiée.");
      return;
    }
    await changer(choix);
  }

  const options = proposees ? optionsNotations(proposees) : [];
  const autres = options.filter((o) => o.valeur !== courant?.notation?.version_id);

  return (
    <section className="mp-plan__section" aria-labelledby="titre-notation-diagnostic">
      <h4 id="titre-notation-diagnostic" className="mp-plan__intertitre">
        Notation de référence
      </h4>
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Lien refusé">
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
          Aucune notation liée : le diagnostic peut s&apos;appuyer sur une notation publiée de
          l&apos;entreprise (score et points forts et faibles calculés par le moteur).
        </p>
      ) : !courant.accessible || !courant.notation ? (
        <p className="mp-texte-doux">
          {`${mentionLien(courant)}. La notation liée n'est pas accessible avec vos droits actuels.`}
        </p>
      ) : (
        <dl className="mp-liste-def">
          <div>
            <dt>Notation</dt>
            <dd>
              {hrefNotation ? (
                <Link href={hrefNotation}>{libelleNotation(courant.notation)}</Link>
              ) : (
                libelleNotation(courant.notation)
              )}
            </dd>
          </div>
          <div>
            <dt>Score global</dt>
            <dd>{libelleScoreNotation(courant.notation)}</dd>
          </div>
          <div>
            <dt>Points forts</dt>
            <dd>{listeDimensions(courant.notation.forces)}</dd>
          </div>
          <div>
            <dt>Points faibles</dt>
            <dd>{listeDimensions(courant.notation.faiblesses)}</dd>
          </div>
          <div>
            <dt>Lien</dt>
            <dd>{mentionLien(courant)}</dd>
          </div>
        </dl>
      )}

      {proposees ? (
        autres.length ? (
          <form className="mp-plan-formulaire-ligne" noValidate onSubmit={soumettre}>
            <Select
              libelle={
                courant ? "Remplacer par une autre notation publiée" : "Lier une notation publiée"
              }
              invite="Choisir une version publiée"
              value={choix}
              onChange={(e) => setChoix(e.target.value)}
              options={autres}
            />
            <Bouton
              type="submit"
              variante="secondaire"
              chargement={enCours}
              texteChargement="Enregistrement…"
            >
              Lier au diagnostic
            </Bouton>
          </form>
        ) : !courant ? (
          <p className="mp-texte-doux mp-texte-petit">
            Aucune notation publiée de ce client ne vous est accessible pour l&apos;instant.
          </p>
        ) : null
      ) : null}
      {proposees && courant ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle="Retirer le lien"
            question={`Retirer le lien entre le diagnostic et la notation ?${partage ? " Le partage au client sera retiré." : ""}`}
            libelleConfirmation="Oui, retirer"
            texteChargement="Retrait…"
            icone="fermer"
            action={() => changer(null)}
          />
        </div>
      ) : null}
    </section>
  );
}
