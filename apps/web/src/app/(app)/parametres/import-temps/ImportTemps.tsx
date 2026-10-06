"use client";

import { useEffect, useReducer, useRef, useState, type MouseEvent, type Ref } from "react";
import { ChoixFichier } from "../../../../components/fichiers/ChoixFichier";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton, classesBouton } from "../../../../components/ui/Bouton";
import { Icone } from "../../../../components/ui/Icone";
import { Tableau } from "../../../../components/ui/Tableau";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { messageErreur } from "../../../../lib/api";
import { formaterJours, formaterNombre } from "../../../../lib/format";
import {
  AIDE_FICHIER_IMPORT,
  annonceImport,
  CHEMIN_MODELE,
  compte,
  CONSEQUENCES_IMPORT,
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
    const c = controlerFichierImport(f);
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
    const p = await preparerSource(fichier, csv);
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
      const erreur = erreurImport(e, "simulation", p.source.format);
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
      envoyer({ type: "echec", erreur: erreurImport(e, "execution", source.format) });
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
        {annonceImport(etat)}
      </p>
      <ModeleExcel />
      <ChoixFichier
        libelle="Fichier à importer"
        types={TYPES_IMPORT}
        fichier={fichier}
        onChoix={choisir}
        erreur={erreurFichier}
        progression={progression}
        desactive={!modifiable}
        aide={AIDE_FICHIER_IMPORT}
      />
      <details className="mp-details">
        <summary>Coller un contenu CSV plutôt qu&apos;un fichier</summary>
        <ZoneTexte
          libelle="Contenu du CSV"
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
              ? "Un fichier est choisi : retirez-le pour importer un contenu collé."
              : "Première ligne : collaborateur;mission;tache;date;jours (séparateur « ; » ou « , »)."
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
            Importer un autre fichier
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
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function telecharger(ev: MouseEvent<HTMLAnchorElement>) {
    ev.preventDefault();
    if (enCours) return;
    setErreur(null);
    setEnCours(true);
    try {
      const url = URL.createObjectURL(await telechargerModele());
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = NOM_MODELE;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErreur(`Téléchargement du modèle impossible. ${messageErreur(e)}`);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <ol className="mp-pile">
        <li>
          Téléchargez le modèle Excel et complétez la feuille « Temps » : une ligne par
          collaborateur, tâche et jour (colonnes Collaborateur, Mission, Tâche, Date, Jours). Le
          classeur contient aussi un mode d&apos;emploi.
        </li>
        <li>Choisissez le fichier complété (.xlsx) ou un CSV aux mêmes colonnes.</li>
        <li>Simulez l&apos;import : chaque ligne est vérifiée, rien n&apos;est encore écrit.</li>
        <li>Si la simulation est sans erreur, confirmez l&apos;import.</li>
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
          <span>{enCours ? "Préparation du modèle…" : "Télécharger le modèle Excel (.xlsx)"}</span>
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
  return (
    <div className="mp-pile">
      <div className="mp-barre-actions">
        <Bouton
          ref={refSimuler}
          variante="secondaire"
          icone="oeil"
          chargement={simulationEnCours}
          texteChargement={envoiFichier ? "Envoi du fichier…" : "Simulation…"}
          disabled={!simulable}
          onClick={onSimuler}
        >
          Simuler l&apos;import
        </Bouton>
        <Bouton
          ref={refImporter}
          icone="envoyer"
          disabled={!importable}
          aria-describedby={importable ? undefined : "import-temps-condition"}
          onClick={onImporter}
        >
          Importer…
        </Bouton>
      </div>
      {importable ? null : (
        <p className="mp-texte-doux" id="import-temps-condition">
          L&apos;import se lance après une simulation sans erreur du fichier choisi.
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
  return (
    <div
      className="mp-confirmation"
      role="group"
      aria-labelledby="import-temps-question"
      aria-describedby="import-temps-consequences"
    >
      <p className="mp-confirmation__question" id="import-temps-question">
        {questionConfirmation(rapport)}
      </p>
      <p id="import-temps-consequences">{CONSEQUENCES_IMPORT}</p>
      <div className="mp-confirmation__boutons">
        <Bouton
          ref={refConfirmer}
          variante="danger"
          icone="envoyer"
          chargement={enCours}
          texteChargement="Import en cours…"
          onClick={onConfirmer}
        >
          Oui, importer
        </Bouton>
        <Bouton variante="secondaire" disabled={enCours} onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
}

function RapportImportVue({ rapport: r }: { rapport: RapportImport }) {
  const resume = resumeRapport(r);
  return (
    <section className="mp-pile" aria-labelledby="import-temps-rapport">
      <h3 className="mp-section__titre" id="import-temps-rapport">
        {r.executee ? "Rapport d'import" : "Rapport de simulation"}
      </h3>
      {/* Annoncé par la zone d'état de l'écran : pas de seconde annonce ici. */}
      <Alerte tonalite={resume.tonalite} titre={resume.titre} annonce="aucune">
        <p>{resume.detail}</p>
      </Alerte>
      <dl className="mp-liste-def mp-liste-def--compacte">
        <div>
          <dt>Lignes lues</dt>
          <dd>{formaterNombre(r.lignes_lues, 0)}</dd>
        </div>
        <div>
          <dt>{r.executee ? "Lignes importées" : "Lignes valides"}</dt>
          <dd>{formaterNombre(r.lignes_valides, 0)}</dd>
        </div>
        <div>
          <dt>Lignes en erreur</dt>
          <dd>{formaterNombre(lignesEnErreur(r), 0)}</dd>
        </div>
        <div>
          <dt>{r.executee ? "Feuilles de temps créées" : "Feuilles de temps à créer"}</dt>
          <dd>{formaterNombre(r.feuilles, 0)}</dd>
        </div>
        <div>
          <dt>Total des temps</dt>
          <dd>{formaterJours(r.jours_total)}</dd>
        </div>
      </dl>
      <ListeMessages
        messages={r.erreurs}
        legende="Erreurs ligne par ligne"
        entete="Erreur"
        autres={["autre erreur", "autres erreurs"]}
        note="Numéro de la ligne dans le fichier, en-tête compris (ligne 1). Dans un CSV, les lignes vides ne sont pas comptées."
      />
      <ListeMessages
        messages={r.avertissements}
        legende={
          r.executee
            ? "Avertissements (lignes importées)"
            : "Avertissements (lignes importées quand même)"
        }
        entete="Avertissement"
        autres={["autre avertissement", "autres avertissements"]}
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
        legende={`${legende} (${formaterNombre(messages.length, 0)})`}
        legendeVisible
        lignes={visibles}
        cleLigne={(m) => m.cle}
        colonnes={[
          { cle: "ligne", entete: "Ligne", alignement: "droite", rendu: (m) => String(m.ligne) },
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
            onClick={() => setToutes((t) => !t)}
          >
            {toutes ? "Réduire la liste" : `Afficher ${compte(masquees, autres[0], autres[1])}`}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
