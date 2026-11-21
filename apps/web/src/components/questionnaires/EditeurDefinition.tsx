"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, messageErreur } from "../../lib/api";
import {
  anomaliesDepuisErreur,
  messageQuestionnaire,
  type VersionDetail,
} from "../../lib/questionnaires";
import {
  ajouterQuestion,
  ajouterSection,
  deplacerQuestion,
  deplacerSection,
  idAncreQuestion,
  idAncreSection,
  majQuestion,
  majSection,
  questionsParId,
  questionsReferencables,
  renommerQuestion,
  supprimerQuestion,
  supprimerSection,
  verifierForme,
  type Anomalie,
  type Definition,
} from "../../lib/questionnaires-definition";
import { useT, useLangue } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { ApercuQuestionnaire } from "./ApercuQuestionnaire";
import { EditeurSection } from "./EditeurSection";
import { erreurA } from "./EditeurQuestion";
import { ListeAnomalies } from "./ListeAnomalies";
import "./questionnaires.css";

/** Nombre maximal de sections (schéma partagé). */
const SECTIONS_MAX = 50;

export interface EditeurDefinitionProps {
  /** Version brouillon à modifier (l'API refuse toute modification d'une version validée). */
  version: VersionDetail;
}

type Vue = "edition" | "apercu";

/**
 * Éditeur de la définition d'une version brouillon : sections, questions, conditions,
 * aperçu. « Enregistrer » applique le contrôle de forme local puis envoie la définition à
 * l'API, qui la fait contrôler par le moteur (`validerDefinition`) : une définition
 * incohérente est refusée avec ses anomalies (code, chemin, message), rien n'est enregistré.
 * La définition en cours d'édition ne vit que dans l'état de la page.
 */
export function EditeurDefinition({ version }: EditeurDefinitionProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [def, setDef] = useState<Definition>(version.definition);
  const [modifie, setModifie] = useState(false);
  const [vue, setVue] = useState<Vue>("edition");
  const [anomalies, setAnomalies] = useState<{
    liste: Anomalie[];
    origine: "locale" | "serveur";
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  // Version d'origine IA : nombres non issus d'un moteur de calcul, à acquitter avant validation.
  const chiffresAAcquitter = version.ia?.chiffres_non_verifies === true;
  const [acquitte, setAcquitte] = useState(false);
  const [enCours, setEnCours] = useState<"enregistrement" | "validation" | null>(null);
  const [tentative, setTentative] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);
  const questions = useMemo(() => questionsParId(def), [def]);
  const liste = anomalies?.liste ?? [];

  // Après un échec : focus sur la liste des anomalies ou sur l'erreur (annoncées).
  useEffect(() => {
    if (tentative > 0) refAlerte.current?.focus();
  }, [tentative]);
  // Modifications non enregistrées : le navigateur demande confirmation avant de fermer ou
  // recharger la page (la définition ne vit que dans l'état de la page).
  useEffect(() => {
    if (!modifie) return;
    const avertir = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, [modifie]);
  // Après un ajout ou un déplacement : focus sur l'élément concerné.
  useEffect(() => {
    if (!focus) return;
    document.getElementById(focus)?.focus();
    setFocus(null);
  }, [focus, def]);

  function maj(f: (d: Definition) => Definition, cible?: string) {
    setDef((d) => f(d));
    setModifie(true);
    setSucces(null);
    if (cible) setFocus(cible);
  }

  function echec(e: unknown) {
    const a = anomaliesDepuisErreur(e, langue);
    if (a) {
      setAnomalies({ liste: a, origine: "serveur" });
      setVue("edition");
    } else {
      setErreur(messageQuestionnaire(e, langue) ?? messageErreur(e));
    }
    setTentative((n) => n + 1);
  }

  async function enregistrer(): Promise<boolean> {
    setErreur(null);
    setSucces(null);
    const locales = verifierForme(def, langue);
    if (locales.length > 0) {
      setAnomalies({ liste: locales, origine: "locale" });
      setVue("edition");
      setTentative((n) => n + 1);
      return false;
    }
    setEnCours("enregistrement");
    try {
      const v = await api.put<VersionDetail>(
        `/api/questionnaires/versions/${encodeURIComponent(version.id)}`,
        { definition: def },
      );
      setDef(v.definition);
      setAnomalies(null);
      setModifie(false);
      setSucces(
        t(
          "Brouillon enregistré : la définition a passé le contrôle de cohérence du moteur CabinetPilot.",
          "Draft saved: the definition passed the consistency check of the CabinetPilot engine.",
        ),
      );
      rafraichir();
      return true;
    } catch (e) {
      echec(e);
      return false;
    } finally {
      setEnCours(null);
    }
  }

  async function valider(): Promise<boolean> {
    if (chiffresAAcquitter && !acquitte) {
      setErreur(
        t(
          "Des nombres du questionnaire ne viennent pas d'un moteur de calcul : vérifiez-les, puis cochez la case d'acquittement avant de valider.",
          "Some numbers in the questionnaire do not come from a calculation engine: check them, then tick the acknowledgement box before approving.",
        ),
      );
      setTentative((n) => n + 1);
      return false;
    }
    if (modifie && !(await enregistrer())) return false;
    setErreur(null);
    setEnCours("validation");
    try {
      await api.post(
        `/api/questionnaires/versions/${encodeURIComponent(version.id)}/valider`,
        chiffresAAcquitter ? { acquitte_chiffres: true } : undefined,
      );
      setSucces(
        t(
          `Version ${version.version} validée : elle est figée et peut être envoyée.`,
          `Version ${version.version} approved: it is locked and can be sent.`,
        ),
      );
      rafraichir();
      return true;
    } catch (e) {
      echec(e);
      return false;
    } finally {
      setEnCours(null);
    }
  }

  const barre = (bas: boolean) => (
    <div className="mp-barre-actions">
      {!bas && chiffresAAcquitter ? (
        <CaseACocher
          libelle={t(
            "J'ai vérifié les nombres cités dans ce questionnaire",
            "I have checked the numbers cited in this questionnaire",
          )}
          aide={t(
            `Nombres signalés : ${(version.ia?.nombres_non_verifies ?? []).join(", ") || "voir le texte des questions"}.`,
            `Flagged numbers: ${(version.ia?.nombres_non_verifies ?? []).join(", ") || "see the question text"}.`,
          )}
          checked={acquitte}
          onChange={(e) => setAcquitte(e.target.checked)}
        />
      ) : null}
      <Bouton
        icone="succes"
        chargement={enCours === "enregistrement"}
        texteChargement={t("Contrôle et enregistrement…", "Checking and saving…")}
        disabled={enCours !== null}
        onClick={() => void enregistrer()}
        aria-describedby={bas ? undefined : "qe-etat"}
      >
        {t("Enregistrer le brouillon", "Save draft")}
      </Bouton>
      {bas ? (
        <span
          className={modifie ? "mp-qe-etat mp-qe-etat--modifie" : "mp-qe-etat"}
          aria-hidden="true"
        >
          <Icone nom={modifie ? "attention" : "succes"} taille={16} />
          <span>
            {modifie
              ? t("Modifications non enregistrées", "Unsaved changes")
              : t("Tout est enregistré", "Everything is saved")}
          </span>
        </span>
      ) : (
        <BoutonConfirmation
          libelle={t("Valider la version", "Approve the version")}
          icone="cadenas"
          question={t(
            `Valider la version ${version.version} ? Elle sera figée : envoyable aux répondants, mais plus modifiable (une nouvelle version la remplacera).${modifie ? " Les modifications en cours seront d'abord enregistrées." : ""}`,
            `Approve version ${version.version}? It will be locked: it can be sent to respondents, but no longer edited (a new version will replace it).${modifie ? " Pending changes will be saved first." : ""}`,
          )}
          libelleConfirmation={t("Oui, valider", "Yes, approve")}
          texteChargement={t("Validation…", "Approving…")}
          action={valider}
        />
      )}
    </div>
  );

  return (
    <div className="mp-qe">
      <div className="mp-pile">
        <div className="mp-qe-entete">
          <div
            className="mp-qe-bascule"
            role="group"
            aria-label={t("Affichage de la définition", "Definition view")}
          >
            <Bouton
              variante="discret"
              icone="crayon"
              aria-pressed={vue === "edition"}
              onClick={() => setVue("edition")}
            >
              {t("Modifier", "Edit")}
            </Bouton>
            <Bouton
              variante="discret"
              icone="oeil"
              aria-pressed={vue === "apercu"}
              onClick={() => setVue("apercu")}
            >
              {t("Aperçu", "Preview")}
            </Bouton>
          </div>
          <p
            id="qe-etat"
            className={modifie ? "mp-qe-etat mp-qe-etat--modifie" : "mp-qe-etat"}
            aria-live="polite"
          >
            <Icone nom={modifie ? "attention" : "succes"} taille={16} />
            <span>
              {modifie
                ? t(
                    "Modifications non enregistrées (elles ne sont conservées que dans cette page)",
                    "Unsaved changes (they are only kept in this page)",
                  )
                : t("Aucune modification en attente", "No pending changes")}
            </span>
          </p>
        </div>
        {barre(false)}
      </div>

      {erreur ? (
        <Alerte
          ref={refAlerte}
          tonalite="danger"
          titre={t("Action impossible", "Action not possible")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      {anomalies && !erreur ? (
        <ListeAnomalies
          anomalies={liste}
          definition={def}
          origine={anomalies.origine}
          avecLiens={vue === "edition"}
          refAlerte={refAlerte}
        />
      ) : null}

      {vue === "apercu" ? (
        <ApercuQuestionnaire definition={def} prefixe="qe-apercu" langue={langue} />
      ) : (
        <>
          <Champ
            libelle={t("Titre du questionnaire", "Questionnaire title")}
            name="qe-titre"
            required
            maxLength={200}
            value={def.titre}
            erreur={erreurA(liste, "titre")}
            aide={t(
              "Vu par les répondants et repris dans les e-mails d'invitation et de relance.",
              "Seen by respondents and reused in invitation and reminder emails.",
            )}
            onChange={(e) => {
              const titre = e.target.value;
              maj((d) => ({ ...d, titre }));
            }}
          />
          <ol
            className="mp-qe-liste"
            aria-label={t("Sections du questionnaire", "Questionnaire sections")}
          >
            {def.sections.map((s, si) => (
              <li key={si}>
                <EditeurSection
                  s={s}
                  si={si}
                  total={def.sections.length}
                  candidatesSection={questionsReferencables(def, { section: si })}
                  candidatesQuestion={(qi) =>
                    questionsReferencables(def, { section: si, question: qi })
                  }
                  questions={questions}
                  anomalies={liste.filter(
                    (a) =>
                      a.chemin === `sections[${si}]` || a.chemin.startsWith(`sections[${si}].`),
                  )}
                  onChange={(n) => maj((d) => majSection(d, si, () => n))}
                  onQuestion={(qi, q) => maj((d) => majQuestion(d, si, qi, () => q))}
                  onRenommerQuestion={(qi, id) => maj((d) => renommerQuestion(d, si, qi, id))}
                  onAjouterQuestion={(m) =>
                    maj((d) => ajouterQuestion(d, si, m), idAncreQuestion(si, s.questions.length))
                  }
                  onDeplacerQuestion={(qi, sens) =>
                    maj((d) => deplacerQuestion(d, si, qi, sens), idAncreQuestion(si, qi + sens))
                  }
                  onSupprimerQuestion={(qi) =>
                    maj((d) => supprimerQuestion(d, si, qi), idAncreSection(si))
                  }
                  onDeplacer={(sens) =>
                    maj((d) => deplacerSection(d, si, sens), idAncreSection(si + sens))
                  }
                  onSupprimer={() =>
                    maj((d) => supprimerSection(d, si), idAncreSection(Math.max(0, si - 1)))
                  }
                />
              </li>
            ))}
          </ol>
          <div>
            <Bouton
              variante="secondaire"
              icone="plus"
              disabled={def.sections.length >= SECTIONS_MAX}
              onClick={() => maj(ajouterSection, idAncreSection(def.sections.length))}
            >
              {t("Ajouter une section", "Add a section")}
            </Bouton>
          </div>
        </>
      )}
      {barre(true)}
    </div>
  );
}
