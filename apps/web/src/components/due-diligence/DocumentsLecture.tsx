"use client";

import "../ingestion/ingestion.css";
import Link from "next/link";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useState } from "react";
import type { ContenuLecture } from "@missionpilot/shared";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
export const BANDEAU_BROUILLON_LECTURE_EN =
  "Draft produced by AI: nothing is carried into the analyses, verdicts or evidence until it is approved.";

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
  const t = useT();
  const langue = useLangue();
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
      setEchec(messageErreur(e, langue));
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
            {`${t("Corrigé par", "Edited by")} ${x.modifie_par.nom}${x.modifie_le ? ` ${t("le", "on")} ${formaterDateHeure(x.modifie_le, undefined, langue)}` : ""}`}
          </span>
        ) : null}
        {x.valide_par ? (
          <span className="mp-texte-petit">
            {`${x.statut === "rejete" ? t("Rejeté", "Rejected") : t("Validé", "Approved")} ${t("par", "by")} ${x.valide_par.nom}${x.valide_le ? ` ${t("le", "on")} ${formaterDateHeure(x.valide_le, undefined, langue)}` : ""}`}
          </span>
        ) : null}
      </div>

      {ouvert ? (
        <Alerte
          tonalite="attention"
          titre={t("Brouillon IA à relire", "AI draft to review")}
          annonce="aucune"
        >
          <p>{t(BANDEAU_BROUILLON_LECTURE, BANDEAU_BROUILLON_LECTURE_EN)}</p>
        </Alerte>
      ) : x.statut === "valide" ? (
        <Alerte tonalite="succes" titre={t("Lecture validée", "Reading approved")} annonce="aucune">
          <p>
            {t(
              "Cette lecture est validée et reste consultable ici. Valider ne reprend rien automatiquement dans les analyses, les verdicts ou les preuves.",
              "This reading is approved and remains available here. Approving does not automatically carry anything into the analyses, verdicts or evidence.",
            )}
          </p>
        </Alerte>
      ) : (
        <Alerte tonalite="info" titre={t("Lecture rejetée", "Reading rejected")} annonce="aucune">
          <p>
            {t(
              `Motif : ${x.motif_rejet ?? "non précisé"}. Rien n'a été repris dans le dossier.`,
              `Reason: ${x.motif_rejet ?? "not specified"}. Nothing was carried into the file.`,
            )}
          </p>
        </Alerte>
      )}

      {c.tronque ? (
        <Alerte
          tonalite="attention"
          titre={t("Document lu en partie", "Document partly read")}
          annonce="aucune"
        >
          <p>
            {t(
              "Le texte transmis à l'IA a été limité : la fin du document n'a pas été lue.",
              "The text sent to the AI was limited: the end of the document was not read.",
            )}
          </p>
        </Alerte>
      ) : null}

      <section aria-labelledby="titre-resume" className="mp-ing-pile">
        <h3 id="titre-resume" className="mp-carte__titre">
          {t("Résumé", "Summary")}
        </h3>
        {c.resume.length === 0 ? (
          <p className="mp-texte-doux">{t("Aucun résumé produit.", "No summary produced.")}</p>
        ) : (
          <ul className="mp-ing-liste" aria-label={t("Résumé par page", "Summary by page")}>
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
          {t(`Éléments relevés (${c.elements.length})`, `Items identified (${c.elements.length})`)}
        </h3>
        {ouvert && nonVerifies > 0 ? (
          <Alerte
            tonalite="danger"
            annonce="aucune"
            titre={t(
              `${nonVerifies} élément(s) NON retrouvé(s) dans la page citée.`,
              `${nonVerifies} item(s) NOT found in the cited page.`,
            )}
          >
            <p>
              {t(
                "Relisez-les dans la page avant de valider.",
                "Review them in the page before approving.",
              )}
            </p>
          </Alerte>
        ) : null}
        {c.elements.length === 0 ? (
          <p className="mp-texte-doux">{t("Aucun élément.", "No items.")}</p>
        ) : (
          <ol
            className="mp-ing-liste"
            aria-label={t("Éléments relevés par l'IA", "Items identified by the AI")}
          >
            {c.elements.map((e, i) => (
              <li
                key={`${i}-${e.page}-${e.enonce}`}
                className={e.verifie ? "mp-ing-element" : "mp-ing-element mp-ing-element--alerte"}
              >
                <div className="mp-ing-entete">
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleTypeElementLecture(e.type, langue)}
                  </BadgeStatut>
                  <BadgeVerification verifie={e.verifie} />
                  <Link href={hrefPageCitee(hrefDocument, e.page)}>{`Page ${e.page}`}</Link>
                </div>
                {edition?.index === i ? (
                  <div className="mp-ing-pile">
                    <ZoneTexte
                      libelle={t("Énoncé", "Statement")}
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
                        texteChargement={t("Enregistrement…", "Saving…")}
                        onClick={() => {
                          const err = erreurEnonce(edition.texte, langue);
                          setErreurEdition(err ?? undefined);
                          if (!err) {
                            void enregistrer(
                              modifierEnonceLecture(c, i, edition.texte),
                              t(
                                "Énoncé enregistré ; les vérifications ont été recalculées.",
                                "Statement saved; the checks have been recomputed.",
                              ),
                            );
                          }
                        }}
                      >
                        {t("Enregistrer l'énoncé", "Save statement")}
                      </Bouton>
                      <Bouton
                        variante="discret"
                        disabled={occupe}
                        onClick={() => {
                          setEdition(null);
                          setErreurEdition(undefined);
                        }}
                      >
                        {t("Annuler", "Cancel")}
                      </Bouton>
                    </div>
                  </div>
                ) : (
                  <p className="mp-ing-enonce">{e.enonce}</p>
                )}
                <p className="mp-ing-meta mp-texte-petit">
                  {t("Extrait recopié de la page :", "Excerpt copied from the page:")}
                </p>
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
                      {t("Modifier l'énoncé", "Edit statement")}
                    </Bouton>
                    {aRetirer === i ? (
                      <>
                        <Bouton
                          variante="danger"
                          chargement={occupe}
                          texteChargement={t("Retrait…", "Removing…")}
                          onClick={() =>
                            void enregistrer(
                              retirerElementLecture(c, i),
                              t("Élément retiré.", "Item removed."),
                            )
                          }
                        >
                          {t("Confirmer le retrait", "Confirm removal")}
                        </Bouton>
                        <Bouton
                          variante="discret"
                          disabled={occupe}
                          onClick={() => setARetirer(null)}
                        >
                          {t("Garder", "Keep")}
                        </Bouton>
                      </>
                    ) : (
                      <Bouton variante="discret" disabled={occupe} onClick={() => setARetirer(i)}>
                        {t("Retirer cet élément", "Remove this item")}
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
          <Alerte tonalite="danger" titre={t("Correction refusée", "Correction refused")}>
            <p>{echec}</p>
          </Alerte>
        ) : null}
      </section>

      {ouvert && peutDecider ? (
        <section aria-labelledby="titre-decision" className="mp-ing-pile">
          <h3 id="titre-decision" className="mp-carte__titre">
            {t("Décision", "Decision")}
          </h3>
          <DecisionExtraction
            api={api}
            extraction={x}
            nonVerifies={x.chiffres_non_verifies}
            libelleValider={t("Valider la lecture", "Approve the reading")}
            aide={t(
              "Le dernier à avoir corrigé le brouillon ne le valide pas lui-même (sauf un associé) : demandez à un autre membre habilité.",
              "The last person to edit the draft does not approve it themselves (except a partner): ask another authorized member.",
            )}
            onDecide={apresDecision}
          />
        </section>
      ) : ouvert ? (
        <p className="mp-texte-doux">
          {t(
            "Seul un détenteur du droit de validation de la due diligence peut valider ou rejeter ce brouillon.",
            "Only someone with the due diligence approval right can approve or reject this draft.",
          )}
        </p>
      ) : null}
    </div>
  );
}
