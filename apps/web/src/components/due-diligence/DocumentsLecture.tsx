"use client";

import "../ingestion/ingestion.css";
import Link from "next/link";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useState } from "react";
import type { ContenuLecture } from "@missionpilot/shared";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BadgeVerification } from "../ingestion/BadgeVerification";
import { DecisionExtraction } from "../ingestion/DecisionExtraction";
import { StatutExtraction } from "../ingestion/StatutExtraction";
import { formaterDateHeure } from "../../lib/format";
import {
  hrefPageCitee,
  messageErreur,
  modifierExtraction,
  type ApiIngestion,
  type ExtractionIngestion,
  type ExtractionLecture,
} from "../../lib/ingestion";
import {
  compterNonVerifies,
  ENONCE_MAX,
  erreurEnonce,
  extractionOuverte,
  libelleTypeElementLecture,
  modifierEnonceLecture,
  retirerElementLecture,
} from "../../lib/ingestion-extractions";

export interface DocumentsLectureProps {
  api: ApiIngestion;
  extraction: ExtractionLecture;
  /** Adresse de la page du document (sans requête) : sert aux liens vers les pages citées. */
  hrefDocument: string;
  peutCorriger: boolean;
  peutDecider: boolean;
}

/** Texte du bandeau « brouillon » : affiché tant que le brouillon n'est pas tranché. */
export const BANDEAU_BROUILLON_LECTURE =
  "Brouillon produit par l'IA : rien n'est repris dans les analyses, verdicts ou preuves tant qu'il n'est pas validé.";

/**
 * Lecture IA d'un document de due diligence (DD-02, DD-10) : résumé et éléments, chacun avec sa page
 * cliquable et son badge de vérification dans la source. Brouillon à corriger (retrait d'un élément,
 * énoncé) puis à valider ou rejeter par un détenteur de `dd.valider`. Les vérifications sont
 * recalculées par le serveur à chaque correction ; ce composant ne vérifie rien lui-même.
 */
export function DocumentsLecture({
  api,
  extraction: initiale,
  hrefDocument,
  peutCorriger,
  peutDecider,
}: DocumentsLectureProps) {
  const { rafraichir } = useRafraichir();
  const [x, setX] = useState<ExtractionLecture>(initiale);
  const [occupe, setOccupe] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [aRetirer, setARetirer] = useState<number | null>(null);
  const [edition, setEdition] = useState<{ index: number; texte: string } | null>(null);
  const [erreurEdition, setErreurEdition] = useState<string | undefined>();

  useEffect(() => {
    setX(initiale);
  }, [initiale]);

  const c = x.contenu;
  const ouvert = extractionOuverte(x.statut);
  const nonVerifies = compterNonVerifies(c);

  async function enregistrer(contenu: ContenuLecture, message: string) {
    setOccupe(true);
    setEchec(null);
    try {
      const vue = await modifierExtraction(api, x.id, contenu);
      if (vue.nature === "lecture_document") setX(vue);
      setAnnonce(message);
      setARetirer(null);
      setEdition(null);
      rafraichir();
    } catch (e) {
      setEchec(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  function apresDecision(vue: ExtractionIngestion) {
    if (vue.nature === "lecture_document") setX(vue);
    rafraichir();
  }

  return (
    <div className="mp-ing-pile">
      <div className="mp-ing-entete">
        <StatutExtraction statut={x.statut} />
        {x.modifie_par ? (
          <span className="mp-texte-petit">
            {`Corrigé par ${x.modifie_par.nom}${x.modifie_le ? ` le ${formaterDateHeure(x.modifie_le)}` : ""}`}
          </span>
        ) : null}
        {x.valide_par ? (
          <span className="mp-texte-petit">
            {`${x.statut === "rejete" ? "Rejeté" : "Validé"} par ${x.valide_par.nom}${x.valide_le ? ` le ${formaterDateHeure(x.valide_le)}` : ""}`}
          </span>
        ) : null}
      </div>

      {ouvert ? (
        <Alerte tonalite="attention" titre="Brouillon IA à relire" annonce="aucune">
          <p>{BANDEAU_BROUILLON_LECTURE}</p>
        </Alerte>
      ) : x.statut === "valide" ? (
        <Alerte tonalite="succes" titre="Lecture validée" annonce="aucune">
          <p>
            Cette lecture est validée et reste consultable ici. Valider ne reprend rien
            automatiquement dans les analyses, les verdicts ou les preuves.
          </p>
        </Alerte>
      ) : (
        <Alerte tonalite="info" titre="Lecture rejetée" annonce="aucune">
          <p>{`Motif : ${x.motif_rejet ?? "non précisé"}. Rien n'a été repris dans le dossier.`}</p>
        </Alerte>
      )}

      {c.tronque ? (
        <Alerte tonalite="attention" titre="Document lu en partie" annonce="aucune">
          <p>
            Le texte transmis à l&apos;IA a été limité : la fin du document n&apos;a pas été lue.
          </p>
        </Alerte>
      ) : null}

      <section aria-labelledby="titre-resume" className="mp-ing-pile">
        <h3 id="titre-resume" className="mp-carte__titre">
          Résumé
        </h3>
        {c.resume.length === 0 ? (
          <p className="mp-texte-doux">Aucun résumé produit.</p>
        ) : (
          <ul className="mp-ing-liste" aria-label="Résumé par page">
            {c.resume.map((r) => (
              <li key={`${r.page}-${r.texte}`}>
                {r.texte}{" "}
                <Link href={hrefPageCitee(hrefDocument, r.page)}>{`(page ${r.page})`}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titre-elements" className="mp-ing-pile">
        <h3 id="titre-elements" className="mp-carte__titre">
          {`Éléments relevés (${c.elements.length})`}
        </h3>
        {ouvert && nonVerifies > 0 ? (
          <p>
            <strong>{`${nonVerifies} élément(s) NON retrouvé(s) dans la page citée.`}</strong>{" "}
            Relisez-les dans la page avant de valider.
          </p>
        ) : null}
        {c.elements.length === 0 ? (
          <p className="mp-texte-doux">Aucun élément.</p>
        ) : (
          <ol className="mp-ing-liste" aria-label="Éléments relevés par l'IA">
            {c.elements.map((e, i) => (
              <li
                key={`${i}-${e.page}-${e.enonce}`}
                className={e.verifie ? "mp-ing-element" : "mp-ing-element mp-ing-element--alerte"}
              >
                <div className="mp-ing-entete">
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleTypeElementLecture(e.type)}
                  </BadgeStatut>
                  <BadgeVerification verifie={e.verifie} />
                  <Link href={hrefPageCitee(hrefDocument, e.page)}>{`Page ${e.page}`}</Link>
                </div>
                {edition?.index === i ? (
                  <div className="mp-ing-pile">
                    <ZoneTexte
                      libelle="Énoncé"
                      value={edition.texte}
                      maxLength={ENONCE_MAX}
                      disabled={occupe}
                      onChange={(ev) => {
                        setEdition({ index: i, texte: ev.target.value });
                        setErreurEdition(undefined);
                      }}
                      erreur={erreurEdition}
                    />
                    <div className="mp-ing-actions">
                      <Bouton
                        chargement={occupe}
                        texteChargement="Enregistrement…"
                        onClick={() => {
                          const err = erreurEnonce(edition.texte);
                          setErreurEdition(err ?? undefined);
                          if (!err) {
                            void enregistrer(
                              modifierEnonceLecture(c, i, edition.texte),
                              "Énoncé enregistré ; les vérifications ont été recalculées.",
                            );
                          }
                        }}
                      >
                        Enregistrer l&apos;énoncé
                      </Bouton>
                      <Bouton
                        variante="discret"
                        disabled={occupe}
                        onClick={() => {
                          setEdition(null);
                          setErreurEdition(undefined);
                        }}
                      >
                        Annuler
                      </Bouton>
                    </div>
                  </div>
                ) : (
                  <p className="mp-ing-enonce">{e.enonce}</p>
                )}
                <p className="mp-ing-meta mp-texte-petit">Extrait recopié de la page :</p>
                <blockquote className="mp-ing-extrait">{e.extrait}</blockquote>
                {ouvert && peutCorriger && edition?.index !== i ? (
                  <div className="mp-ing-actions">
                    <Bouton
                      variante="discret"
                      disabled={occupe}
                      onClick={() => {
                        setEdition({ index: i, texte: e.enonce });
                        setARetirer(null);
                      }}
                    >
                      Modifier l&apos;énoncé
                    </Bouton>
                    {aRetirer === i ? (
                      <>
                        <Bouton
                          variante="danger"
                          chargement={occupe}
                          texteChargement="Retrait…"
                          onClick={() =>
                            void enregistrer(retirerElementLecture(c, i), "Élément retiré.")
                          }
                        >
                          Confirmer le retrait
                        </Bouton>
                        <Bouton
                          variante="discret"
                          disabled={occupe}
                          onClick={() => setARetirer(null)}
                        >
                          Garder
                        </Bouton>
                      </>
                    ) : (
                      <Bouton variante="discret" disabled={occupe} onClick={() => setARetirer(i)}>
                        Retirer cet élément
                      </Bouton>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <p className="mp-visuellement-cache" role="status" aria-live="polite">
          {annonce}
        </p>
        {echec ? (
          <Alerte tonalite="danger" titre="Correction refusée">
            <p>{echec}</p>
          </Alerte>
        ) : null}
      </section>

      {ouvert && peutDecider ? (
        <section aria-labelledby="titre-decision" className="mp-ing-pile">
          <h3 id="titre-decision" className="mp-carte__titre">
            Décision
          </h3>
          <DecisionExtraction
            api={api}
            extraction={x}
            nonVerifies={x.chiffres_non_verifies}
            libelleValider="Valider la lecture"
            aide="Le dernier à avoir corrigé le brouillon ne le valide pas lui-même (sauf un associé) : demandez à un autre membre habilité."
            onDecide={apresDecision}
          />
        </section>
      ) : ouvert ? (
        <p className="mp-texte-doux">
          Seul un détenteur du droit de validation de la due diligence peut valider ou rejeter ce
          brouillon.
        </p>
      ) : null}
    </div>
  );
}
