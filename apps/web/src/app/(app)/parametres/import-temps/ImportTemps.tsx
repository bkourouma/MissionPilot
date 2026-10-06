"use client";

import { useRef, useState } from "react";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { Tableau } from "../../../../components/ui/Tableau";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api, messageErreur } from "../../../../lib/api";
import { formaterJours } from "../../../../lib/format";
import {
  executionPossible,
  IMPORT_MAX_OCTETS_FICHIER,
  validerCsv,
  type RapportImport,
} from "../../../../lib/temps-admin";

/**
 * Import de l'historique des temps (TPS-10) : CSV collé ou choisi, simulation obligatoire (rien
 * n'est écrit), puis exécution du même contenu si la simulation est sans erreur.
 */
export function ImportTemps() {
  const [csv, setCsv] = useState("");
  const [simule, setSimule] = useState<string | null>(null);
  const [rapport, setRapport] = useState<RapportImport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurChamp, setErreurChamp] = useState<string | undefined>();
  const [enCours, setEnCours] = useState<"simulation" | "execution" | null>(null);
  const refErreur = useRef<HTMLDivElement>(null);

  async function lireFichier(fichier: File | undefined) {
    setErreurChamp(undefined);
    if (!fichier) return;
    if (fichier.size > IMPORT_MAX_OCTETS_FICHIER) {
      setErreurChamp("Fichier trop volumineux (1 Mo au plus). Découpez-le.");
      return;
    }
    setCsv(await fichier.text());
    setRapport(null);
    setSimule(null);
  }

  async function appeler(simulation: boolean) {
    const v = validerCsv(csv);
    if (!v.ok) {
      setErreurChamp(v.erreurs.csv);
      return;
    }
    setErreurChamp(undefined);
    setErreur(null);
    setEnCours(simulation ? "simulation" : "execution");
    try {
      const r = await api.post<RapportImport>(
        `/api/temps/import?simulation=${simulation}`,
        v.charge,
        {
          delaiMs: 60_000,
        },
      );
      setRapport(r);
      setSimule(simulation ? csv : null);
    } catch (e) {
      setErreur(messageErreur(e));
      setTimeout(() => refErreur.current?.focus(), 0);
    } finally {
      setEnCours(null);
    }
  }

  const executable = executionPossible(rapport, simule === csv);
  return (
    <div className="mp-pile">
      <div className="mp-champ">
        <label className="mp-champ__libelle" htmlFor="fichier-import">
          Fichier CSV
        </label>
        <p className="mp-champ__aide" id="fichier-import-aide">
          Export Excel « CSV (séparateur : point-virgule) » accepté. Colonnes : collaborateur ;
          mission ; tache ; date (JJ/MM/AAAA ou AAAA-MM-JJ) ; jours.
        </p>
        <input
          id="fichier-import"
          className="mp-champ__controle"
          type="file"
          accept=".csv,text/csv,text/plain"
          aria-describedby="fichier-import-aide"
          onChange={(e) => void lireFichier(e.target.files?.[0])}
        />
      </div>
      <ZoneTexte
        libelle="Contenu du CSV"
        rows={8}
        value={csv}
        spellCheck={false}
        onChange={(e) => {
          setCsv(e.target.value);
          setErreurChamp(undefined);
        }}
        erreur={erreurChamp}
        aide="Ou collez le contenu ici. Exemple : collaborateur;mission;tache;date;jours"
      />
      {erreur ? (
        <div ref={refErreur} tabIndex={-1}>
          <Alerte tonalite="danger" titre="Import impossible">
            <p>{erreur}</p>
          </Alerte>
        </div>
      ) : null}
      <div className="mp-barre-actions">
        <Bouton
          variante="secondaire"
          icone="oeil"
          chargement={enCours === "simulation"}
          texteChargement="Simulation…"
          disabled={enCours !== null}
          onClick={() => appeler(true)}
        >
          Simuler l&apos;import
        </Bouton>
        <Bouton
          icone="envoyer"
          chargement={enCours === "execution"}
          texteChargement="Import…"
          disabled={!executable || enCours !== null}
          onClick={() => appeler(false)}
        >
          Importer
        </Bouton>
      </div>
      {!executable && rapport?.simulation && rapport.erreurs.length === 0 && simule !== csv ? (
        <p className="mp-texte-doux">
          Le contenu a changé depuis la simulation : simulez à nouveau.
        </p>
      ) : null}
      {rapport ? <Rapport r={rapport} /> : null}
    </div>
  );
}

function Rapport({ r }: { r: RapportImport }) {
  const titre = r.executee
    ? "Import réalisé"
    : r.erreurs.length > 0
      ? `Simulation : ${r.erreurs.length} ligne(s) en erreur, rien ne sera importé`
      : "Simulation réussie : rien n'est encore importé";
  return (
    <section className="mp-pile" aria-label="Rapport d'import">
      <Alerte tonalite={r.erreurs.length > 0 ? "danger" : "succes"} titre={titre} annonce="status">
        <p>
          {`${r.lignes_lues} ligne(s) lue(s), ${r.lignes_valides} valide(s), ${r.feuilles} feuille(s) de temps, ${formaterJours(r.jours_total)} au total.`}
        </p>
        {r.executee ? (
          <p>
            Les feuilles importées sont validées ; elles ne comptent pas dans la discipline de
            saisie.
          </p>
        ) : null}
      </Alerte>
      {r.erreurs.length > 0 ? (
        <Tableau
          legende="Erreurs ligne par ligne"
          legendeVisible
          lignes={r.erreurs}
          cleLigne={(e) => `${e.ligne}-${e.message}`}
          colonnes={[
            { cle: "ligne", entete: "Ligne", alignement: "droite", rendu: (e) => String(e.ligne) },
            { cle: "message", entete: "Erreur", rendu: (e) => e.message },
          ]}
        />
      ) : null}
      {r.avertissements.length > 0 ? (
        <Tableau
          legende="Avertissements (importés quand même)"
          legendeVisible
          lignes={r.avertissements}
          cleLigne={(e) => `${e.ligne}-${e.message}`}
          colonnes={[
            { cle: "ligne", entete: "Ligne", alignement: "droite", rendu: (e) => String(e.ligne) },
            { cle: "message", entete: "Avertissement", rendu: (e) => e.message },
          ]}
        />
      ) : null}
    </section>
  );
}
