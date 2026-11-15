"use client";

import { useEffect, useReducer, useRef, useState, type MouseEvent, type Ref } from "react";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { ChoixFichier } from "../../../../components/fichiers/ChoixFichier";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton, classesBouton } from "../../../../components/ui/Bouton";
import { Icone } from "../../../../components/ui/Icone";
import { Tableau } from "../../../../components/ui/Tableau";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { messageErreur } from "../../../../lib/api";
import { formaterJours, formaterNombre } from "../../../../lib/format";
import {
  aideFichierImport,
  annonceImport,
  CHEMIN_MODELE,
  compte,
  consequencesImport,
  controlerFichierImport,
  envoyerImport,
  erreurImport,
  ERREURS_AFFICHEES_MAX,
  erreursVisibles,
  ETAT_INITIAL,
  lignesEnErreur,
  NOM_MODELE,
  peutDemanderImport,
  peutSimuler,
  preparerSource,
  questionConfirmation,
  reduireImport,
  resumeRapport,
  sourceModifiable,
  telechargerModele,
  TYPES_IMPORT,
  type RapportImport,
  type SourceImport,
} from "../../../../lib/import-temps";

/**
 * Import de l'historique des temps (TPS-10) : classeur Excel .xlsx ou CSV (fichier ou contenu
 * collé). Simulation obligatoire (rien n'est écrit), puis confirmation explicite, puis exécution
 * du contenu exactement simulé. Les étapes sont décrites et testées dans `lib/import-temps.ts` ;
 * rien n'est conservé dans le navigateur.
 */
export function ImportTemps() {
  const t = useT();
  const langue = useLangue();
  const [etat, envoyer] = useReducer(reduireImport, ETAT_INITIAL);
  const [fichier, setFichier] = useState<File | null>(null);
  const [csv, setCsv] = useState("");
  const [erreurFichier, setErreurFichier] = useState<string | undefined>();
  const [erreurCsv, setErreurCsv] = useState<string | undefined>();
  const [progression, setProgression] = useState<number | null>(null);
  // Contenu figé par la dernière simulation réussie : l'exécution envoie celui-ci, rien d'autre.
  const simulee = useRef<SourceImport | null>(null);
  const refErreur = useRef<HTMLDivElement>(null);
  const refSimuler = useRef<HTMLButtonElement>(null);
  const refImporter = useRef<HTMLButtonElement>(null);
  const refConfirmer = useRef<HTMLButtonElement>(null);
  const refNouvel = useRef<HTMLButtonElement>(null);
  const etapePrecedente = useRef(etat.etape);

  // Focus après chaque changement d'étape : jamais perdu sur un bouton désactivé ou retiré. Le
  // résumé du rapport est annoncé par la zone d'état ; le focus ne le relit pas une seconde fois.
  useEffect(() => {
    const avant = etapePrecedente.current;
    etapePrecedente.current = etat.etape;
    if (avant === etat.etape) return;
    if (etat.erreur) refErreur.current?.focus();
    else if (etat.etape === "confirmation") refConfirmer.current?.focus();
    else if (etat.etape === "importe") refNouvel.current?.focus();
    else if (avant === "confirmation" && etat.etape === "simule") refImporter.current?.focus();
    else if (avant === "simulation") refSimuler.current?.focus();
  }, [etat.etape, etat.erreur]);

  function sourceChangee() {
    simulee.current = null;
    envoyer({ type: "source_modifiee" });
  }

  function choisir(f: File | null) {
    setErreurFichier(undefined);
    setErreurCsv(undefined);
    sourceChangee();
    if (!f) return setFichier(null);
    const c = controlerFichierImport(f, langue);
    setFichier(c.ok ? f : null);
    if (!c.ok) setErreurFichier(c.message);
  }

  async function appeler(source: SourceImport, simulation: boolean): Promise<RapportImport> {
    if (source.format === "xlsx") setProgression(0);
    try {
      return await envoyerImport(
        source,
        simulation,
        source.format === "xlsx" ? setProgression : undefined,
        langue,
      );
    } finally {
      setProgression(null);
    }
  }

  async function simuler() {
    if (!peutSimuler(etat)) return;
    envoyer({ type: "simulation_lancee" });
    setErreurFichier(undefined);
    setErreurCsv(undefined);
    simulee.current = null;
    const p = await preparerSource(fichier, csv, langue);
    if (!p.ok) {
      envoyer({ type: "preparation_refusee" });
      (p.champ === "csv" ? setErreurCsv : setErreurFichier)(p.message);
      return;
    }
    try {
      const rapport = await appeler(p.source, true);
      simulee.current = p.source;
      envoyer({ type: "simulation_terminee", rapport });
    } catch (e) {
      const erreur = erreurImport(e, "simulation", p.source.format, langue);
      if (erreur.rappel) setErreurFichier(erreur.rappel);
      envoyer({ type: "echec", erreur });
    }
  }

  async function executer() {
    const source = simulee.current;
    if (etat.etape !== "confirmation" || !source) return;
    envoyer({ type: "execution_lancee" });
    try {
      envoyer({ type: "execution_terminee", rapport: await appeler(source, false) });
    } catch (e) {
      simulee.current = null;
      envoyer({ type: "echec", erreur: erreurImport(e, "execution", source.format, langue) });
    }
  }

  function nouvelImport() {
    setFichier(null);
    setCsv("");
    setErreurFichier(undefined);
    setErreurCsv(undefined);
    sourceChangee();
  }

  const modifiable = sourceModifiable(etat);
  const rapport = etat.rapport;
  return (
    <div className="mp-pile">
      <p className="mp-visuellement-cache" role="status">
        {annonceImport(etat, langue)}
      </p>
      <ModeleExcel />
      <ChoixFichier
        libelle={t("Fichier à importer", "File to import")}
        types={TYPES_IMPORT}
        fichier={fichier}
        onChoix={choisir}
        erreur={erreurFichier}
        progression={progression}
        desactive={!modifiable}
        aide={aideFichierImport(langue)}
      />
      <details className="mp-details">
        <summary>
          {t("Coller un contenu CSV plutôt qu'un fichier", "Paste CSV content instead of a file")}
        </summary>
        <ZoneTexte
          libelle={t("Contenu du CSV", "CSV content")}
          rows={8}
          value={csv}
          spellCheck={false}
          disabled={fichier !== null || !modifiable}
          onChange={(e) => {
            setCsv(e.target.value);
            setErreurCsv(undefined);
            sourceChangee();
          }}
          erreur={erreurCsv}
          aide={
            fichier
              ? t(
                  "Un fichier est choisi : retirez-le pour importer un contenu collé.",
                  "A file is chosen: remove it to import pasted content.",
                )
              : t(
                  "Première ligne : collaborateur;mission;tache;date;jours (séparateur « ; » ou « , »).",
                  'First row: collaborateur;mission;tache;date;jours (separator ";" or ",").',
                )
          }
        />
      </details>
      {etat.erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre={etat.erreur.titre}>
          <p>{etat.erreur.message}</p>
        </Alerte>
      ) : null}
      {etat.etape === "confirmation" || etat.etape === "execution" ? (
        <ConfirmationImport
          rapport={rapport as RapportImport}
          enCours={etat.etape === "execution"}
          refConfirmer={refConfirmer}
          onConfirmer={() => void executer()}
          onAnnuler={() => envoyer({ type: "confirmation_annulee" })}
        />
      ) : etat.etape === "importe" ? (
        <div className="mp-barre-actions">
          <Bouton ref={refNouvel} variante="secondaire" icone="plus" onClick={nouvelImport}>
            {t("Importer un autre fichier", "Import another file")}
          </Bouton>
        </div>
      ) : (
        <ActionsSimulation
          simulationEnCours={etat.etape === "simulation"}
          envoiFichier={progression !== null}
          simulable={peutSimuler(etat)}
          importable={peutDemanderImport(etat)}
          refSimuler={refSimuler}
          refImporter={refImporter}
          onSimuler={() => void simuler()}
          onImporter={() => envoyer({ type: "confirmation_demandee" })}
        />
      )}
      {rapport ? <RapportImportVue rapport={rapport} /> : null}
    </div>
  );
}

/** Lien vers le modèle : téléchargé par un appel authentifié pour signaler un refus éventuel. */
function ModeleExcel() {
  const t = useT();
  const langue = useLangue();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function telecharger(ev: MouseEvent<HTMLAnchorElement>) {
    ev.preventDefault();
    if (enCours) return;
    setErreur(null);
    setEnCours(true);
    try {
      const url = URL.createObjectURL(await telechargerModele(langue));
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = NOM_MODELE;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErreur(
        t(
          `Téléchargement du modèle impossible. ${messageErreur(e, langue)}`,
          `Could not download the template. ${messageErreur(e, langue)}`,
        ),
      );
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <ol className="mp-pile">
        <li>
          {t(
            "Téléchargez le modèle Excel et complétez la feuille « Temps » : une ligne par collaborateur, tâche et jour (colonnes Collaborateur, Mission, Tâche, Date, Jours). Le classeur contient aussi un mode d'emploi.",
            'Download the Excel template and fill in the "Temps" sheet: one row per employee, task and day (columns Collaborateur, Mission, Tâche, Date, Jours). The workbook also contains instructions.',
          )}
        </li>
        <li>
          {t(
            "Choisissez le fichier complété (.xlsx) ou un CSV aux mêmes colonnes.",
            "Choose the completed file (.xlsx) or a CSV with the same columns.",
          )}
        </li>
        <li>
          {t(
            "Simulez l'import : chaque ligne est vérifiée, rien n'est encore écrit.",
            "Simulate the import: every row is checked, nothing is written yet.",
          )}
        </li>
        <li>
          {t(
            "Si la simulation est sans erreur, confirmez l'import.",
            "If the simulation has no errors, confirm the import.",
          )}
        </li>
      </ol>
      <div className="mp-barre-actions">
        <a
          href={CHEMIN_MODELE}
          download={NOM_MODELE}
          className={classesBouton("secondaire")}
          onClick={(ev) => void telecharger(ev)}
          aria-disabled={enCours || undefined}
          aria-busy={enCours || undefined}
        >
          {enCours ? (
            <span className="mp-bouton__indicateur" aria-hidden="true" />
          ) : (
            <Icone nom="telechargement" />
          )}
          <span>
            {enCours
              ? t("Préparation du modèle…", "Preparing the template…")
              : t("Télécharger le modèle Excel (.xlsx)", "Download the Excel template (.xlsx)")}
          </span>
        </a>
      </div>
      {erreur ? (
        <p className="mp-champ__erreur" role="alert">
          <Icone nom="attention" taille={16} />
          <span>{erreur}</span>
        </p>
      ) : null}
    </div>
  );
}

function ActionsSimulation({
  simulationEnCours,
  envoiFichier,
  simulable,
  importable,
  refSimuler,
  refImporter,
  onSimuler,
  onImporter,
}: {
  simulationEnCours: boolean;
  envoiFichier: boolean;
  simulable: boolean;
  importable: boolean;
  refSimuler: Ref<HTMLButtonElement>;
  refImporter: Ref<HTMLButtonElement>;
  onSimuler: () => void;
  onImporter: () => void;
}) {
  const t = useT();
  return (
    <div className="mp-pile">
      <div className="mp-barre-actions">
        <Bouton
          ref={refSimuler}
          variante="secondaire"
          icone="oeil"
          chargement={simulationEnCours}
          texteChargement={
            envoiFichier
              ? t("Envoi du fichier…", "Uploading the file…")
              : t("Simulation…", "Simulating…")
          }
          disabled={!simulable}
          onClick={onSimuler}
        >
          {t("Simuler l'import", "Simulate the import")}
        </Bouton>
        <Bouton
          ref={refImporter}
          icone="envoyer"
          disabled={!importable}
          aria-describedby={importable ? undefined : "import-temps-condition"}
          onClick={onImporter}
        >
          {t("Importer…", "Import…")}
        </Bouton>
      </div>
      {importable ? null : (
        <p className="mp-texte-doux" id="import-temps-condition">
          {t(
            "L'import se lance après une simulation sans erreur du fichier choisi.",
            "The import starts after an error-free simulation of the chosen file.",
          )}
        </p>
      )}
    </div>
  );
}

function ConfirmationImport({
  rapport,
  enCours,
  refConfirmer,
  onConfirmer,
  onAnnuler,
}: {
  rapport: RapportImport;
  enCours: boolean;
  refConfirmer: Ref<HTMLButtonElement>;
  onConfirmer: () => void;
  onAnnuler: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  return (
    <div
      className="mp-confirmation"
      role="group"
      aria-labelledby="import-temps-question"
      aria-describedby="import-temps-consequences"
    >
      <p className="mp-confirmation__question" id="import-temps-question">
        {questionConfirmation(rapport, langue)}
      </p>
      <p id="import-temps-consequences">{consequencesImport(langue)}</p>
      <div className="mp-confirmation__boutons">
        <Bouton
          ref={refConfirmer}
          variante="danger"
          icone="envoyer"
          chargement={enCours}
          texteChargement={t("Import en cours…", "Import in progress…")}
          onClick={onConfirmer}
        >
          {t("Oui, importer", "Yes, import")}
        </Bouton>
        <Bouton variante="secondaire" disabled={enCours} onClick={onAnnuler}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </div>
  );
}

function RapportImportVue({ rapport: r }: { rapport: RapportImport }) {
  const t = useT();
  const langue = useLangue();
  const resume = resumeRapport(r, langue);
  return (
    <section className="mp-pile" aria-labelledby="import-temps-rapport">
      <h3 className="mp-section__titre" id="import-temps-rapport">
        {r.executee
          ? t("Rapport d'import", "Import report")
          : t("Rapport de simulation", "Simulation report")}
      </h3>
      {/* Annoncé par la zone d'état de l'écran : pas de seconde annonce ici. */}
      <Alerte tonalite={resume.tonalite} titre={resume.titre} annonce="aucune">
        <p>{resume.detail}</p>
      </Alerte>
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>{t("Lignes lues", "Rows read")}</dt>
          <dd>{formaterNombre(r.lignes_lues, 0, langue)}</dd>
        </div>
        <div>
          <dt>
            {r.executee
              ? t("Lignes importées", "Rows imported")
              : t("Lignes valides", "Valid rows")}
          </dt>
          <dd>{formaterNombre(r.lignes_valides, 0, langue)}</dd>
        </div>
        <div>
          <dt>{t("Lignes en erreur", "Rows with errors")}</dt>
          <dd>{formaterNombre(lignesEnErreur(r), 0, langue)}</dd>
        </div>
        <div>
          <dt>
            {r.executee
              ? t("Feuilles de temps créées", "Timesheets created")
              : t("Feuilles de temps à créer", "Timesheets to create")}
          </dt>
          <dd>{formaterNombre(r.feuilles, 0, langue)}</dd>
        </div>
        <div>
          <dt>{t("Total des temps", "Total time")}</dt>
          <dd>{formaterJours(r.jours_total, langue)}</dd>
        </div>
      </dl>
      <ListeMessages
        messages={r.erreurs}
        legende={t("Erreurs ligne par ligne", "Errors row by row")}
        entete={t("Erreur", "Error")}
        autres={[t("autre erreur", "more error"), t("autres erreurs", "more errors")]}
        note={t(
          "Numéro de la ligne dans le fichier, en-tête compris (ligne 1). Dans un CSV, les lignes vides ne sont pas comptées.",
          "Row number in the file, header included (row 1). In a CSV, empty rows are not counted.",
        )}
      />
      <ListeMessages
        messages={r.avertissements}
        legende={
          r.executee
            ? t("Avertissements (lignes importées)", "Warnings (rows imported)")
            : t("Avertissements (lignes importées quand même)", "Warnings (rows imported anyway)")
        }
        entete={t("Avertissement", "Warning")}
        autres={[
          t("autre avertissement", "more warning"),
          t("autres avertissements", "more warnings"),
        ]}
      />
    </section>
  );
}

function ListeMessages({
  messages,
  legende,
  entete,
  autres,
  note,
}: {
  messages: RapportImport["erreurs"];
  legende: string;
  entete: string;
  /** Libellés du repli : « autre erreur », « autres erreurs ». */
  autres: readonly [string, string];
  note?: string;
}) {
  const t = useT();
  const langue = useLangue();
  const [toutes, setToutes] = useState(false);
  if (messages.length === 0) return null;
  const { visibles, masquees } = erreursVisibles(
    messages.map((m, i) => ({ ...m, cle: String(i) })),
    toutes,
  );
  return (
    <div className="mp-pile">
      {note ? <p className="mp-texte-doux">{note}</p> : null}
      <Tableau
        legende={`${legende} (${formaterNombre(messages.length, 0, langue)})`}
        legendeVisible
        lignes={visibles}
        cleLigne={(m) => m.cle}
        colonnes={[
          {
            cle: "ligne",
            entete: t("Ligne", "Row"),
            alignement: "droite",
            rendu: (m) => String(m.ligne),
          },
          { cle: "message", entete, rendu: (m) => <span className="mp-coupure">{m.message}</span> },
        ]}
      />
      {messages.length > ERREURS_AFFICHEES_MAX ? (
        <div className="mp-barre-actions">
          {/* Le bouton reste en place (focus conservé) : il déplie puis replie la liste. */}
          <Bouton
            variante="discret"
            icone={toutes ? "flecheHaut" : "flecheBas"}
            aria-expanded={toutes}
            onClick={() => setToutes((v) => !v)}
          >
            {toutes
              ? t("Réduire la liste", "Collapse the list")
              : t(
                  `Afficher ${compte(masquees, autres[0], autres[1], langue)}`,
                  `Show ${compte(masquees, autres[0], autres[1], langue)}`,
                )}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
