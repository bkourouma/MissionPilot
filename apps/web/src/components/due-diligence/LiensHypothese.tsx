"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SENS_LIEN_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  ANALYSE_DD_LIBELLES,
  cheminAssertionsHypothese,
  cheminLiensHypothese,
  hrefAssertionRegistre,
  libelleCategorie,
  messageDd,
  optionsDe,
  SENS_LIEN_DD_LIBELLES,
  type LienHypothese,
} from "../../lib/due-diligence";
import {
  saisieAssertionHypotheseVide,
  validerAssertionHypothese,
  validerLien,
  type ChampAssertionHypothese,
  type SaisieAssertionHypothese,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useRafraichir } from "../formulaires/useRafraichir";
import { BadgeSolidite } from "../preuves/BadgeSolidite";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ChampsAffirmation } from "./ChampsAffirmation";

const OPTIONS_SENS = optionsDe(SENS_LIEN_DD, SENS_LIEN_DD_LIBELLES);

export interface LiensHypotheseProps {
  missionId: string;
  hypotheseId: string;
  liens: LienHypothese[];
  /** Assertions de la mission non encore liées (libellé = énoncé). */
  assertionsDisponibles: { valeur: string; libelle: string }[];
  /** Message si les assertions de la mission n'ont pas pu être chargées. */
  erreurAssertions: string | null;
  peutEcrire: boolean;
  peutSigner: boolean;
}

const tronquer = (t: string, max = 140) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

function LigneLien({
  lien,
  missionId,
  hypotheseId,
  peutEcrire,
}: {
  lien: LienHypothese;
  missionId: string;
  hypotheseId: string;
  peutEcrire: boolean;
}) {
  const { rafraichir, enAttente } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;

  async function delier() {
    setErreur(null);
    setEnCours(true);
    try {
      await api.post(cheminLiensHypothese(hypotheseId), {
        assertion_id: lien.assertion_id,
        action: "delier",
        sens: null,
      });
      rafraichir();
    } catch (e) {
      setErreur(messageDd(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <li className="mp-dd-element">
      <p className="mp-dd-texte">{lien.enonce}</p>
      <span className="mp-dd-meta">
        <BadgeStatut tonalite={lien.sens === "soutient" ? "succes" : "danger"}>
          {SENS_LIEN_DD_LIBELLES[lien.sens]}
        </BadgeStatut>
        <BadgeSolidite solidite={lien.solidite ?? undefined} />
        {lien.analyse_point ? (
          <span className="mp-texte-doux mp-texte-petit">
            {`Issue de l'analyse ${ANALYSE_DD_LIBELLES[lien.analyse_point.analyse]} (${libelleCategorie(lien.analyse_point.categorie)})`}
          </span>
        ) : null}
      </span>
      {erreur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="mp-barre-actions mp-barre-actions--compacte">
        <Link className="mp-lien-action" href={hrefAssertionRegistre(missionId, lien.assertion_id)}>
          Voir l&apos;assertion et ses sources
        </Link>
        {peutEcrire ? (
          <Bouton variante="secondaire" disabled={enCours} onClick={() => void delier()}>
            Délier de l&apos;hypothèse
          </Bouton>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Assertions liées à une hypothèse (DD-09) : chaque lien « soutient » ou « contredit », avec la
 * solidité calculée par le moteur des preuves. On peut lier une assertion existante de la mission
 * ou en créer une nouvelle, rattachée à l'hypothèse.
 */
export function LiensHypothese({
  missionId,
  hypotheseId,
  liens,
  assertionsDisponibles,
  erreurAssertions,
  peutEcrire,
  peutSigner,
}: LiensHypotheseProps) {
  const fLien = useFormulaire<"assertion_id" | "sens">();
  const [assertionId, setAssertionId] = useState("");
  const [sensLien, setSensLien] = useState("");
  const fNouvelle = useFormulaire<ChampAssertionHypothese>();
  const [nouvelle, setNouvelle] = useState<SaisieAssertionHypothese>(
    saisieAssertionHypotheseVide(),
  );
  const majNouvelle = (p: Partial<SaisieAssertionHypothese>) =>
    setNouvelle((x) => ({ ...x, ...p }));

  async function lier(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await fLien.envoyer(
      validerLien(assertionId, sensLien),
      (charge) => api.post(cheminLiensHypothese(hypotheseId), charge),
      {
        succes: "Assertion liée à l'hypothèse.",
        messageSpecifique: messageDd,
        apres: () => {
          setAssertionId("");
          setSensLien("");
        },
      },
    );
  }

  async function creer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await fNouvelle.envoyer(
      validerAssertionHypothese(nouvelle),
      (charge) =>
        api.post<{ assertion_id: string }>(cheminAssertionsHypothese(hypotheseId), charge),
      {
        succes: "Assertion créée et liée. Reliez-lui des sources depuis sa fiche.",
        messageSpecifique: messageDd,
        apres: () => setNouvelle(saisieAssertionHypotheseVide()),
      },
    );
  }

  return (
    <div className="mp-dd-pile">
      {liens.length === 0 ? (
        <p className="mp-texte-doux">
          Aucune assertion n&apos;est liée à cette hypothèse : le moteur n&apos;a rien à évaluer et
          l&apos;indication est « non concluante ».
        </p>
      ) : (
        <ul className="mp-dd-liste" aria-label="Assertions liées à l'hypothèse">
          {liens.map((l) => (
            <LigneLien
              key={l.assertion_id}
              lien={l}
              missionId={missionId}
              hypotheseId={hypotheseId}
              peutEcrire={peutEcrire}
            />
          ))}
        </ul>
      )}

      {peutEcrire ? (
        <>
          <details className="mp-dd-details">
            <summary>Lier une assertion existante</summary>
            <div className="mp-dd-details__corps">
              {erreurAssertions ? (
                <Alerte tonalite="attention" titre="Assertions indisponibles" annonce="aucune">
                  <p>{erreurAssertions}</p>
                </Alerte>
              ) : assertionsDisponibles.length === 0 ? (
                <p className="mp-texte-doux">
                  Aucune autre assertion de la mission n&apos;est disponible. Créez-en une nouvelle
                  ci-dessous.
                </p>
              ) : (
                <form
                  ref={fLien.refFormulaire}
                  className="mp-formulaire"
                  noValidate
                  onSubmit={lier}
                  aria-label="Lier une assertion existante"
                >
                  <RetourFormulaire
                    erreur={fLien.erreurGlobale}
                    succes={fLien.succes}
                    refAlerte={fLien.refAlerte}
                    titreErreur="Lien refusé"
                  />
                  <Select
                    libelle="Assertion"
                    required
                    invite="Choisir…"
                    options={assertionsDisponibles.map((a) => ({
                      valeur: a.valeur,
                      libelle: tronquer(a.libelle),
                    }))}
                    value={assertionId}
                    onChange={(e) => setAssertionId(e.target.value)}
                    erreur={fLien.erreurs.assertion_id}
                  />
                  <Select
                    libelle="Sens"
                    required
                    invite="Choisir…"
                    options={OPTIONS_SENS}
                    value={sensLien}
                    onChange={(e) => setSensLien(e.target.value)}
                    erreur={fLien.erreurs.sens}
                  />
                  <div className="mp-actions-formulaire">
                    <Bouton
                      type="submit"
                      chargement={fLien.enCours}
                      texteChargement="Enregistrement…"
                    >
                      Lier l&apos;assertion
                    </Bouton>
                  </div>
                </form>
              )}
            </div>
          </details>

          <details className="mp-dd-details">
            <summary>Nouvelle assertion</summary>
            <div className="mp-dd-details__corps">
              <form
                ref={fNouvelle.refFormulaire}
                className="mp-formulaire"
                noValidate
                onSubmit={creer}
                aria-label="Nouvelle assertion pour l'hypothèse"
              >
                <RetourFormulaire
                  erreur={fNouvelle.erreurGlobale}
                  succes={fNouvelle.succes}
                  refAlerte={fNouvelle.refAlerte}
                  titreErreur="Assertion refusée"
                />
                <Select
                  libelle="Sens"
                  required
                  invite="Choisir…"
                  options={OPTIONS_SENS}
                  value={nouvelle.sens}
                  onChange={(e) => majNouvelle({ sens: e.target.value })}
                  erreur={fNouvelle.erreurs.sens}
                />
                <ChampsAffirmation
                  valeur={nouvelle}
                  onChange={majNouvelle}
                  erreurs={fNouvelle.erreurs}
                  peutSigner={peutSigner}
                  libelle="Assertion"
                />
                <div className="mp-actions-formulaire">
                  <Bouton
                    type="submit"
                    chargement={fNouvelle.enCours}
                    texteChargement="Enregistrement…"
                  >
                    Créer et lier l&apos;assertion
                  </Bouton>
                </div>
              </form>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
