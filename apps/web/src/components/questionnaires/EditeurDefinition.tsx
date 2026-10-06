"use client";

import { useRouter } from "next/navigation";
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
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
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
  const router = useRouter();
  const [def, setDef] = useState<Definition>(version.definition);
  const [modifie, setModifie] = useState(false);
  const [vue, setVue] = useState<Vue>("edition");
  const [anomalies, setAnomalies] = useState<{
    liste: Anomalie[];
    origine: "locale" | "serveur";
  } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
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
    const a = anomaliesDepuisErreur(e);
    if (a) {
      setAnomalies({ liste: a, origine: "serveur" });
      setVue("edition");
    } else {
      setErreur(messageQuestionnaire(e) ?? messageErreur(e));
    }
    setTentative((t) => t + 1);
  }

  async function enregistrer(): Promise<boolean> {
    setErreur(null);
    setSucces(null);
    const locales = verifierForme(def);
    if (locales.length > 0) {
      setAnomalies({ liste: locales, origine: "locale" });
      setVue("edition");
      setTentative((t) => t + 1);
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
        "Brouillon enregistré : la définition a passé le contrôle de cohérence du moteur MissionPilot.",
      );
      router.refresh();
      return true;
    } catch (e) {
      echec(e);
      return false;
    } finally {
      setEnCours(null);
    }
  }

  async function valider(): Promise<boolean> {
    if (modifie && !(await enregistrer())) return false;
    setErreur(null);
    setEnCours("validation");
    try {
      await api.post(`/api/questionnaires/versions/${encodeURIComponent(version.id)}/valider`);
      setSucces(`Version ${version.version} validée : elle est figée et peut être envoyée.`);
      router.refresh();
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
      <Bouton
        icone="succes"
        chargement={enCours === "enregistrement"}
        texteChargement="Contrôle et enregistrement…"
        disabled={enCours !== null}
        onClick={() => void enregistrer()}
        aria-describedby={bas ? undefined : "qe-etat"}
      >
        Enregistrer le brouillon
      </Bouton>
      {bas ? null : (
        <BoutonConfirmation
          libelle="Valider la version"
          icone="cadenas"
          question={`Valider la version ${version.version} ? Elle sera figée : envoyable aux répondants, mais plus modifiable (une nouvelle version la remplacera).${modifie ? " Les modifications en cours seront d'abord enregistrées." : ""}`}
          libelleConfirmation="Oui, valider"
          texteChargement="Validation…"
          action={valider}
        />
      )}
    </div>
  );

  return (
    <div className="mp-qe">
      <div className="mp-pile">
        <div className="mp-qe-entete">
          <div className="mp-qe-bascule" role="group" aria-label="Affichage de la définition">
            <Bouton
              variante="discret"
              icone="crayon"
              aria-pressed={vue === "edition"}
              onClick={() => setVue("edition")}
            >
              Modifier
            </Bouton>
            <Bouton
              variante="discret"
              icone="oeil"
              aria-pressed={vue === "apercu"}
              onClick={() => setVue("apercu")}
            >
              Aperçu
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
                ? "Modifications non enregistrées (elles ne sont conservées que dans cette page)"
                : "Aucune modification en attente"}
            </span>
          </p>
        </div>
        {barre(false)}
      </div>

      {erreur ? (
        <Alerte ref={refAlerte} tonalite="danger" titre="Action impossible">
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
        <ApercuQuestionnaire definition={def} prefixe="qe-apercu" />
      ) : (
        <>
          <Champ
            libelle="Titre du questionnaire"
            name="qe-titre"
            required
            maxLength={200}
            value={def.titre}
            erreur={erreurA(liste, "titre")}
            aide="Vu par les répondants et repris dans les e-mails d'invitation et de relance."
            onChange={(e) => {
              const titre = e.target.value;
              maj((d) => ({ ...d, titre }));
            }}
          />
          <ol className="mp-qe-liste" aria-label="Sections du questionnaire">
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
              Ajouter une section
            </Bouton>
          </div>
        </>
      )}
      {barre(true)}
    </div>
  );
}
