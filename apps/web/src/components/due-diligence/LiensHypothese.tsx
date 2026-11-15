"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { SENS_LIEN_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminAssertionsHypothese,
  cheminLiensHypothese,
  hrefAssertionRegistre,
  libelleCategorie,
  libellesDd,
  messageDd,
  optionsDe,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeSolidite } from "../preuves/BadgeSolidite";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ChampsAffirmation } from "./ChampsAffirmation";

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

const tronquer = (texte: string, max = 140) =>
  texte.length > max ? `${texte.slice(0, max - 1)}…` : texte;

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
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
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
      setErreur(messageDd(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <li className="mp-dd-element">
      <p className="mp-dd-texte">{lien.enonce}</p>
      <span className="mp-dd-meta">
        <BadgeStatut tonalite={lien.sens === "soutient" ? "succes" : "danger"}>
          {L.SENS_LIEN[lien.sens]}
        </BadgeStatut>
        <BadgeSolidite solidite={lien.solidite ?? undefined} />
        {lien.analyse_point ? (
          <span className="mp-texte-doux mp-texte-petit">
            {t(
              `Issue de l'analyse ${L.ANALYSE[lien.analyse_point.analyse]} (${libelleCategorie(lien.analyse_point.categorie, langue)})`,
              `From the ${L.ANALYSE[lien.analyse_point.analyse]} analysis (${libelleCategorie(lien.analyse_point.categorie, langue)})`,
            )}
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
          {t("Voir l'assertion et ses sources", "View the statement and its sources")}
        </Link>
        {peutEcrire ? (
          <Bouton variante="secondaire" disabled={enCours} onClick={() => void delier()}>
            {t("Délier de l'hypothèse", "Unlink from the hypothesis")}
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
  const t = useT();
  const langue = useLangue();
  const optionsSens = optionsDe(SENS_LIEN_DD, libellesDd(langue).SENS_LIEN);
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
      validerLien(assertionId, sensLien, langue),
      (charge) => api.post(cheminLiensHypothese(hypotheseId), charge),
      {
        succes: t("Assertion liée à l'hypothèse.", "Statement linked to the hypothesis."),
        messageSpecifique: (err) => messageDd(err, langue),
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
      validerAssertionHypothese(nouvelle, langue),
      (charge) =>
        api.post<{ assertion_id: string }>(cheminAssertionsHypothese(hypotheseId), charge),
      {
        succes: t(
          "Assertion créée et liée. Reliez-lui des sources depuis sa fiche.",
          "Statement created and linked. Link sources to it from its page.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => setNouvelle(saisieAssertionHypotheseVide()),
      },
    );
  }

  return (
    <div className="mp-dd-pile">
      {liens.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucune assertion n'est liée à cette hypothèse : le moteur n'a rien à évaluer et l'indication est « non concluante ».",
            "No statement is linked to this hypothesis: the engine has nothing to assess and the indication is “inconclusive”.",
          )}
        </p>
      ) : (
        <ul
          className="mp-dd-liste"
          aria-label={t("Assertions liées à l'hypothèse", "Statements linked to the hypothesis")}
        >
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
            <summary>{t("Lier une assertion existante", "Link an existing statement")}</summary>
            <div className="mp-dd-details__corps">
              {erreurAssertions ? (
                <Alerte
                  tonalite="attention"
                  titre={t("Assertions indisponibles", "Statements unavailable")}
                  annonce="aucune"
                >
                  <p>{erreurAssertions}</p>
                </Alerte>
              ) : assertionsDisponibles.length === 0 ? (
                <p className="mp-texte-doux">
                  {t(
                    "Aucune autre assertion de la mission n'est disponible. Créez-en une nouvelle ci-dessous.",
                    "No other statement of the engagement is available. Create a new one below.",
                  )}
                </p>
              ) : (
                <form
                  ref={fLien.refFormulaire}
                  className="mp-formulaire"
                  noValidate
                  onSubmit={lier}
                  aria-label={t("Lier une assertion existante", "Link an existing statement")}
                >
                  <RetourFormulaire
                    erreur={fLien.erreurGlobale}
                    succes={fLien.succes}
                    refAlerte={fLien.refAlerte}
                    titreErreur={t("Lien refusé", "Link refused")}
                  />
                  <Select
                    libelle={t("Assertion", "Statement")}
                    required
                    invite={t("Choisir…", "Choose…")}
                    options={assertionsDisponibles.map((a) => ({
                      valeur: a.valeur,
                      libelle: tronquer(a.libelle),
                    }))}
                    value={assertionId}
                    onChange={(e) => setAssertionId(e.target.value)}
                    erreur={fLien.erreurs.assertion_id}
                  />
                  <Select
                    libelle={t("Sens", "Direction")}
                    required
                    invite={t("Choisir…", "Choose…")}
                    options={optionsSens}
                    value={sensLien}
                    onChange={(e) => setSensLien(e.target.value)}
                    erreur={fLien.erreurs.sens}
                  />
                  <div className="mp-actions-formulaire">
                    <Bouton
                      type="submit"
                      chargement={fLien.enCours}
                      texteChargement={t("Enregistrement…", "Saving…")}
                    >
                      {t("Lier l'assertion", "Link the statement")}
                    </Bouton>
                  </div>
                </form>
              )}
            </div>
          </details>

          <details className="mp-dd-details">
            <summary>{t("Nouvelle assertion", "New statement")}</summary>
            <div className="mp-dd-details__corps">
              <form
                ref={fNouvelle.refFormulaire}
                className="mp-formulaire"
                noValidate
                onSubmit={creer}
                aria-label={t(
                  "Nouvelle assertion pour l'hypothèse",
                  "New statement for the hypothesis",
                )}
              >
                <RetourFormulaire
                  erreur={fNouvelle.erreurGlobale}
                  succes={fNouvelle.succes}
                  refAlerte={fNouvelle.refAlerte}
                  titreErreur={t("Assertion refusée", "Statement refused")}
                />
                <Select
                  libelle={t("Sens", "Direction")}
                  required
                  invite={t("Choisir…", "Choose…")}
                  options={optionsSens}
                  value={nouvelle.sens}
                  onChange={(e) => majNouvelle({ sens: e.target.value })}
                  erreur={fNouvelle.erreurs.sens}
                />
                <ChampsAffirmation
                  valeur={nouvelle}
                  onChange={majNouvelle}
                  erreurs={fNouvelle.erreurs}
                  peutSigner={peutSigner}
                  libelle={t("Assertion", "Statement")}
                />
                <div className="mp-actions-formulaire">
                  <Bouton
                    type="submit"
                    chargement={fNouvelle.enCours}
                    texteChargement={t("Enregistrement…", "Saving…")}
                  >
                    {t("Créer et lier l'assertion", "Create and link the statement")}
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
