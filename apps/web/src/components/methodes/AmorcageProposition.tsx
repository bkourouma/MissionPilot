"use client";

import "../ingestion/ingestion.css";
import Link from "next/link";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { useEffect, useState } from "react";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { DecisionExtraction } from "../ingestion/DecisionExtraction";
import { StatutExtraction } from "../ingestion/StatutExtraction";
import { formaterDateHeure } from "../../lib/format";
import {
  hrefPageCitee,
  messageErreur,
  modifierExtraction,
  type ApiIngestion,
  type ExtractionIngestion,
  type ExtractionProposition,
} from "../../lib/ingestion";
import {
  compterProposition,
  extractionOuverte,
  FAMILLES_PROPOSITION,
  libelleFamilleApplication,
  libelleFamilleProposition,
  libelleMotifIgnore,
  libelleTypeElementMethode,
  lireResultatApplication,
  retirerDeProposition,
  totalCrees,
  totalProposition,
  type FamilleProposition,
} from "../../lib/ingestion-extractions";

export interface AmorcagePropositionProps {
  api: ApiIngestion;
  extraction: ExtractionProposition;
  /** Adresse de la page du document (sans requête) : sert aux liens vers les pages citées. */
  hrefDocument: string;
  /** Lien de retour vers l'éditeur de la version de méthode. */
  hrefEditeur: string;
  peutCorriger: boolean;
  peutDecider: boolean;
  /** La version cible est publiée : la validation (qui ajoute au brouillon) est impossible. */
  versionPubliee: boolean;
}

/** Bandeau affiché tant que la proposition n'est pas tranchée. */
export const BANDEAU_PROPOSITION =
  "Brouillon produit par l'IA : rien n'est appliqué ni publié tant que vous n'avez pas validé. La validation ajoute les éléments retenus au BROUILLON de la méthode (briques en risque R3, autonomie N1, inactives par défaut) ; la publication reste une étape séparée de l'éditeur.";
export const BANDEAU_PROPOSITION_EN =
  "Draft produced by AI: nothing is applied or published until you approve. Approval adds the selected elements to the method's DRAFT (building blocks at risk R3, autonomy N1, inactive by default); publication remains a separate step in the editor.";

/**
 * Proposition d'amorçage du standard (STD-13) : étapes, briques, éléments et rubriques à cinq
 * niveaux, chacune avec sa page citée. L'expert retire ce qu'il ne retient pas, puis valide
 * (ajout au brouillon de la méthode) ou rejette avec un motif. Rien n'est publié d'ici.
 */
export function AmorcageProposition({
  api,
  extraction: initiale,
  hrefDocument,
  hrefEditeur,
  peutCorriger,
  peutDecider,
  versionPubliee,
}: AmorcagePropositionProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [x, setX] = useState<ExtractionProposition>(initiale);
  const [occupe, setOccupe] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [aRetirer, setARetirer] = useState<{ famille: FamilleProposition; index: number } | null>(
    null,
  );

  useEffect(() => {
    setX(initiale);
  }, [initiale]);

  const c = x.contenu;
  const ouvert = extractionOuverte(x.statut);
  const nombres = compterProposition(c);
  const application = x.statut === "valide" ? lireResultatApplication(x.resultat) : null;

  async function retirer(famille: FamilleProposition, index: number) {
    setOccupe(true);
    setEchec(null);
    try {
      const vue = await modifierExtraction(api, x.id, retirerDeProposition(c, famille, index));
      if (vue.nature === "standard_proposition") setX(vue);
      setAnnonce(t("Élément retiré de la proposition.", "Element removed from the proposal."));
      setARetirer(null);
      rafraichir();
    } catch (e) {
      setEchec(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  function apresDecision(vue: ExtractionIngestion) {
    if (vue.nature === "standard_proposition") setX(vue);
    rafraichir();
  }

  const retrait = (famille: FamilleProposition, index: number) =>
    ouvert && peutCorriger ? (
      <div className="mp-ing-actions">
        {aRetirer?.famille === famille && aRetirer.index === index ? (
          <>
            <Bouton
              variante="danger"
              chargement={occupe}
              texteChargement={t("Retrait…", "Removing…")}
              onClick={() => void retirer(famille, index)}
            >
              {t("Confirmer le retrait", "Confirm removal")}
            </Bouton>
            <Bouton variante="discret" disabled={occupe} onClick={() => setARetirer(null)}>
              {t("Garder", "Keep")}
            </Bouton>
          </>
        ) : (
          <Bouton
            variante="discret"
            disabled={occupe}
            onClick={() => setARetirer({ famille, index })}
          >
            {t("Retirer de la proposition", "Remove from the proposal")}
          </Bouton>
        )}
      </div>
    ) : null;

  const lienPage = (page: number) => (
    <Link href={hrefPageCitee(hrefDocument, page)}>{t(`Page ${page}`, `Page ${page}`)}</Link>
  );

  return (
    <div className="mp-ing-pile">
      <div className="mp-ing-entete">
        <StatutExtraction statut={x.statut} />
        {x.modifie_par ? (
          <span className="mp-texte-petit">
            {t(
              `Corrigée par ${x.modifie_par.nom}${x.modifie_le ? ` le ${formaterDateHeure(x.modifie_le, undefined, langue)}` : ""}`,
              `Edited by ${x.modifie_par.nom}${x.modifie_le ? ` on ${formaterDateHeure(x.modifie_le, undefined, langue)}` : ""}`,
            )}
          </span>
        ) : null}
        {x.valide_par ? (
          <span className="mp-texte-petit">
            {t(
              `${x.statut === "rejete" ? "Rejetée" : "Validée"} par ${x.valide_par.nom}${x.valide_le ? ` le ${formaterDateHeure(x.valide_le, undefined, langue)}` : ""}`,
              `${x.statut === "rejete" ? "Rejected" : "Approved"} by ${x.valide_par.nom}${x.valide_le ? ` on ${formaterDateHeure(x.valide_le, undefined, langue)}` : ""}`,
            )}
          </span>
        ) : null}
      </div>

      {ouvert ? (
        <Alerte
          tonalite="attention"
          titre={t("Proposition de l'IA à relire", "AI proposal to review")}
          annonce="aucune"
        >
          <p>{langue === "en" ? BANDEAU_PROPOSITION_EN : BANDEAU_PROPOSITION}</p>
        </Alerte>
      ) : x.statut === "rejete" ? (
        <Alerte
          tonalite="info"
          titre={t("Proposition rejetée", "Proposal rejected")}
          annonce="aucune"
        >
          <p>
            {t(
              `Motif : ${x.motif_rejet ?? "non précisé"}. Rien n'a été ajouté à la méthode.`,
              `Reason: ${x.motif_rejet ?? "not specified"}. Nothing was added to the method.`,
            )}
          </p>
        </Alerte>
      ) : null}

      {application ? (
        <Alerte
          tonalite="succes"
          titre={t(
            "Proposition appliquée au brouillon de la méthode",
            "Proposal applied to the method's draft",
          )}
        >
          <p>
            {t(
              `${totalCrees(application)} élément(s) ajouté(s) : ${application.crees.etapes} étape(s), ${application.crees.briques} brique(s), ${application.crees.elements} élément(s), ${application.crees.rubriques} rubrique(s).`,
              `${totalCrees(application)} element(s) added: ${application.crees.etapes} step(s), ${application.crees.briques} building block(s), ${application.crees.elements} element(s), ${application.crees.rubriques} rubric(s).`,
            )}
          </p>
          <p>
            {t(
              "Les briques ajoutées sont inactives, en risque R3 et en autonomie N1 : ajustez-les dans l'éditeur, puis publiez la méthode depuis l'éditeur.",
              "The added building blocks are inactive, at risk R3 and autonomy N1: adjust them in the editor, then publish the method from the editor.",
            )}
          </p>
          {application.ignores.length > 0 ? (
            <>
              <p>
                {t(
                  `${application.ignores.length} élément(s) ignoré(s) :`,
                  `${application.ignores.length} element(s) skipped:`,
                )}
              </p>
              <ul
                className="mp-liste-simple"
                aria-label={t("Éléments ignorés", "Skipped elements")}
              >
                {application.ignores.map((i) => (
                  <li key={`${i.famille}-${i.code}`}>
                    {`${libelleFamilleApplication(i.famille, langue)} ${i.code}${t(" : ", ": ")}${libelleMotifIgnore(i.motif, langue)}`}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t("Aucun élément ignoré.", "No element skipped.")}</p>
          )}
        </Alerte>
      ) : null}

      {x.statut === "valide" ? (
        <p>
          <Link href={hrefEditeur}>
            {t("Ouvrir l'éditeur de la méthode", "Open the method editor")}
          </Link>
        </p>
      ) : null}

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

      {totalProposition(c) === 0 ? (
        <p className="mp-texte-doux">{t("La proposition est vide.", "The proposal is empty.")}</p>
      ) : null}

      {FAMILLES_PROPOSITION.map((famille) => (
        <section key={famille} aria-labelledby={`titre-${famille}`} className="mp-ing-pile">
          <h3 id={`titre-${famille}`} className="mp-carte__titre">
            {`${libelleFamilleProposition(famille, langue)} (${nombres[famille]})`}
          </h3>
          {nombres[famille] === 0 ? (
            <p className="mp-texte-doux">
              {t("Aucun élément dans cette famille.", "No element in this category.")}
            </p>
          ) : (
            <ul className="mp-ing-liste" aria-label={libelleFamilleProposition(famille, langue)}>
              {famille === "etapes"
                ? c.etapes.map((e, i) => (
                    <li key={`${e.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <p className="mp-ing-enonce">{e.libelle}</p>
                        <span className="mp-texte-petit">{`Code ${e.code}`}</span>
                        {lienPage(e.page)}
                      </div>
                      {retrait("etapes", i)}
                    </li>
                  ))
                : null}
              {famille === "briques"
                ? c.briques.map((b, i) => (
                    <li key={`${b.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <p className="mp-ing-enonce">{b.libelle}</p>
                        <span className="mp-texte-petit">
                          {t(
                            `Code ${b.code} · étape ${b.etape_code}`,
                            `Code ${b.code} · step ${b.etape_code}`,
                          )}
                        </span>
                        {lienPage(b.page)}
                      </div>
                      <p className="mp-ing-meta">{b.objet}</p>
                      {retrait("briques", i)}
                    </li>
                  ))
                : null}
              {famille === "elements"
                ? c.elements.map((el, i) => (
                    <li key={`${el.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <BadgeStatut tonalite="neutre" sansIcone>
                          {libelleTypeElementMethode(el.type, langue)}
                        </BadgeStatut>
                        <p className="mp-ing-enonce">{el.libelle}</p>
                        <span className="mp-texte-petit">
                          {`Code ${el.code}${el.brique_code ? ` · ${t("brique", "building block")} ${el.brique_code}` : ""}`}
                        </span>
                        {lienPage(el.page)}
                      </div>
                      {el.description ? <p className="mp-ing-meta">{el.description}</p> : null}
                      {retrait("elements", i)}
                    </li>
                  ))
                : null}
              {famille === "rubriques"
                ? c.rubriques.map((r, i) => (
                    <li key={`${r.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <p className="mp-ing-enonce">{r.libelle}</p>
                        <span className="mp-texte-petit">{`Code ${r.code}`}</span>
                        {lienPage(r.page)}
                      </div>
                      <ol
                        aria-label={t(
                          `Cinq niveaux de la rubrique ${r.libelle}`,
                          `Five levels of the rubric ${r.libelle}`,
                        )}
                      >
                        {r.niveaux.map((n, k) => (
                          <li key={k}>{t(`Niveau ${k + 1} : ${n}`, `Level ${k + 1}: ${n}`)}</li>
                        ))}
                      </ol>
                      {retrait("rubriques", i)}
                    </li>
                  ))
                : null}
            </ul>
          )}
        </section>
      ))}

      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
      {echec ? (
        <Alerte tonalite="danger" titre={t("Retrait refusé", "Removal refused")}>
          <p>{echec}</p>
        </Alerte>
      ) : null}

      {ouvert && peutDecider ? (
        <section aria-labelledby="titre-decision" className="mp-ing-pile">
          <h3 id="titre-decision" className="mp-carte__titre">
            {t("Décision", "Decision")}
          </h3>
          <DecisionExtraction
            api={api}
            extraction={x}
            nonVerifies={x.chiffres_non_verifies}
            libelleValider={t(
              "Valider et ajouter au brouillon de la méthode",
              "Approve and add to the method's draft",
            )}
            raisonValidationImpossible={
              versionPubliee
                ? t(
                    "Cette version de méthode est publiée : la proposition ne peut plus lui être ajoutée. Vous pouvez la rejeter.",
                    "This method version is published: the proposal can no longer be added to it. You can reject it.",
                  )
                : undefined
            }
            aide={t(
              "La validation ajoute les éléments retenus au brouillon ; la publication de la méthode reste une étape séparée de l'éditeur.",
              "Approval adds the selected elements to the draft; publishing the method remains a separate step in the editor.",
            )}
            onDecide={apresDecision}
          />
        </section>
      ) : ouvert ? (
        <p className="mp-texte-doux">
          {t(
            "Seul un expert autorisé à gérer le standard peut valider ou rejeter cette proposition.",
            "Only an expert authorized to manage the standard can approve or reject this proposal.",
          )}
        </p>
      ) : null}
    </div>
  );
}
